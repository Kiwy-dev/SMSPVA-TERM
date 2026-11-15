import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SMSPVAClient } from '../server/smspva-client.js';
import { AccessGate } from '../server/access-gate.js';
import { Updater, parseVersion, isNewer, checksumFor } from '../server/updater.js';
import { createServer, isAllowedRemoteIp, isTailscaleIp } from '../server/server.js';
import { parseKeyValueArgs, readSession } from '../server/remote-cli.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

const ENV_KEYS = ['KIWYRIUM_REPORTS_TOKEN', 'SMSPVA_UPDATE_TOKEN', 'SMSPVA_API_KEY'];
const savedEnv = {};

before(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

after(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('SMSPVAClient', () => {
  it('getUserInfo calls userinfo with apikey header', async () => {
    const calls = [];
    const client = new SMSPVAClient({
      apiKey: 'secret-key-123',
      minIntervalMs: 0,
      fetchImpl: async (url, opts) => {
        calls.push({ url, opts });
        return jsonResponse({ statusCode: 200, data: { balance: 12.5, karma: 100 } });
      },
    });

    const info = await client.getUserInfo();
    assert.deepEqual(info, { balance: 12.5, karma: 100 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.smspva.com/activation/userinfo');
    assert.equal(calls[0].opts.method, 'GET');
    assert.equal(calls[0].opts.headers.apikey, 'secret-key-123');
  });

  it('getCatalog aggregates servicesprices by service code and caches result', async () => {
    let fetchCount = 0;
    const client = new SMSPVAClient({
      apiKey: 'secret-key-123',
      minIntervalMs: 0,
      fetchImpl: async () => {
        fetchCount += 1;
        return jsonResponse({
          statusCode: 200,
          data: [
            { service: 'opt29', serviceDescription: 'Telegram', price: 0.8 },
            { service: 'opt29', serviceDescription: 'Telegram', price: 0.45 },
            { service: 'opt19', serviceDescription: 'Google', price: 0.3 },
            { service: '', serviceDescription: 'Invalid', price: 0.1 },
          ],
        });
      },
    });

    const catalog = await client.getCatalog();
    assert.equal(fetchCount, 1);
    assert.deepEqual(catalog, [
      { code: 'opt19', name: 'Google', minPrice: 0.3, countriesCount: 1 },
      { code: 'opt29', name: 'Telegram', minPrice: 0.45, countriesCount: 2 },
    ]);

    const cached = await client.getCatalog();
    assert.equal(fetchCount, 1);
    assert.deepEqual(cached, catalog);

    await client.getCatalog({ force: true });
    assert.equal(fetchCount, 2);
  });

  it('getServicePrices filters empty operators, caps 9999 count to 999, and sorts by cname', async () => {
    const client = new SMSPVAClient({
      apiKey: 'secret-key-123',
      minIntervalMs: 0,
      fetchImpl: async (url) => {
        assert.equal(url, 'https://api.smspva.com/activation/serviceprices/opt29');
        return jsonResponse({
          statusCode: 200,
          data: {
            clist: [
              {
                ccode: 'US',
                cname: 'United States',
                opers: [
                  { oper: 'any', price: 1.2, count: 9999 },
                  { oper: 'tmobile', price: 1.5, count: 5 },
                ],
              },
              {
                ccode: 'AR',
                cname: 'Argentina',
                opers: [{ oper: 'any', price: 0.4, count: 3 }],
              },
              {
                ccode: 'XX',
                cname: 'Empty Country',
                opers: [{ oper: 'any', price: 0.2, count: 0 }],
              },
            ],
          },
        });
      },
    });

    const prices = await client.getServicePrices('opt29');
    assert.equal(prices.length, 2);
    assert.equal(prices[0].ccode, 'AR');
    assert.equal(prices[0].minPrice, 0.4);
    assert.equal(prices[0].totalCount, 3);
    assert.equal(prices[1].ccode, 'US');
    assert.equal(prices[1].minPrice, 1.2);
    assert.equal(prices[1].totalCount, 1004);
  });

  it('requestNumber builds endpoint with optional operator and voice', async () => {
    const urls = [];
    const client = new SMSPVAClient({
      apiKey: 'k1',
      minIntervalMs: 0,
      fetchImpl: async (url) => {
        urls.push(url);
        return jsonResponse({ statusCode: 200, data: { orderId: 101, phoneNumber: '5551234' } });
      },
    });

    const res1 = await client.requestNumber({ country: 'US', service: 'opt29' });
    assert.deepEqual(res1, { orderId: 101, phoneNumber: '5551234' });
    assert.equal(urls[0], 'https://api.smspva.com/activation/number/US/opt29?voice=0');

    await client.requestNumber({ country: 'MX', service: 'opt19', operator: 'telcel', voice: 1 });
    assert.equal(urls[1], 'https://api.smspva.com/activation/number/MX/opt19/telcel?voice=1');
  });

  it('getSms returns null on 202 and data on 200', async () => {
    let step = 0;
    const client = new SMSPVAClient({
      apiKey: 'k1',
      minIntervalMs: 0,
      fetchImpl: async (url) => {
        assert.equal(url, 'https://api.smspva.com/activation/sms/42');
        step += 1;
        if (step === 1) return jsonResponse({ statusCode: 202 });
        return jsonResponse({ statusCode: 200, data: { sms: { code: '987654' } } });
      },
    });

    assert.equal(await client.getSms(42), null);
    assert.deepEqual(await client.getSms(42), { sms: { code: '987654' } });
  });

  it('clearSms, cancelOrder, blockNumber, and repeatNumber hit expected endpoints and methods', async () => {
    const calls = [];
    const client = new SMSPVAClient({
      apiKey: 'k1',
      minIntervalMs: 0,
      fetchImpl: async (url, opts) => {
        calls.push({ url, method: opts.method });
        return jsonResponse({ statusCode: 200, data: { ok: true } });
      },
    });

    await client.clearSms(11);
    await client.cancelOrder(12);
    await client.blockNumber(13);
    await client.repeatNumber('5550001', 'opt29');

    assert.deepEqual(calls, [
      { url: 'https://api.smspva.com/activation/clearsms/11', method: 'PUT' },
      { url: 'https://api.smspva.com/activation/cancelorder/12', method: 'PUT' },
      { url: 'https://api.smspva.com/activation/blocknumber/13', method: 'PUT' },
      { url: 'https://api.smspva.com/activation/repeatnumber/5550001/opt29', method: 'POST' },
    ]);
  });

  it('redacts apiKey as [KEY] in API and network errors', async () => {
    const secret = 'my-super-secret-apikey-999';
    const apiErrClient = new SMSPVAClient({
      apiKey: secret,
      minIntervalMs: 0,
      fetchImpl: async () =>
        jsonResponse({
          statusCode: 400,
          error: { description: `Invalid key ${secret} rejected` },
        }),
    });

    await assert.rejects(
      () => apiErrClient.getUserInfo(),
      (err) => {
        assert.equal(err.message.includes(secret), false);
        assert.equal(err.message.includes('[KEY]'), true);
        return true;
      }
    );

    const netErrClient = new SMSPVAClient({
      apiKey: secret,
      minIntervalMs: 0,
      fetchImpl: async () => {
        throw new Error(`connect failed for ${secret}`);
      },
    });

    await assert.rejects(
      () => netErrClient.getUserInfo(),
      (err) => {
        assert.equal(err.message.includes(secret), false);
        assert.equal(err.message.includes('[KEY]'), true);
        return true;
      }
    );
  });
});

describe('AccessGate', () => {
  const VALID_TOKEN = 'github_pat_1234567890abcdefghij123456';

  it('checkStartup locks when token is missing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smspva-gate-'));
    try {
      const gate = new AccessGate({
        credentialsPath: path.join(dir, 'kiwyrium-reports.env'),
        fetchImpl: async () => {
          throw new Error('should not fetch without token');
        },
      });
      const status = await gate.checkStartup();
      assert.equal(status.unlocked, false);
      assert.equal(status.configured, false);
      assert.match(status.error, /Falta el token/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('checkStartup unlocks on 200 and locks on 403', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smspva-gate-'));
    try {
      const credPath = path.join(dir, 'kiwyrium-reports.env');
      await writeFile(credPath, `KIWYRIUM_REPORTS_TOKEN=${VALID_TOKEN}\n`, 'utf8');

      const okGate = new AccessGate({
        credentialsPath: credPath,
        fetchImpl: async () => jsonResponse({}, 200),
      });
      const okStatus = await okGate.checkStartup();
      assert.equal(okStatus.unlocked, true);
      assert.equal(okStatus.configured, true);
      assert.equal(okStatus.error, '');

      const deniedGate = new AccessGate({
        credentialsPath: credPath,
        fetchImpl: async () => jsonResponse({}, 403),
      });
      const deniedStatus = await deniedGate.checkStartup();
      assert.equal(deniedStatus.unlocked, false);
      assert.equal(deniedStatus.configured, true);
      assert.match(deniedStatus.error, /403/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('unlock persists token to temp dir and clearToken removes it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smspva-gate-'));
    try {
      const credPath = path.join(dir, 'kiwyrium-reports.env');
      const gate = new AccessGate({
        credentialsPath: credPath,
        fetchImpl: async () => jsonResponse({}, 200),
      });

      const unlocked = await gate.unlock({ token: VALID_TOKEN, persistConsent: true });
      assert.equal(unlocked.unlocked, true);
      assert.equal(unlocked.configured, true);

      const envContent = await readFile(credPath, 'utf8');
      assert.match(envContent, new RegExp(VALID_TOKEN));

      const cleared = await gate.clearToken();
      assert.equal(cleared.unlocked, false);
      assert.equal(cleared.configured, false);

      await assert.rejects(() => readFile(credPath, 'utf8'), { code: 'ENOENT' });
      assert.equal(await gate.loadToken(), '');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Updater', () => {
  it('parseVersion parses valid semver and rejects invalid values', () => {
    assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseVersion('v0.10.4'), [0, 10, 4]);
    assert.equal(parseVersion('1.2'), null);
    assert.equal(parseVersion('invalid'), null);
    assert.equal(parseVersion(null), null);
  });

  it('isNewer compares semver strings accurately', () => {
    assert.equal(isNewer('0.2.0', '0.1.0'), true);
    assert.equal(isNewer('v1.0.0', '0.9.9'), true);
    assert.equal(isNewer('0.1.0', '0.1.0'), false);
    assert.equal(isNewer('0.1.0', '0.2.0'), false);
    assert.equal(isNewer('bad', '0.1.0'), false);
  });

  it('checksumFor extracts unique sha256 and throws on missing or ambiguous entries', () => {
    const sha = 'a'.repeat(64);
    const text = `${sha} *SMSPVA-TERM-0.2.0-Windows.zip\n${'b'.repeat(64)}  other.zip\n`;
    assert.equal(checksumFor(text, 'SMSPVA-TERM-0.2.0-Windows.zip'), sha);
    assert.throws(() => checksumFor(text, 'missing.zip'));
  });

  it('checkForUpdates detects available vs up-to-date', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smspva-upd-'));
    try {
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: '0.1.0' }), 'utf8');

      const availUpdater = new Updater({
        appRoot: dir,
        credentialsPath: path.join(dir, 'smspva-update.env'),
        dataRoot: dir,
        fetchImpl: async () =>
          jsonResponse({
            tag_name: 'v0.2.0',
            name: 'Release 0.2.0',
            body: 'New features',
            assets: [],
          }),
      });

      const avail = await availUpdater.checkForUpdates();
      assert.equal(avail.state, 'available');
      assert.equal(avail.availableVersion, '0.2.0');
      assert.equal(avail.releaseName, 'Release 0.2.0');

      const currentUpdater = new Updater({
        appRoot: dir,
        credentialsPath: path.join(dir, 'smspva-update.env'),
        dataRoot: dir,
        fetchImpl: async () =>
          jsonResponse({
            tag_name: 'v0.1.0',
            name: 'Release 0.1.0',
            body: '',
            assets: [],
          }),
      });

      const upToDate = await currentUpdater.checkForUpdates();
      assert.equal(upToDate.state, 'up-to-date');
      assert.equal(upToDate.availableVersion, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('createServer', () => {
  async function startTestServer({ gateEnabled = true, gateStatus = 200, smspvaFetchImpl } = {}) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'smspva-srv-'));
    const credentialsDir = path.join(tempDir, 'creds');
    const dataDir = path.join(tempDir, 'data');

    const { server, localToken, accessGate } = await createServer({
      appRoot: tempDir,
      uiDist: tempDir,
      credentialsDir,
      dataDir,
      accessGateOptions: {
        enabled: gateEnabled,
        fetchImpl: async () => jsonResponse({}, gateStatus),
      },
      updaterOptions: {
        fetchImpl: async () => jsonResponse({}, 404),
      },
      smspvaClientOptions: {
        minIntervalMs: 0,
        fetchImpl:
          smspvaFetchImpl ||
          (async () => jsonResponse({ statusCode: 200, data: { balance: 5.0 } })),
      },
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const cleanup = async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(tempDir, { recursive: true, force: true });
    };

    return { server, localToken, accessGate, baseUrl, cleanup };
  }

  it('returns 401 when x-smspva-token is missing or invalid', async () => {
    const ctx = await startTestServer({ gateEnabled: false });
    try {
      const resNoToken = await fetch(`${ctx.baseUrl}/api/state`);
      assert.equal(resNoToken.status, 401);

      const resBadToken = await fetch(`${ctx.baseUrl}/api/state`, {
        headers: { 'x-smspva-token': 'wrong-token' },
      });
      assert.equal(resBadToken.status, 401);
    } finally {
      await ctx.cleanup();
    }
  });

  it('reports locked state and returns 423 on /api/smspva/orders when locked, then 200 when unlocked', async () => {
    const VALID_TOKEN = 'github_pat_1234567890abcdefghij123456';
    const ctx = await startTestServer({
      gateEnabled: true,
      smspvaFetchImpl: async (url) => {
        if (url.endsWith('/orders')) {
          return jsonResponse({ statusCode: 200, data: { orders: [{ id: 1 }] } });
        }
        return jsonResponse({ statusCode: 200, data: { balance: 10 } });
      },
    });

    try {
      const headers = {
        'x-smspva-token': ctx.localToken,
        'Content-Type': 'application/json',
      };

      const lockedState = await fetch(`${ctx.baseUrl}/api/state`, { headers }).then((r) => r.json());
      assert.equal(lockedState.locked, true);

      const blockedRes = await fetch(`${ctx.baseUrl}/api/smspva/orders`, { headers });
      assert.equal(blockedRes.status, 423);

      const unlockRes = await fetch(`${ctx.baseUrl}/api/access/unlock`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: VALID_TOKEN, persistConsent: false }),
      });
      assert.equal(unlockRes.status, 200);

      const unlockedState = await fetch(`${ctx.baseUrl}/api/state`, { headers }).then((r) => r.json());
      assert.equal(unlockedState.locked, false);

      // Configure API key so /api/smspva/orders succeeds
      const keyRes = await fetch(`${ctx.baseUrl}/api/smspva/apikey`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey: 'valid-api-key', persistConsent: false }),
      });
      assert.equal(keyRes.status, 200);

      const ordersRes = await fetch(`${ctx.baseUrl}/api/smspva/orders`, { headers });
      assert.equal(ordersRes.status, 200);
      const ordersJson = await ordersRes.json();
      assert.deepEqual(ordersJson.result, [{ id: 1 }]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('validates /api/smspva/apikey and supports DELETE', async () => {
    const ctx = await startTestServer({
      gateEnabled: false,
      smspvaFetchImpl: async (url, opts) => {
        if (opts.headers.apikey === 'bad-key') {
          return jsonResponse({ statusCode: 401, error: { description: 'Unauthorized' } });
        }
        return jsonResponse({ statusCode: 200, data: { balance: 99.5, name: 'tester' } });
      },
    });

    try {
      const headers = {
        'x-smspva-token': ctx.localToken,
        'Content-Type': 'application/json',
      };

      const emptyRes = await fetch(`${ctx.baseUrl}/api/smspva/apikey`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey: '   ' }),
      });
      assert.equal(emptyRes.status, 400);

      const badRes = await fetch(`${ctx.baseUrl}/api/smspva/apikey`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey: 'bad-key' }),
      });
      assert.equal(badRes.status, 400);

      const goodRes = await fetch(`${ctx.baseUrl}/api/smspva/apikey`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey: 'good-key', persistConsent: true }),
      });
      assert.equal(goodRes.status, 200);
      const goodJson = await goodRes.json();
      assert.equal(goodJson.result.configured, true);
      assert.deepEqual(goodJson.result.account, { balance: 99.5, name: 'tester' });

      const delRes = await fetch(`${ctx.baseUrl}/api/smspva/apikey`, {
        method: 'DELETE',
        headers,
      });
      assert.equal(delRes.status, 200);
      const delJson = await delRes.json();
      assert.equal(delJson.result.configured, false);
    } finally {
      await ctx.cleanup();
    }
  });

  it('adds and deletes /api/presets and creates order via POST /api/smspva/orders', async () => {
    const ctx = await startTestServer({
      gateEnabled: false,
      smspvaFetchImpl: async (url) => {
        if (url.includes('/number/US/opt29')) {
          return jsonResponse({ statusCode: 200, data: { orderId: 777, phoneNumber: '12025550100' } });
        }
        return jsonResponse({ statusCode: 200, data: { balance: 8.5 } });
      },
    });

    try {
      const headers = {
        'x-smspva-token': ctx.localToken,
        'Content-Type': 'application/json',
      };

      const invalidPreset = await fetch(`${ctx.baseUrl}/api/presets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ service: 'opt29' }),
      });
      assert.equal(invalidPreset.status, 400);

      const addPreset = await fetch(`${ctx.baseUrl}/api/presets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ service: 'opt29', serviceName: 'Telegram', country: 'US', countryName: 'USA' }),
      });
      assert.equal(addPreset.status, 200);
      const addedJson = await addPreset.json();
      assert.equal(addedJson.result.length, 1);
      const presetId = addedJson.result[0].id;
      assert.equal(addedJson.result[0].service, 'opt29');

      const delPreset = await fetch(`${ctx.baseUrl}/api/presets/${presetId}`, {
        method: 'DELETE',
        headers,
      });
      assert.equal(delPreset.status, 200);
      const delJson = await delPreset.json();
      assert.equal(delJson.result.length, 0);

      // Set API key and POST /api/smspva/orders
      await fetch(`${ctx.baseUrl}/api/smspva/apikey`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey: 'order-key' }),
      });

      const orderRes = await fetch(`${ctx.baseUrl}/api/smspva/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ country: 'US', service: 'opt29' }),
      });
      assert.equal(orderRes.status, 200);
      const orderJson = await orderRes.json();
      assert.deepEqual(orderJson.result, { orderId: 777, phoneNumber: '12025550100' });
      assert.deepEqual(orderJson.account, { balance: 8.5 });
      assert.equal(orderJson.history.length, 1);
      assert.equal(orderJson.history[0].orderId, 777);
    } finally {
      await ctx.cleanup();
    }
  });

  it('persists countryPrefs, operatorPrefs, presets, and history across server restarts', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smspva-persist-'));
    const credDir = path.join(dir, 'creds');
    const dataDir = path.join(dir, 'data');
    const smspvaFetch = async (url) => {
      if (String(url).includes('/userinfo')) return jsonResponse({ statusCode: 200, data: { balance: 15 } });
      if (String(url).includes('/number/')) return jsonResponse({ statusCode: 200, data: { orderId: 901, phoneNumber: '5511223344', countryCode: '+52' } });
      return jsonResponse({ statusCode: 200, data: { sms: { code: '432100', fullText: 'Code 432100' } } });
    };

    const s1 = await createServer({
      credentialsDir: credDir,
      dataDir,
      accessGateOptions: { enabled: false },
      smspvaClientOptions: { apiKey: 'persist-key', fetchImpl: smspvaFetch, minIntervalMs: 0 },
    });
    await new Promise((resolve) => s1.server.listen(0, '127.0.0.1', resolve));
    const url1 = `http://127.0.0.1:${s1.server.address().port}`;
    const h1 = { 'x-smspva-token': s1.localToken, 'Content-Type': 'application/json' };

    try {
      await fetch(`${url1}/api/country-prefs`, { method: 'POST', headers: h1, body: JSON.stringify({ favorites: ['MX'], recents: ['MX', 'CO'] }) });
      await fetch(`${url1}/api/operator-prefs`, { method: 'POST', headers: h1, body: JSON.stringify({ favorites: ['Telcel_MX'], recents: ['Telcel_MX'] }) });
      await fetch(`${url1}/api/presets`, { method: 'POST', headers: h1, body: JSON.stringify({ service: 'opt2', serviceName: 'Facebook', country: 'MX', countryName: 'Mexico' }) });
      await fetch(`${url1}/api/smspva/orders`, { method: 'POST', headers: h1, body: JSON.stringify({ country: 'MX', service: 'opt2', operator: 'Telcel_MX' }) });
      await fetch(`${url1}/api/smspva/orders/901/sms`, { headers: h1 });
    } finally {
      await new Promise((resolve) => s1.server.close(resolve));
    }

    const s2 = await createServer({
      credentialsDir: credDir,
      dataDir,
      accessGateOptions: { enabled: false },
      smspvaClientOptions: { apiKey: 'persist-key', fetchImpl: smspvaFetch, minIntervalMs: 0 },
    });
    await new Promise((resolve) => s2.server.listen(0, '127.0.0.1', resolve));
    const url2 = `http://127.0.0.1:${s2.server.address().port}`;
    const h2 = { 'x-smspva-token': s2.localToken };

    try {
      const state = await (await fetch(`${url2}/api/state`, { headers: h2 })).json();
      assert.deepEqual(state.countryPrefs, { favorites: ['MX'], recents: ['MX', 'CO'] });
      assert.deepEqual(state.operatorPrefs, { favorites: ['Telcel_MX'], recents: ['Telcel_MX'] });
      assert.equal(state.presets.length, 1);
      assert.equal(state.presets[0].service, 'opt2');
      assert.equal(state.history.length, 1);
      assert.equal(state.history[0].orderId, 901);
      assert.equal(state.history[0].code, '432100');
      assert.equal(state.history[0].status, 'Recibido');
    } finally {
      await new Promise((resolve) => s2.server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('allows localhost and Tailscale CGNAT IPs while blocking non-Tailscale LAN/public IPs', () => {
    assert.equal(isTailscaleIp('100.64.0.1'), true);
    assert.equal(isTailscaleIp('100.101.42.9'), true);
    assert.equal(isTailscaleIp('::ffff:100.90.12.34'), true);
    assert.equal(isTailscaleIp('192.168.1.50'), false);
    assert.equal(isAllowedRemoteIp('127.0.0.1'), true);
    assert.equal(isAllowedRemoteIp('::1'), true);
    assert.equal(isAllowedRemoteIp('::ffff:100.80.1.2'), true);
    assert.equal(isAllowedRemoteIp('::ffff:192.168.1.50'), false);
    assert.equal(isAllowedRemoteIp('8.8.8.8'), false);
  });

  it('parses remote-cli key=value args and reads session.json', async () => {
    assert.deepEqual(parseKeyValueArgs(['section=configuracion', 'open=true', 'voice=0']), {
      section: 'configuracion',
      open: true,
      voice: 0,
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smspva-sess-'));
    try {
      const sp = path.join(dir, 'session.json');
      await writeFile(sp, JSON.stringify({ port: 47820, localToken: 'abc123', localUrl: 'http://127.0.0.1:47820/#token=abc123' }), 'utf8');
      const s = await readSession(sp);
      assert.equal(s.port, 47820);
      assert.equal(s.localToken, 'abc123');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
