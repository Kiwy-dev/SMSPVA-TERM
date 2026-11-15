import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { defaultCredentialsDir, defaultDataDir, readEnvKey, writeEnvKey } from './credentials.js';

export const DEFAULT_UPDATE_REPOSITORY = 'Kiwy-dev/SMSPVA-TERM';
const TOKEN_RE = /^(?:github_pat_|ghp_)[A-Za-z0-9_]{20,255}$/;
const API = 'https://api.github.com';

export const tokenValid = (value) => typeof value === 'string' && TOKEN_RE.test(value.trim());

export function parseVersion(value) {
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(value ?? '').trim());
  return match ? match.slice(1).map(Number) : null;
}

export function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export const archiveName = (version, platform = process.platform) =>
  `SMSPVA-TERM-${version}-${platform === 'win32' ? 'Windows' : 'macOS'}.zip`;

export function checksumFor(text, name) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i))
    .filter((m) => m && m[2] === name);
  if (lines.length !== 1) throw new Error(`SHA256SUMS.txt no contiene suma única para ${name}.`);
  return lines[0][1].toLowerCase();
}

export class Updater {
  constructor({
    appRoot,
    repository = DEFAULT_UPDATE_REPOSITORY,
    credentialsPath = path.join(defaultCredentialsDir(), 'smspva-update.env'),
    dataRoot = defaultDataDir(),
    fetchImpl = globalThis.fetch,
    platform = process.platform,
  } = {}) {
    this.appRoot = appRoot;
    this.repository = repository;
    this.credentialsPath = credentialsPath;
    this.dataRoot = dataRoot;
    this.fetchImpl = fetchImpl;
    this.platform = platform;
    this.currentVersion = this.#readVersion();
    this.tokenConfigured = false;
    this.state = {
      state: 'idle',
      currentVersion: this.currentVersion,
      availableVersion: null,
      releaseName: null,
      notes: '',
      checkedAt: null,
      downloadedPath: null,
      error: '',
      repository: this.repository,
    };
  }

  #readVersion() {
    for (const file of ['distribution.json', 'package.json']) {
      try {
        const parsed = JSON.parse(requireSync(path.join(this.appRoot, file)));
        if (parseVersion(parsed.version)) return parsed.version;
      } catch {
        /* next */
      }
    }
    return '0.1.0';
  }

  async init() {
    const token = await this.loadToken();
    this.tokenConfigured = Boolean(token);
    return this.status();
  }

  status() {
    return {
      ...this.state,
      tokenConfigured: this.tokenConfigured,
    };
  }

  async loadToken() {
    const fileToken = this.credentialsPath ? await readEnvKey(this.credentialsPath, 'SMSPVA_UPDATE_TOKEN') : '';
    if (tokenValid(fileToken)) return fileToken.trim();
    const envToken = String(process.env.SMSPVA_UPDATE_TOKEN || '').trim();
    return tokenValid(envToken) ? envToken : '';
  }

  async saveToken({ token, persistConsent = false } = {}) {
    const clean = String(token || '').trim();
    if (!tokenValid(clean)) throw new Error('El token de actualización debe ser github_pat_... o ghp_...');
    if (persistConsent && this.credentialsPath) {
      await writeEnvKey(this.credentialsPath, 'SMSPVA_UPDATE_TOKEN', clean);
      this.tokenConfigured = true;
    }
    return this.status();
  }

  async clearToken() {
    if (this.credentialsPath) {
      await writeEnvKey(this.credentialsPath, 'SMSPVA_UPDATE_TOKEN', '');
    }
    this.tokenConfigured = false;
    return this.status();
  }

  #headers(token, accept = 'application/vnd.github+json') {
    return {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SMSPVA-Term',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async checkForUpdates() {
    const token = await this.loadToken();
    this.tokenConfigured = Boolean(token);
    this.state.state = 'checking';
    this.state.error = '';
    try {
      const res = await this.fetchImpl(`${API}/repos/${this.repository}/releases/latest`, {
        headers: this.#headers(token),
      });
      if (res.status === 404) {
        this.state.state = 'up-to-date';
        this.state.availableVersion = null;
        this.state.checkedAt = new Date().toISOString();
        return this.status();
      }
      if (!res.ok) {
        throw new Error(`GitHub Releases respondió HTTP ${res.status}. Revisa el token de releases.`);
      }
      const release = await res.json();
      const tag = String(release.tag_name || '').replace(/^v/, '');
      this.state.checkedAt = new Date().toISOString();
      if (isNewer(tag, this.currentVersion)) {
        this.state.state = 'available';
        this.state.availableVersion = tag;
        this.state.releaseName = release.name || `v${tag}`;
        this.state.notes = String(release.body || '').slice(0, 1200);
        this.releaseAssets = Array.isArray(release.assets) ? release.assets : [];
      } else {
        this.state.state = 'up-to-date';
        this.state.availableVersion = null;
      }
      return this.status();
    } catch (err) {
      this.state.state = 'error';
      this.state.error = err.message || 'No se pudo consultar actualizaciones.';
      this.state.checkedAt = new Date().toISOString();
      return this.status();
    }
  }

  async downloadLatest() {
    if (this.state.state !== 'available' || !this.state.availableVersion) {
      await this.checkForUpdates();
    }
    if (this.state.state !== 'available' || !this.state.availableVersion) {
      return this.status();
    }
    const token = await this.loadToken();
    const assets = this.releaseAssets || [];
    const targetName = archiveName(this.state.availableVersion, this.platform);
    const archiveAsset = assets.find((a) => a.name === targetName);
    const sumsAsset = assets.find((a) => a.name === 'SHA256SUMS.txt');
    if (!archiveAsset || !sumsAsset) {
      this.state.state = 'error';
      this.state.error = `La release ${this.state.availableVersion} no incluye ${targetName} y SHA256SUMS.txt.`;
      return this.status();
    }

    this.state.state = 'downloading';
    this.state.error = '';
    try {
      const sumsRes = await this.fetchImpl(sumsAsset.url, { headers: this.#headers(token, 'application/octet-stream') });
      if (!sumsRes.ok) throw new Error(`No se pudo descargar SHA256SUMS.txt (${sumsRes.status}).`);
      const expectedSha = checksumFor(await sumsRes.text(), targetName);

      const updatesDir = path.join(this.dataRoot, 'updates');
      await mkdir(updatesDir, { recursive: true });
      const dest = path.join(updatesDir, targetName);
      const binRes = await this.fetchImpl(archiveAsset.url, { headers: this.#headers(token, 'application/octet-stream') });
      if (!binRes.ok || !binRes.body) throw new Error(`No se pudo descargar ${targetName} (${binRes.status}).`);

      const hash = createHash('sha256');
      const hasher = new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(binRes.body), hasher, createWriteStream(dest));
      const actualSha = hash.digest('hex').toLowerCase();
      if (actualSha !== expectedSha) {
        await unlink(dest).catch(() => {});
        throw new Error('La suma SHA-256 del paquete descargado no coincide.');
      }
      const info = await stat(dest);
      if (info.size <= 0) throw new Error('El paquete descargado está vacío.');
      this.state.state = 'downloaded';
      this.state.downloadedPath = dest;
      return this.status();
    } catch (err) {
      this.state.state = 'error';
      this.state.error = err.message || 'Error al descargar actualización.';
      return this.status();
    }
  }
}

function requireSync(filePath) {
  return readFileSyncCompat(filePath);
}

import { readFileSync as readFileSyncCompat } from 'node:fs';
