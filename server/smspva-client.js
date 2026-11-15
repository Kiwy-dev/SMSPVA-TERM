/**
 * Cliente para SMSPVA Activation API v2 (https://api.smspva.com/activation/).
 * Mantiene el límite de 5s mínimo entre llamadas como `smspva.py` y oculta la apikey en errores.
 */
export class SMSPVAClient {
  constructor({ apiKey = '', fetchImpl = globalThis.fetch, minIntervalMs = 5000 } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.fetchImpl = fetchImpl;
    this.minIntervalMs = minIntervalMs;
    this.lastCallAt = 0;
    this.queue = Promise.resolve();
    this.catalogCache = { fetchedAt: 0, services: [] };
  }

  setApiKey(key) {
    this.apiKey = String(key || '').trim();
  }

  hasApiKey() {
    return Boolean(this.apiKey);
  }

  #redact(text) {
    const raw = String(text ?? '');
    return this.apiKey ? raw.split(this.apiKey).join('[KEY]') : raw;
  }

  async call(endpoint, { method = 'GET', respectRateLimit = true } = {}) {
    if (!this.apiKey) throw new Error('Configura tu API key de SMSPVA primero.');

    const run = async () => {
      if (respectRateLimit && this.minIntervalMs > 0) {
        const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.lastCallAt));
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      this.lastCallAt = Date.now();

      const url = `https://api.smspva.com/activation/${endpoint.replace(/^\/+/, '')}`;
      let res;
      let payload;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            apikey: this.apiKey,
            Accept: 'application/json',
          },
        });
        payload = await res.json();
      } catch (err) {
        throw new Error(this.#redact(`Error de red consultando SMSPVA (${err?.message || 'conexión'}).`));
      }

      if (payload?.statusCode === 202) return null;
      if (payload?.statusCode !== 200) {
        const desc = payload?.error?.description || payload?.error?.type || JSON.stringify(payload?.error || {});
        throw new Error(this.#redact(desc || `SMSPVA respondió ${res?.status || 'error'}.`));
      }
      return payload.data;
    };

    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async getUserInfo() {
    return this.call('userinfo', { respectRateLimit: false });
  }

  async getBalance() {
    return this.call('balance', { respectRateLimit: false });
  }

  async getOrders() {
    const data = await this.call('orders', { respectRateLimit: false });
    return Array.isArray(data?.orders) ? data.orders : [];
  }

  async getCatalog({ force = false } = {}) {
    const now = Date.now();
    if (!force && this.catalogCache.services.length > 0 && now - this.catalogCache.fetchedAt < 6 * 60 * 60 * 1000) {
      return this.catalogCache.services;
    }
    const rows = await this.call('servicesprices', { respectRateLimit: false });
    const map = new Map();
    for (const item of Array.isArray(rows) ? rows : []) {
      const code = String(item.service || '').trim();
      const name = String(item.serviceDescription || code).trim();
      const price = Number(item.price);
      if (!code) continue;
      const existing = map.get(code);
      if (!existing) {
        map.set(code, {
          code,
          name,
          minPrice: Number.isFinite(price) ? price : null,
          countriesCount: 1,
        });
      } else {
        existing.countriesCount += 1;
        if (Number.isFinite(price) && (existing.minPrice === null || price < existing.minPrice)) {
          existing.minPrice = price;
        }
      }
    }
    const services = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    this.catalogCache = { fetchedAt: now, services };
    return services;
  }

  async getServicePrices(serviceCode) {
    const code = encodeURIComponent(String(serviceCode || '').trim());
    const data = await this.call(`serviceprices/${code}`, { respectRateLimit: false });
    const clist = Array.isArray(data?.clist) ? data.clist : [];
    return clist
      .map((c) => {
        const opers = (Array.isArray(c.opers) ? c.opers : []).filter((o) => Number(o.count) > 0);
        if (opers.length === 0) return null;
        return {
          ccode: c.ccode,
          cname: c.cname,
          minPrice: Math.min(...opers.map((o) => Number(o.price)).filter(Number.isFinite)),
          totalCount: opers.reduce((acc, o) => acc + (Number(o.count) === 9999 ? 999 : Number(o.count) || 0), 0),
          opers,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.cname.localeCompare(b.cname, 'es'));
  }

  async requestNumber({ country, service, operator = '', voice = 0 }) {
    const parts = [country, service, ...(operator ? [operator] : [])].map((x) => encodeURIComponent(String(x).trim()));
    return this.call(`number/${parts.join('/')}?voice=${Number(voice) || 0}`);
  }

  async getSms(orderId) {
    return this.call(`sms/${encodeURIComponent(String(orderId))}`);
  }

  async clearSms(orderId) {
    return this.call(`clearsms/${encodeURIComponent(String(orderId))}`, { method: 'PUT' });
  }

  async cancelOrder(orderId) {
    return this.call(`cancelorder/${encodeURIComponent(String(orderId))}`, { method: 'PUT' });
  }

  async blockNumber(orderId) {
    return this.call(`blocknumber/${encodeURIComponent(String(orderId))}`, { method: 'PUT' });
  }

  async repeatNumber(number, service) {
    return this.call(`repeatnumber/${encodeURIComponent(String(number))}/${encodeURIComponent(String(service))}`, {
      method: 'POST',
    });
  }
}
