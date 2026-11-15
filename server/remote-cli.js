import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDataDir } from './credentials.js';

export function parseKeyValueArgs(args) {
  const out = {};
  for (const arg of args) {
    const idx = arg.indexOf('=');
    if (idx <= 0) continue;
    const key = arg.slice(0, idx);
    const raw = arg.slice(idx + 1);
    if (raw === 'true') out[key] = true;
    else if (raw === 'false') out[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) out[key] = Number(raw);
    else out[key] = raw;
  }
  return out;
}

export async function readSession(sessionPath = path.join(defaultDataDir(), 'session.json')) {
  const raw = JSON.parse(await readFile(sessionPath, 'utf8'));
  if (!raw?.port || !raw?.localToken) {
    throw new Error('session.json inválido o incompleto.');
  }
  return raw;
}

function copyToClipboard(text) {
  if (process.platform === 'win32') {
    spawnSync('clip', [], { input: String(text), encoding: 'utf8' });
  } else if (process.platform === 'darwin') {
    spawnSync('pbcopy', [], { input: String(text), encoding: 'utf8' });
  }
}

async function main() {
  const [, , sub = 'link', ...rest] = process.argv;
  const session = await readSession();
  const baseUrl = `http://127.0.0.1:${session.port}`;
  const headers = {
    'x-smspva-token': session.localToken,
    'Content-Type': 'application/json',
  };

  if (sub === 'link') {
    const stateRes = await fetch(`${baseUrl}/api/state`, { headers });
    const state = await stateRes.json();
    const urls = state?.network?.shareUrls?.length ? state.network.shareUrls : [session.localUrl];
    const primary = urls[0];
    console.log(primary);
    if (rest.includes('--copy')) {
      copyToClipboard(primary);
      console.error('Copiado al portapapeles.');
    }
    return;
  }

  if (sub === 'state') {
    const res = await fetch(`${baseUrl}/api/ui/state`, { headers });
    console.log(JSON.stringify(await res.json(), null, 2));
    return;
  }

  if (sub === 'cmd') {
    const action = rest[0];
    if (!action) throw new Error('Uso: node server/remote-cli.js cmd <action> [clave=valor ...]');
    const payload = { action, ...parseKeyValueArgs(rest.slice(1)) };
    const res = await fetch(`${baseUrl}/api/ui/command`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    console.log(JSON.stringify(await res.json(), null, 2));
    return;
  }

  throw new Error(`Subcomando desconocido: ${sub}. Usa: link | state | cmd`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
