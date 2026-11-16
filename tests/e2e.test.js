import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chromium } from 'playwright-core';
import { createWorkbookFile, readWorkbookRows } from '../server/excel-store.js';
import { createServer } from '../server/server.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('E2E UI & Remote Controls (Google Chrome)', () => {
  it('verifies full UI flows, pickers, Catch-All drawer, user-select lock, and remote commands without buying numbers', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smspva-e2e-'));
    const credDir = path.join(dir, 'creds');
    const dataDir = path.join(dir, 'data');
    let buyCalled = false;

    const smspvaFetch = async (url) => {
      const target = String(url);
      if (target.includes('/number/')) {
        buyCalled = true;
        throw new Error('E2E test must never buy a real number');
      }
      if (target.includes('/userinfo')) {
        return jsonResponse({ statusCode: 200, data: { balance: '26.4500', name: 'Ana Rojas', karma: 30 } });
      }
      if (target.includes('/orders')) {
        return jsonResponse({ statusCode: 200, data: { orders: [] } });
      }
      if (target.includes('/servicesprices')) {
        return jsonResponse({
          statusCode: 200,
          data: [
            { service: 'opt2', serviceDescription: 'Facebook', country: 'MX', price: '0.80' },
            { service: 'opt16', serviceDescription: 'Instagram (+Threads)', country: 'MX', price: '0.60' },
            { service: 'opt29', serviceDescription: 'Telegram', country: 'US', price: '1.20' },
          ],
        });
      }
      if (target.includes('/serviceprices/')) {
        return jsonResponse({
          statusCode: 200,
          data: {
            clist: [
              {
                ccode: 'MX',
                cname: 'Mexico',
                opers: [
                  { opcode: 'Telcel_MX', price: 0.8, count: 120 },
                  { opcode: 'ATT_MX', price: 1.4, count: 50 },
                ],
              },
              {
                ccode: 'CO',
                cname: 'Colombia',
                opers: [{ opcode: 'Claro_CO', price: 0.45, count: 80 }],
              },
            ],
          },
        });
      }
      return jsonResponse({ statusCode: 404, error: { description: 'Not found' } }, 404);
    };

    const { server, localToken } = await createServer({
      credentialsDir: credDir,
      dataDir,
      accessGateOptions: { enabled: false },
      smspvaClientOptions: { apiKey: 'e2e-mock-key', fetchImpl: smspvaFetch, minIntervalMs: 0 },
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch({ channel: 'chrome', headless: true });

    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      await page.goto(`${baseUrl}/#token=${localToken}`, { waitUntil: 'networkidle' });

      // 1. Topbar & user-select: none
      await page.waitForSelector('text=Saldo: 26.4500');
      await page.waitForSelector('text=Karma: 30');
      const userSelect = await page.evaluate(() => getComputedStyle(document.body).userSelect);
      assert.equal(userSelect, 'none');

      // 2. App icons & "... más"
      await page.click('button:has-text("… más")');
      await page.waitForSelector('input[placeholder*="Uber"]');
      await page.click('button:has-text("Facebook")');
      assert.equal(await page.locator('input[placeholder*="Uber"]').count(), 0);

      // 3. CountryPicker: flags, sort, favorite, recent
      await page.click('.country-trigger >> nth=0');
      await page.waitForSelector('.country-menu');
      assert.ok((await page.locator('.flag-img').count()) >= 2);
      await page.selectOption('select[aria-label="Ordenar países"]', 'price-asc');
      const firstCountryText = await page.locator('.country-list .country-name').first().textContent();
      assert.match(firstCountryText || '', /Colombia/);

      // Favorite Mexico & select it
      const mxRow = page.locator('.country-item', { hasText: 'Mexico' });
      await mxRow.locator('.fav-star').click();
      await page.click('button.chip-btn:has-text("★ Favoritos")');
      assert.equal(await page.locator('.country-item').count(), 1);
      await page.click('button.chip-btn:has-text("Todos")');
      await mxRow.locator('.country-pick').click();

      // 4. OperatorPicker: favorite & sort
      await page.click('.country-trigger >> nth=1');
      await page.waitForSelector('.country-menu');
      await page.selectOption('select[aria-label="Ordenar operadores"]', 'price-desc');
      const firstOpText = await page.locator('.country-list .country-name').nth(1).textContent();
      assert.match(firstOpText || '', /ATT_MX/);
      await page.locator('.country-item', { hasText: 'Telcel_MX' }).locator('.fav-star').click();
      await page.locator('.country-item', { hasText: 'Telcel_MX' }).locator('.country-pick').click();

      // 5. Catch-All right drawer
      await page.click('button.drawer-tab');
      await page.waitForSelector('.drawer-panel.open');
      await page.waitForSelector('text=Conecta tu buzón por IMAP');
      await page.selectOption('.drawer-panel select', 'google');
      assert.equal(await page.locator('.drawer-panel input[placeholder="imap.hostinger.com"]').inputValue(), 'imap.gmail.com');
      await page.selectOption('.drawer-panel select', 'outlook');
      assert.equal(await page.locator('.drawer-panel input[placeholder="imap.hostinger.com"]').inputValue(), 'outlook.office365.com');
      await page.click('.drawer-panel button:has-text("Cerrar")');

      // 6. Navigation to Historial & Configuración
      await page.click('.nav button:has-text("Historial")');
      await page.waitForSelector('h2:has-text("Historial de activaciones")');
      await page.click('.nav button:has-text("Configuración")');
      await page.waitForSelector('h2:has-text("API Key de SMSPVA")');

      // 7. Remote UI control via HTTP API
      const cmdHeaders = { 'x-smspva-token': localToken, 'Content-Type': 'application/json' };
      const navRes = await fetch(`${baseUrl}/api/ui/command`, {
        method: 'POST',
        headers: cmdHeaders,
        body: JSON.stringify({ action: 'navigate', section: 'operacion' }),
      });
      assert.equal((await navRes.json()).ok, true);
      await page.waitForSelector('h2:has-text("Pedir número")');

      await fetch(`${baseUrl}/api/ui/command`, {
        method: 'POST',
        headers: cmdHeaders,
        body: JSON.stringify({ action: 'toggleCatchAll', open: true }),
      });
      await page.waitForSelector('.drawer-panel.open');

      await new Promise((r) => setTimeout(r, 150));
      const uiState = await (await fetch(`${baseUrl}/api/ui/state`, { headers: { 'x-smspva-token': localToken } })).json();
      assert.equal(uiState.result.section, 'operacion');
      assert.equal(uiState.result.mailOpen, true);

      assert.equal(buyCalled, false);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('links/creates Excel from Catch-All drawer, generates alias + random password + network, and writes to .xlsx', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smspva-e2e-excel-'));
    const credDir = path.join(dir, 'creds');
    const dataDir = path.join(dir, 'data');
    const createdXlsx = path.join(dir, 'CuentasGeneradas.xlsx');
    const namedXlsx = path.join(dir, 'CuentasConNombres.xlsx');
    await createWorkbookFile(namedXlsx, { seedNames: ['Gabriela Vargas Torres'] });

    await mkdir(credDir, { recursive: true });
    await writeFile(
      path.join(credDir, 'smspva-imap.json'),
      JSON.stringify({
        provider: 'hostinger',
        host: 'imap.hostinger.com',
        port: 993,
        domain: 'kiwyresident.com',
        user: 'contacto@kiwyresident.com',
        pass: 'dummy-pass',
      }),
      'utf8',
    );

    const smspvaFetch = async (url) => {
      const target = String(url);
      if (target.includes('/userinfo')) {
        return jsonResponse({ statusCode: 200, data: { balance: '26.4500', name: 'Ana Rojas', karma: 30 } });
      }
      if (target.includes('/orders')) {
        return jsonResponse({
          statusCode: 200,
          data: {
            orders: [
              {
                orderId: 99001,
                phoneNumber: '9611759151',
                countryCode: '+52',
                orderExpireIn: 185,
                service: 'opt16',
                country: 'MX',
                status: 'PENDING_SMS',
                sms: { code: null, fullText: null },
              },
            ],
          },
        });
      }
      if (target.includes('/sms/')) {
        return jsonResponse({ statusCode: 202, error: { type: 'SMS_NOT_YET_RECEIVED', description: 'Waiting for SMS' } });
      }
      if (target.includes('/servicesprices')) {
        return jsonResponse({
          statusCode: 200,
          data: [
            { service: 'opt16', serviceDescription: 'Instagram', country: 'MX', price: '0.60' },
          ],
        });
      }
      return jsonResponse({ statusCode: 200, data: { clist: [] } });
    };

    const { server, localToken } = await createServer({
      credentialsDir: credDir,
      dataDir,
      accessGateOptions: { enabled: false },
      smspvaClientOptions: { apiKey: 'e2e-mock-key', fetchImpl: smspvaFetch, minIntervalMs: 0 },
      excelDialogOptions: {
        saveFile: async () => ({ cancelled: false, filePath: createdXlsx }),
        pickFile: async () => ({ cancelled: false, filePath: namedXlsx }),
      },
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ channel: 'chrome', headless: true });

    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      let imapPollCount = 0;
      await page.route('**/api/imap/messages**', (route) => {
        imapPollCount += 1;
        const urlObj = new URL(route.request().url());
        const toVal = urlObj.searchParams.get('to') || '';
        const items =
          toVal && imapPollCount >= 2
            ? [
                {
                  uid: 101,
                  date: new Date().toISOString(),
                  from: 'security@mail.instagram.com',
                  to: toVal,
                  subject: '654321 is your Instagram code',
                  text: 'Use 654321 to verify your account.',
                  code: '654321',
                },
              ]
            : [];
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ result: items }),
        });
      });

      await page.goto(`${baseUrl}/#token=${localToken}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('text=Expira en 03:');
      await page.waitForSelector('button:has-text("Copiar sin prefijo")');
      await page.waitForSelector('button:has-text("Cancelar orden")');
      await page.waitForSelector('button:has-text("Bloquear número")');
      await page.click('button:has-text("Instagram")');

      // Click "+ Nuevo correo" -> automatically opens Catch-All drawer and generates alias
      await page.click('button:has-text("+ Nuevo correo")');
      await page.waitForSelector('.drawer-panel.open');
      await page.waitForSelector('text=Ninguno seleccionado');
      await page.waitForSelector('text=Alias listo');

      // Create new Excel -> invokes saveFile dialog & saves pending alias + password + birthdate + Instagram
      await page.click('.drawer-panel button:has-text("Crear nuevo")');
      await page.waitForSelector('text=Fila 2 · Instagram');
      await page.waitForSelector('text=Datos de la sesión');
      await page.waitForSelector('text=Fecha de nacimiento:');
      await page.waitForSelector('button:has-text("Copiar prefijo")');
      await page.waitForSelector('button:has-text("Copiar número")');

      // Generate a second alias -> writes directly to Row 3
      await page.click('.drawer-panel button:has-text("+ Generar y copiar alias")');
      await page.waitForSelector('text=Fila 3 · Instagram');

      const rows = await readWorkbookRows(createdXlsx);
      assert.equal(rows.length, 3);
      assert.equal(rows[0].A, 'Correo');
      assert.equal(rows[0].B, 'Contraseña');
      assert.equal(rows[0].C, 'Red');
      assert.equal(rows[0].D, 'Fecha de nacimiento');

      assert.match(rows[1].A, /@kiwyresident\.com$/);
      assert.ok(rows[1].B.length >= 12);
      assert.equal(rows[1].C, 'Instagram');
      assert.match(rows[1].D, /^\d{2}\/\d{2}\/\d{4}$/);

      assert.match(rows[2].A, /@kiwyresident\.com$/);
      assert.ok(rows[2].B.length >= 12);
      assert.notEqual(rows[1].B, rows[2].B);
      assert.equal(rows[2].C, 'Instagram');
      assert.match(rows[2].D, /^\d{2}\/\d{2}\/\d{4}$/);

      // Switch to existing Excel with Nombre column -> generates human alias using Gabriela Vargas Torres
      await page.click('.drawer-panel button:has-text("Cambiar")');
      await page.click('.drawer-panel button:has-text("+ Generar y copiar alias")');
      await page.waitForSelector('text=Gabriela Vargas Torres');
      await page.waitForSelector('button:has-text("Copiar nombre")');
      await page.waitForSelector('button:has-text("Copiar correo")');

      // Wait for 2-second poll to populate the right-side code textbox
      await page.waitForFunction(() => {
        const el = document.querySelector('input[aria-label="Código recibido"]');
        return el && el.value === '654321';
      }, { timeout: 6000 });

      const namedRows = await readWorkbookRows(namedXlsx);
      assert.match(namedRows[1].A, /(gabriela|vargas|torres|gvargas).*@kiwyresident\.com$/);
      assert.equal(namedRows[1].C, 'Instagram');
      assert.equal(namedRows[1].D, 'Gabriela Vargas Torres');
      assert.match(namedRows[1].E, /^\d{2}\/\d{2}\/\d{4}$/);

      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
