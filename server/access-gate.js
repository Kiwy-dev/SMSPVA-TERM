import path from 'node:path';
import { defaultCredentialsDir, readEnvKey, writeEnvKey } from './credentials.js';

export const DEFAULT_ACCESS_REPOSITORY = 'Kiwy-dev/kiwyrium-reportes';
const TOKEN_RE = /^(?:github_pat_|ghp_)[A-Za-z0-9_]{20,255}$/;

export const tokenValid = (value) => typeof value === 'string' && TOKEN_RE.test(value.trim());

/**
 * Puerta de acceso online contra el repositorio privado de issues (`Kiwy-dev/kiwyrium-reportes`),
 * equivalente a `browser/access-gate.js` de Kiwyrium.
 */
export class AccessGate {
  constructor({
    enabled = true,
    credentialsPath = path.join(defaultCredentialsDir(), 'kiwyrium-reports.env'),
    repository = DEFAULT_ACCESS_REPOSITORY,
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
  } = {}) {
    this.enabled = Boolean(enabled);
    this.credentialsPath = credentialsPath;
    this.repository = repository;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.unlocked = !this.enabled;
    this.error = '';
    this.checkedAt = null;
    this.configured = false;
  }

  status() {
    return {
      enabled: this.enabled,
      unlocked: this.unlocked,
      configured: this.configured,
      repository: this.repository,
      error: this.error,
      checkedAt: this.checkedAt,
    };
  }

  async loadToken() {
    const fileToken = this.credentialsPath ? await readEnvKey(this.credentialsPath, 'KIWYRIUM_REPORTS_TOKEN') : '';
    if (tokenValid(fileToken)) return fileToken.trim();
    const envToken = String(process.env.KIWYRIUM_REPORTS_TOKEN || '').trim();
    return tokenValid(envToken) ? envToken : '';
  }

  async verifyToken(token) {
    if (!tokenValid(token)) {
      return { ok: false, error: 'Token con formato inválido (se espera github_pat_... o ghp_...).' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`https://api.github.com/repos/${this.repository}/issues?per_page=1&state=all`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token.trim()}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'SMSPVA-Term',
        },
        signal: controller.signal,
      });
      if (res.status === 200) return { ok: true };
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { ok: false, error: `Token rechazado por GitHub (${res.status}). Verifica permisos en ${this.repository}.` };
      }
      return { ok: false, error: `GitHub respondió HTTP ${res.status} al verificar acceso.` };
    } catch (err) {
      return {
        ok: false,
        error: err?.name === 'AbortError'
          ? 'Tiempo de espera agotado al verificar acceso con GitHub.'
          : 'Sin conexión para verificar acceso con GitHub.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async checkStartup() {
    const token = await this.loadToken();
    this.configured = Boolean(token);
    if (!this.enabled) {
      this.unlocked = true;
      this.error = '';
      this.checkedAt = new Date().toISOString();
      return this.status();
    }
    if (!token) {
      this.unlocked = false;
      this.error = `Falta el token privado de acceso (${this.repository}).`;
      this.checkedAt = new Date().toISOString();
      return this.status();
    }
    const result = await this.verifyToken(token);
    this.unlocked = result.ok;
    this.error = result.ok ? '' : result.error;
    this.checkedAt = new Date().toISOString();
    return this.status();
  }

  async unlock({ token, persistConsent = false } = {}) {
    const clean = String(token || '').trim();
    const result = await this.verifyToken(clean);
    if (!result.ok) {
      this.unlocked = false;
      this.error = result.error;
      this.checkedAt = new Date().toISOString();
      throw new Error(result.error);
    }
    if (persistConsent && this.credentialsPath) {
      await writeEnvKey(this.credentialsPath, 'KIWYRIUM_REPORTS_TOKEN', clean);
      this.configured = true;
    }
    this.unlocked = true;
    this.error = '';
    this.checkedAt = new Date().toISOString();
    return this.status();
  }

  async clearToken() {
    if (this.credentialsPath) {
      await writeEnvKey(this.credentialsPath, 'KIWYRIUM_REPORTS_TOKEN', '');
    }
    this.configured = false;
    if (this.enabled) {
      this.unlocked = false;
      this.error = `Token eliminado. Ingresa uno válido para ${this.repository}.`;
    }
    this.checkedAt = new Date().toISOString();
    return this.status();
  }
}
