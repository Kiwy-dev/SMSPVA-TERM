import { execFile, spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessGate } from './access-gate.js';
import {
  defaultCredentialsDir,
  defaultDataDir,
  readEnvKey,
  writeEnvKey,
  writePrivateFile,
} from './credentials.js';
import { fetchCatchAllMessages, testImapConnection } from './imap-client.js';
import { SMSPVAClient } from './smspva-client.js';
import { Updater } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const UI_DIST = path.join(APP_ROOT, 'ui-dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('Cuerpo demasiado grande.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loadPresets(presetsPath) {
  try {
    const raw = JSON.parse(await readFile(presetsPath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function loadPrefs(prefsPath) {
  try {
    const raw = JSON.parse(await readFile(prefsPath, 'utf8'));
    return {
      favorites: Array.isArray(raw?.favorites) ? raw.favorites.map(String) : [],
      recents: Array.isArray(raw?.recents) ? raw.recents.map(String).slice(0, 12) : [],
    };
  } catch {
    return { favorites: [], recents: [] };
  }
}

async function loadHistory(historyPath) {
  try {
    const raw = JSON.parse(await readFile(historyPath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function upsertHistory(historyPath, dataDir, entry) {
  const list = await loadHistory(historyPath);
  const now = new Date().toISOString();
  const id = String(entry.orderId || '');
  const idx = id ? list.findIndex((x) => String(x.orderId) === id) : -1;
  const merged = idx >= 0
    ? { ...list[idx], ...entry, orderId: list[idx].orderId, updatedAt: now }
    : { ...entry, createdAt: entry.createdAt || now, updatedAt: now };
  const next = idx >= 0 ? [merged, ...list.filter((_, i) => i !== idx)] : [merged, ...list];
  const trimmed = next.slice(0, 200);
  await mkdir(dataDir, { recursive: true });
  await writePrivateFile(historyPath, JSON.stringify(trimmed, null, 2));
  return trimmed;
}

export function normalizeIp(rawIp) {
  const ip = String(rawIp || '').trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function isTailscaleIp(rawIp) {
  const ip = normalizeIp(rawIp);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 100 && b >= 64 && b <= 127;
  }
  return ip.toLowerCase().startsWith('fd7a:115c:a1e0:');
}

export function isAllowedRemoteIp(rawIp) {
  const ip = normalizeIp(rawIp);
  if (!ip || ip === '127.0.0.1' || ip === '::1') return true;
  return isTailscaleIp(ip);
}

export function detectTailscaleIps() {
  const result = [];
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const info of addrs || []) {
      if (info.family === 'IPv4' && !info.internal && isTailscaleIp(info.address)) {
        result.push(info.address);
      }
    }
  }
  return [...new Set(result)];
}

function openAppWindow(url) {
  if (process.platform === 'win32') {
    const localChrome = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe');
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      localChrome,
    ];
    const exe = candidates.find((p) => p && existsSync(p));
    if (exe) {
      const child = spawn(exe, [`--app=${url}`, '--window-size=1180,780'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return;
    }
    execFile('cmd', ['/c', 'start', '', url], () => {});
    return;
  }
  if (process.platform === 'darwin') {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}

export async function createServer({
  appRoot = APP_ROOT,
  uiDist = UI_DIST,
  credentialsDir = defaultCredentialsDir(),
  dataDir = defaultDataDir(),
  accessGateOptions = {},
  updaterOptions = {},
  smspvaClientOptions = {},
} = {}) {
  const localToken = randomBytes(24).toString('hex');
  const apiKeyPath = path.join(credentialsDir, 'smspva-api.env');
  const imapPath = path.join(credentialsDir, 'smspva-imap.json');
  const presetsPath = path.join(dataDir, 'presets.json');
  const countryPrefsPath = path.join(dataDir, 'country-prefs.json');
  const operatorPrefsPath = path.join(dataDir, 'operator-prefs.json');
  const historyPath = path.join(dataDir, 'history.json');

  const accessGate = new AccessGate({
    enabled: process.env.SMSPVA_ACCESS_GATE !== '0',
    credentialsPath: path.join(credentialsDir, 'kiwyrium-reports.env'),
    ...accessGateOptions,
  });

  const updater = new Updater({
    appRoot,
    credentialsPath: path.join(credentialsDir, 'smspva-update.env'),
    dataRoot: dataDir,
    ...updaterOptions,
  });

  const savedApiKey = (await readEnvKey(apiKeyPath, 'SMSPVA_API_KEY')) || String(process.env.SMSPVA_API_KEY || '').trim();
  const smspva = new SMSPVAClient({
    apiKey: savedApiKey,
    ...smspvaClientOptions,
  });

  await Promise.all([accessGate.checkStartup(), updater.init()]);

  let cachedAccount = null;
  const uiClients = new Set();
  let lastUiSnapshot = { section: 'operacion', mailOpen: false, updatedAt: null };

  async function refreshAccountSafe() {
    if (!smspva.hasApiKey()) {
      cachedAccount = null;
      return null;
    }
    try {
      cachedAccount = await smspva.getUserInfo();
      return cachedAccount;
    } catch {
      return cachedAccount;
    }
  }

  if (accessGate.unlocked && smspva.hasApiKey()) {
    refreshAccountSafe().catch(() => {});
  }

  const server = http.createServer(async (req, res) => {
    if (!isAllowedRemoteIp(req.socket?.remoteAddress)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acceso permitido solo desde localhost o red Tailscale.');
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (!url.pathname.startsWith('/api/')) {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const target = path.resolve(uiDist, rel);
      if (!target.startsWith(path.resolve(uiDist))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      try {
        const content = await readFile(target);
        const ext = path.extname(target);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(content);
      } catch {
        try {
          const index = await readFile(path.join(uiDist, 'index.html'));
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(index);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('UI no compilada. Ejecuta: npm run build:ui');
        }
      }
      return;
    }

    const providedToken = req.headers['x-smspva-token'] || (url.pathname === '/api/ui/events' ? url.searchParams.get('token') : '');
    if (!tokenMatches(providedToken, localToken)) {
      return send(res, 401, { error: 'Token de sesión local inválido.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/ui/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      uiClients.add(res);
      req.on('close', () => uiClients.delete(res));
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/api/ui/state') {
        return send(res, 200, { result: lastUiSnapshot, clients: uiClients.size });
      }

      if (req.method === 'POST' && url.pathname === '/api/ui/report') {
        const body = await readJsonBody(req);
        lastUiSnapshot = { ...lastUiSnapshot, ...body, updatedAt: new Date().toISOString() };
        return send(res, 200, { result: lastUiSnapshot });
      }

      if (req.method === 'POST' && url.pathname === '/api/ui/command') {
        const body = await readJsonBody(req);
        if (!body?.action) return send(res, 400, { error: 'Falta action en el comando remoto.' });
        const payload = `data: ${JSON.stringify({ type: 'command', ...body })}\n\n`;
        for (const client of uiClients) {
          try { client.write(payload); } catch { uiClients.delete(client); }
        }
        return send(res, 200, { ok: true, delivered: uiClients.size });
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const presets = accessGate.unlocked ? await loadPresets(presetsPath) : [];
        const countryPrefs = accessGate.unlocked ? await loadPrefs(countryPrefsPath) : { favorites: [], recents: [] };
        const operatorPrefs = accessGate.unlocked ? await loadPrefs(operatorPrefsPath) : { favorites: [], recents: [] };
        const history = accessGate.unlocked ? await loadHistory(historyPath) : [];
        let imap = { configured: false, provider: 'hostinger', host: 'imap.hostinger.com', port: 993, domain: '', user: '' };
        if (accessGate.unlocked) {
          try {
            const rawImap = JSON.parse(await readFile(imapPath, 'utf8'));
            if (rawImap?.user && rawImap?.pass) {
              imap = {
                configured: true,
                provider: rawImap.provider || 'hostinger',
                host: rawImap.host || 'imap.hostinger.com',
                port: Number(rawImap.port) || 993,
                domain: rawImap.domain || '',
                user: rawImap.user,
              };
            }
          } catch { /* no imap configured */ }
        }
        const tailscaleIps = detectTailscaleIps();
        const activePort = server.address()?.port || Number(process.env.SMSPVA_PORT || 47820);
        const shareUrls = tailscaleIps.map((ip) => `http://${ip}:${activePort}/#token=${localToken}`);
        return send(res, 200, {
          locked: accessGate.enabled && !accessGate.unlocked,
          access: accessGate.status(),
          update: updater.status(),
          network: {
            tailscaleEnabled: process.env.SMSPVA_TAILSCALE !== '0',
            port: activePort,
            tailscaleIps,
            shareUrls,
          },
          smspva: {
            configured: smspva.hasApiKey(),
            account: cachedAccount,
          },
          imap,
          presets,
          countryPrefs,
          operatorPrefs,
          history,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/access/unlock') {
        const body = await readJsonBody(req);
        const status = await accessGate.unlock(body);
        if (status.unlocked && smspva.hasApiKey()) await refreshAccountSafe();
        return send(res, 200, { result: status });
      }

      if (req.method === 'POST' && url.pathname === '/api/access/recheck') {
        const status = await accessGate.checkStartup();
        if (status.unlocked && smspva.hasApiKey()) await refreshAccountSafe();
        return send(res, 200, { result: status });
      }

      if (req.method === 'POST' && url.pathname === '/api/access/clear') {
        const status = await accessGate.clearToken();
        return send(res, 200, { result: status });
      }

      if (accessGate.enabled && !accessGate.unlocked) {
        return send(res, 423, { error: accessGate.error || 'Acceso bloqueado. Ingresa un token privado válido.' });
      }

      // --- Configuración de API Key SMSPVA ---
      if (req.method === 'POST' && url.pathname === '/api/smspva/apikey') {
        const body = await readJsonBody(req);
        const candidate = String(body.apiKey || '').trim();
        if (!candidate) return send(res, 400, { error: 'Ingresa una API key válida.' });
        const probe = new SMSPVAClient({ apiKey: candidate, fetchImpl: smspva.fetchImpl, minIntervalMs: 0 });
        const info = await probe.getUserInfo();
        if (body.persistConsent) {
          await writeEnvKey(apiKeyPath, 'SMSPVA_API_KEY', candidate);
        }
        smspva.setApiKey(candidate);
        cachedAccount = info;
        return send(res, 200, { result: { configured: true, account: info } });
      }

      if (req.method === 'DELETE' && url.pathname === '/api/smspva/apikey') {
        await writeEnvKey(apiKeyPath, 'SMSPVA_API_KEY', '');
        smspva.setApiKey('');
        cachedAccount = null;
        return send(res, 200, { result: { configured: false, account: null } });
      }

      // --- Actualizaciones ---
      if (req.method === 'POST' && url.pathname === '/api/updates/token') {
        const body = await readJsonBody(req);
        const status = await updater.saveToken(body);
        return send(res, 200, { result: status });
      }

      if (req.method === 'DELETE' && url.pathname === '/api/updates/token') {
        const status = await updater.clearToken();
        return send(res, 200, { result: status });
      }

      if (req.method === 'POST' && url.pathname === '/api/updates/check') {
        const status = await updater.checkForUpdates();
        return send(res, 200, { result: status });
      }

      if (req.method === 'POST' && url.pathname === '/api/updates/download') {
        const status = await updater.downloadLatest();
        return send(res, 200, { result: status });
      }

      // --- IMAP Catch-All (Hostinger / Google / Outlook) ---
      if (req.method === 'POST' && url.pathname === '/api/imap/config') {
        const body = await readJsonBody(req);
        const cfg = {
          provider: String(body.provider || 'hostinger').trim(),
          host: String(body.host || 'imap.hostinger.com').trim(),
          port: Number(body.port) || 993,
          domain: String(body.domain || '').trim().replace(/^@/, ''),
          user: String(body.user || '').trim(),
          pass: String(body.pass || ''),
        };
        if (!cfg.user || !cfg.pass) return send(res, 400, { error: 'Correo y contraseña IMAP son requeridos.' });
        await testImapConnection(cfg);
        await writePrivateFile(imapPath, JSON.stringify(cfg, null, 2));
        return send(res, 200, {
          result: { configured: true, provider: cfg.provider, host: cfg.host, port: cfg.port, domain: cfg.domain, user: cfg.user },
        });
      }

      if (req.method === 'DELETE' && url.pathname === '/api/imap/config') {
        try { await unlink(imapPath); } catch { /* ignore */ }
        return send(res, 200, {
          result: { configured: false, provider: 'hostinger', host: 'imap.hostinger.com', port: 993, domain: '', user: '' },
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/imap/messages') {
        let cfg;
        try {
          cfg = JSON.parse(await readFile(imapPath, 'utf8'));
        } catch {
          return send(res, 400, { error: 'Configura primero tu bandeja Catch-All.' });
        }
        if (!cfg?.user || !cfg?.pass) return send(res, 400, { error: 'Configura primero tu bandeja Catch-All.' });
        const toFilter = url.searchParams.get('to') || '';
        const messages = await fetchCatchAllMessages(cfg, { toFilter, limit: 25 });
        return send(res, 200, { result: messages });
      }

      // --- Presets ---
      if (req.method === 'POST' && url.pathname === '/api/presets') {
        const body = await readJsonBody(req);
        const presets = await loadPresets(presetsPath);
        const item = {
          id: randomBytes(6).toString('hex'),
          label: String(body.label || `${body.serviceName || body.service} · ${body.country}`).slice(0, 60),
          service: String(body.service || '').trim(),
          serviceName: String(body.serviceName || '').trim(),
          country: String(body.country || '').trim(),
          countryName: String(body.countryName || '').trim(),
          operator: String(body.operator || '').trim(),
          voice: Number(body.voice) || 0,
        };
        if (!item.service || !item.country) return send(res, 400, { error: 'Servicio y país son requeridos.' });
        const next = [item, ...presets].slice(0, 20);
        await mkdir(dataDir, { recursive: true });
        await writePrivateFile(presetsPath, JSON.stringify(next, null, 2));
        return send(res, 200, { result: next });
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/presets/')) {
        const id = url.pathname.slice('/api/presets/'.length);
        const presets = await loadPresets(presetsPath);
        const next = presets.filter((p) => p.id !== id);
        await mkdir(dataDir, { recursive: true });
        await writePrivateFile(presetsPath, JSON.stringify(next, null, 2));
        return send(res, 200, { result: next });
      }

      if (req.method === 'POST' && url.pathname === '/api/country-prefs') {
        const body = await readJsonBody(req);
        const current = await loadPrefs(countryPrefsPath);
        const next = {
          favorites: Array.isArray(body.favorites) ? [...new Set(body.favorites.map(String))] : current.favorites,
          recents: Array.isArray(body.recents) ? [...new Set(body.recents.map(String))].slice(0, 12) : current.recents,
        };
        await mkdir(dataDir, { recursive: true });
        await writePrivateFile(countryPrefsPath, JSON.stringify(next, null, 2));
        return send(res, 200, { result: next });
      }

      if (req.method === 'POST' && url.pathname === '/api/operator-prefs') {
        const body = await readJsonBody(req);
        const current = await loadPrefs(operatorPrefsPath);
        const next = {
          favorites: Array.isArray(body.favorites) ? [...new Set(body.favorites.map(String))] : current.favorites,
          recents: Array.isArray(body.recents) ? [...new Set(body.recents.map(String))].slice(0, 12) : current.recents,
        };
        await mkdir(dataDir, { recursive: true });
        await writePrivateFile(operatorPrefsPath, JSON.stringify(next, null, 2));
        return send(res, 200, { result: next });
      }

      // --- Operación SMSPVA ---
      if (req.method === 'GET' && url.pathname === '/api/smspva/userinfo') {
        const info = await smspva.getUserInfo();
        cachedAccount = info;
        return send(res, 200, { result: info });
      }

      if (req.method === 'GET' && url.pathname === '/api/smspva/services') {
        const force = url.searchParams.get('force') === '1';
        const services = await smspva.getCatalog({ force });
        return send(res, 200, { result: services });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/smspva/prices/')) {
        const service = decodeURIComponent(url.pathname.slice('/api/smspva/prices/'.length));
        const countries = await smspva.getServicePrices(service);
        return send(res, 200, { result: countries });
      }

      if (req.method === 'GET' && url.pathname === '/api/smspva/orders') {
        const orders = await smspva.getOrders();
        return send(res, 200, { result: orders });
      }

      if (req.method === 'DELETE' && url.pathname === '/api/history') {
        await mkdir(dataDir, { recursive: true });
        await writePrivateFile(historyPath, '[]');
        return send(res, 200, { result: [] });
      }

      if (req.method === 'POST' && url.pathname === '/api/smspva/orders') {
        const body = await readJsonBody(req);
        const order = await smspva.requestNumber({
          country: body.country,
          service: body.service,
          operator: body.operator || '',
          voice: body.voice || 0,
        });
        await refreshAccountSafe();
        const history = order?.orderId
          ? await upsertHistory(historyPath, dataDir, {
              orderId: order.orderId,
              service: body.service,
              country: body.country,
              operator: body.operator || '',
              countryCode: order.countryCode || '',
              phoneNumber: order.phoneNumber || '',
              status: 'Esperando SMS',
              code: order.sms?.code || '',
              fullText: order.sms?.fullText || '',
            })
          : await loadHistory(historyPath);
        return send(res, 200, { result: order, account: cachedAccount, history });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/smspva/orders/') && url.pathname.endsWith('/sms')) {
        const orderId = decodeURIComponent(url.pathname.slice('/api/smspva/orders/'.length, -'/sms'.length));
        const data = await smspva.getSms(orderId);
        let history;
        if (data?.sms?.code) {
          history = await upsertHistory(historyPath, dataDir, {
            orderId,
            status: 'Recibido',
            code: data.sms.code,
            fullText: data.sms.fullText || '',
          });
        }
        return send(res, 200, { result: data, ...(history ? { history } : {}) });
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/smspva/orders/') && url.pathname.endsWith('/clear')) {
        const orderId = decodeURIComponent(url.pathname.slice('/api/smspva/orders/'.length, -'/clear'.length));
        const data = await smspva.clearSms(orderId);
        const history = await upsertHistory(historyPath, dataDir, { orderId, status: 'Esperando otro SMS' });
        return send(res, 200, { result: data, history });
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/smspva/orders/') && url.pathname.endsWith('/cancel')) {
        const orderId = decodeURIComponent(url.pathname.slice('/api/smspva/orders/'.length, -'/cancel'.length));
        const data = await smspva.cancelOrder(orderId);
        await refreshAccountSafe();
        const history = await upsertHistory(historyPath, dataDir, { orderId, status: 'Cancelado' });
        return send(res, 200, { result: data, account: cachedAccount, history });
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/smspva/orders/') && url.pathname.endsWith('/block')) {
        const orderId = decodeURIComponent(url.pathname.slice('/api/smspva/orders/'.length, -'/block'.length));
        const data = await smspva.blockNumber(orderId);
        await refreshAccountSafe();
        const history = await upsertHistory(historyPath, dataDir, { orderId, status: 'Bloqueado' });
        return send(res, 200, { result: data, account: cachedAccount, history });
      }

      if (req.method === 'POST' && url.pathname === '/api/smspva/repeat') {
        const body = await readJsonBody(req);
        const order = await smspva.repeatNumber(body.number, body.service);
        await refreshAccountSafe();
        const history = order?.orderId
          ? await upsertHistory(historyPath, dataDir, {
              orderId: order.orderId,
              service: body.service,
              countryCode: order.countryCode || '',
              phoneNumber: order.phoneNumber || body.number || '',
              status: 'Repetido',
            })
          : await loadHistory(historyPath);
        return send(res, 200, { result: order, account: cachedAccount, history });
      }

      return send(res, 404, { error: 'Ruta no encontrada.' });
    } catch (err) {
      return send(res, 400, { error: err?.message || 'Error procesando solicitud.' });
    }
  });

  return { server, localToken, accessGate, updater, smspva };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preferredPort = Number(process.env.SMSPVA_PORT || 47820);
  const bindHost = process.env.SMSPVA_TAILSCALE === '0' ? '127.0.0.1' : '0.0.0.0';
  const { server, localToken } = await createServer();
  const sessionPath = path.join(defaultDataDir(), 'session.json');

  const cleanupSession = () => {
    try { unlink(sessionPath).catch(() => {}); } catch { /* ignore */ }
  };
  process.once('SIGINT', () => { cleanupSession(); process.exit(0); });
  process.once('SIGTERM', () => { cleanupSession(); process.exit(0); });

  const onListening = async () => {
    const addr = server.address();
    const localUrl = `http://127.0.0.1:${addr.port}/#token=${localToken}`;
    const tailscaleIps = detectTailscaleIps();
    const shareUrls = tailscaleIps.map((ip) => `http://${ip}:${addr.port}/#token=${localToken}`);

    await mkdir(defaultDataDir(), { recursive: true });
    await writePrivateFile(
      sessionPath,
      JSON.stringify(
        {
          pid: process.pid,
          port: addr.port,
          localToken,
          localUrl,
          tailscaleIps,
          shareUrls,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    console.log(`SMSPVA local listo en ${localUrl}`);
    for (const share of shareUrls) {
      console.log(`SMSPVA Tailscale: ${share}`);
    }
    if (process.env.SMSPVA_NO_OPEN !== '1') {
      openAppWindow(localUrl);
    }
  };

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
      server.listen(0, bindHost, onListening);
    } else {
      throw err;
    }
  });
  server.listen(preferredPort, bindHost, onListening);
}
