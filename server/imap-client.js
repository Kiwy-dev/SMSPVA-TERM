import { ImapFlow } from 'imapflow';

/**
 * Extrae el primer código OTP (4-8 dígitos) de asunto o texto del correo.
 */
export function extractOtpCode(subject = '', text = '') {
  const combined = `${subject}\n${text}`;
  const explicit = /(?:code|c[oó]digo|otp|pin|verificaci[oó]n|confirmaci[oó]n)[^\d]{0,20}(\d{4,8})\b/i.exec(combined);
  if (explicit) return explicit[1];
  const standalone = /\b(\d{5,8})\b/.exec(combined);
  return standalone ? standalone[1] : '';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBodyText(rawSource) {
  const raw = Buffer.isBuffer(rawSource) ? rawSource.toString('utf8') : String(rawSource || '');
  const parts = raw.split(/\r?\n\r?\n/);
  const body = parts.slice(1).join('\n\n');
  // Si viene en quoted-printable básico, decodificamos saltos suaves
  const cleaned = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return '';
    }
  });
  return stripHtml(cleaned).slice(0, 1200);
}

function createClient({ host, port = 993, user, pass }) {
  return new ImapFlow({
    host: String(host || 'imap.hostinger.com').trim(),
    port: Number(port) || 993,
    secure: Number(port || 993) === 993,
    auth: {
      user: String(user || '').trim(),
      pass: String(pass || ''),
    },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

export async function testImapConnection(config) {
  const client = createClient(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
    await client.logout();
    return { ok: true };
  } catch (err) {
    try { client.close(); } catch { /* ignore */ }
    throw new Error(`Error IMAP: ${err?.responseText || err?.message || 'no se pudo conectar'}`);
  }
}

export async function fetchCatchAllMessages(config, { toFilter = '', limit = 25 } = {}) {
  const client = createClient(config);
  const filter = String(toFilter || '').trim().toLowerCase();
  const messages = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const total = client.mailbox?.exists || 0;
      if (total === 0) return [];
      const windowSize = Math.min(total, 60);
      const startSeq = Math.max(1, total - windowSize + 1);

      for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true, source: true })) {
        const toList = (msg.envelope?.to || [])
          .map((addr) => addr.address || `${addr.mailbox || ''}@${addr.host || ''}`)
          .filter(Boolean);
        const toJoined = toList.join(', ');
        if (filter && !toJoined.toLowerCase().includes(filter)) {
          continue;
        }
        const subject = String(msg.envelope?.subject || '(Sin asunto)');
        const from = (msg.envelope?.from || [])
          .map((addr) => addr.address || addr.name || '')
          .filter(Boolean)
          .join(', ');
        const text = extractBodyText(msg.source);
        const code = extractOtpCode(subject, text);

        messages.push({
          uid: msg.uid,
          date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
          from,
          to: toJoined,
          subject,
          text,
          code,
        });
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    try { client.close(); } catch { /* ignore */ }
    throw new Error(`Error leyendo correos: ${err?.responseText || err?.message || 'conexión fallida'}`);
  }

  return messages.reverse().slice(0, limit);
}
