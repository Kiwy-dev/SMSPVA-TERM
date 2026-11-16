import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api.js';

const PROVIDERS = {
  hostinger: {
    label: 'Hostinger Mail (Catch-All)',
    host: 'imap.hostinger.com',
    port: '993',
    hint: 'Ideal para tu buzón catch-all de Hostinger.',
  },
  google: {
    label: 'Google / Gmail',
    host: 'imap.gmail.com',
    port: '993',
    hint: 'Requiere Contraseña de aplicación (App Password) de Google.',
  },
  outlook: {
    label: 'Outlook / Hotmail',
    host: 'outlook.office365.com',
    port: '993',
    hint: 'Para cuentas con IMAP básico habilitado (Microsoft 365 / Outlook).',
  },
};

function randomAlias(domain) {
  const cleanDomain = String(domain || '').trim() || 'tudominio.com';
  const suffix = Math.random().toString(36).slice(2, 7);
  const num = Math.floor(100 + Math.random() * 900);
  return `u${num}${suffix}@${cleanDomain}`;
}

function fileNameFromPath(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

export default function CatchAllDrawer({
  open,
  onClose,
  imap,
  onImapChange,
  excel = { configured: false, filePath: '', exists: false },
  onExcelChange = () => {},
  selectedNetwork = '',
  activeOrder = null,
  autoGenerateSeq = 0,
  flash,
}) {
  const [provider, setProvider] = useState(imap?.provider || 'hostinger');
  const [host, setHost] = useState(imap?.host || 'imap.hostinger.com');
  const [port, setPort] = useState(String(imap?.port || 993));
  const [domain, setDomain] = useState(imap?.domain || '');
  const [user, setUser] = useState(imap?.user || '');
  const [pass, setPass] = useState('');
  const [editing, setEditing] = useState(false);

  const [toFilter, setToFilter] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [lastAccount, setLastAccount] = useState(null);
  const [pendingAlias, setPendingAlias] = useState(null);
  const inFlightRef = useRef(false);
  const lastAutoSeqRef = useRef(0);

  const loadMessages = useCallback(
    async (filterValue = toFilter, { silent = false } = {}) => {
      if (!imap?.configured || inFlightRef.current) return;
      inFlightRef.current = true;
      if (!silent) setBusy(true);
      try {
        const qs = filterValue ? `?to=${encodeURIComponent(filterValue)}` : '';
        const res = await api.get(`/api/imap/messages${qs}`);
        setMessages(res.result || []);
      } catch (err) {
        if (!silent) flash(err.message, true);
      } finally {
        inFlightRef.current = false;
        if (!silent) setBusy(false);
      }
    },
    [imap?.configured, toFilter, flash],
  );

  useEffect(() => {
    if (!open || !imap?.configured || editing) return;
    loadMessages(toFilter);
    const id = setInterval(() => {
      loadMessages(toFilter, { silent: true });
    }, 2000);
    return () => clearInterval(id);
  }, [open, imap?.configured, editing, toFilter, loadMessages]);

  const handleSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const derivedDomain = domain.trim() || (user.includes('@') ? user.split('@')[1] : '');
      const res = await api.post('/api/imap/config', {
        provider,
        host,
        port: Number(port) || 993,
        domain: derivedDomain,
        user,
        pass,
      });
      onImapChange(res.result);
      setPass('');
      setEditing(false);
      flash('Bandeja Catch-All de Hostinger conectada.');
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      const res = await api.del('/api/imap/config');
      onImapChange(res.result);
      setMessages([]);
      setEditing(false);
      flash('Cuenta de correo desconectada.');
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const recordAliasToExcel = async ({ email = '', domain = '', network = '' }) => {
    const res = await api.post('/api/excel/record-account', { email, domain, network });
    setLastAccount(res.result);
    setPendingAlias(null);
    return res.result;
  };

  const handlePickExcel = async () => {
    setExcelBusy(true);
    try {
      const res = await api.post('/api/excel/pick', {});
      const next = res.result;
      if (next?.cancelled) return;
      onExcelChange(next);
      if (pendingAlias) {
        const rec = await recordAliasToExcel({
          domain: pendingAlias.domain,
          network: pendingAlias.network,
        });
        setToFilter(rec.email);
        try {
          await navigator.clipboard.writeText(rec.email);
        } catch {
          /* ignore */
        }
        flash(`Excel vinculado y correo generado (${rec.email}) en fila ${rec.rowNumber}.`);
      } else {
        flash(`Excel vinculado: ${fileNameFromPath(next.filePath)}`);
      }
    } catch (err) {
      flash(err.message, true);
    } finally {
      setExcelBusy(false);
    }
  };

  const handleCreateExcel = async () => {
    setExcelBusy(true);
    try {
      const res = await api.post('/api/excel/create', { defaultName: 'Cuentas.xlsx' });
      const next = res.result;
      if (next?.cancelled) return;
      onExcelChange(next);
      if (pendingAlias) {
        const rec = await recordAliasToExcel({
          email: pendingAlias.email,
          domain: pendingAlias.domain,
          network: pendingAlias.network,
        });
        flash(`Excel creado y cuenta guardada en fila ${rec.rowNumber}.`);
      } else {
        flash(`Excel creado y vinculado: ${fileNameFromPath(next.filePath)}`);
      }
    } catch (err) {
      flash(err.message, true);
    } finally {
      setExcelBusy(false);
    }
  };

  const handleUnlinkExcel = async () => {
    setExcelBusy(true);
    try {
      const res = await api.del('/api/excel/config');
      onExcelChange(res.result);
      flash('Excel desvinculado.');
    } catch (err) {
      flash(err.message, true);
    } finally {
      setExcelBusy(false);
    }
  };

  const handleGenerateAlias = async () => {
    const dom = imap?.domain || (imap?.user?.includes('@') ? imap.user.split('@')[1] : '');

    if (excel?.configured && excel?.exists) {
      setExcelBusy(true);
      try {
        const rec = await recordAliasToExcel({
          domain: dom || 'tudominio.com',
          network: selectedNetwork,
        });
        setToFilter(rec.email);
        try {
          await navigator.clipboard.writeText(rec.email);
          flash(`Alias copiado y guardado en Excel (fila ${rec.rowNumber}): ${rec.email}`);
        } catch {
          flash(`Alias guardado en Excel (fila ${rec.rowNumber}): ${rec.email}`);
        }
      } catch (err) {
        flash(`No se pudo generar y guardar en Excel: ${err.message}`, true);
      } finally {
        setExcelBusy(false);
      }
      return;
    }

    const alias = randomAlias(dom);
    setToFilter(alias);
    try {
      await navigator.clipboard.writeText(alias);
    } catch {
      /* ignore clipboard failures */
    }
    setPendingAlias({ email: alias, domain: dom || 'tudominio.com', network: selectedNetwork });
    flash(`Alias copiado: ${alias}. Selecciona o crea un Excel para guardar su contraseña.`);
  };

  useEffect(() => {
    if (open && autoGenerateSeq > 0 && autoGenerateSeq !== lastAutoSeqRef.current) {
      lastAutoSeqRef.current = autoGenerateSeq;
      if (imap?.configured && !editing) {
        handleGenerateAlias();
      }
    }
  }, [open, autoGenerateSeq, imap?.configured, editing]);

  const mailCode = messages.find((m) => m.code)?.code || '';
  const smsCode = activeOrder?.sms?.code || '';
  const detectedCode = mailCode || smsCode || '';
  const codeSource = mailCode
    ? 'Detectado en correo Catch-All'
    : smsCode
      ? 'Detectado en SMS activo'
      : 'Revisando correo y SMS cada 2s…';
  const phonePrefix = String(activeOrder?.countryCode || '').trim();
  const phoneWithoutPrefix = String(activeOrder?.phoneNumber || '').trim();

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(String(text));
      flash(`${label} copiado: ${text}`);
    } catch {
      flash('No se pudo copiar al portapapeles.', true);
    }
  };

  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
      <aside className={`drawer-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="drawer-header">
          <div>
            <strong>Correos Catch-All</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {imap?.configured ? imap.user : 'Sin correo configurado'}
            </div>
          </div>
          <div className="row">
            {imap?.configured && (
              <button type="button" className="ghost" onClick={() => setEditing((v) => !v)}>
                {editing ? 'Volver' : 'Cuenta'}
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose}>
              Cerrar →
            </button>
          </div>
        </div>

        <div className="drawer-body">
          {!imap?.configured || editing ? (
            <form className="stack" onSubmit={handleSave}>
              <p className="muted">
                Conecta tu buzón por IMAP para generar alias y leer códigos OTP aquí mismo.
              </p>

              <label className="field">
                <span>Proveedor</span>
                <select
                  value={provider}
                  onChange={(e) => {
                    const next = e.target.value;
                    setProvider(next);
                    if (PROVIDERS[next]) {
                      setHost(PROVIDERS[next].host);
                      setPort(PROVIDERS[next].port);
                    }
                  }}
                >
                  {Object.entries(PROVIDERS).map(([id, info]) => (
                    <option key={id} value={id}>
                      {info.label}
                    </option>
                  ))}
                </select>
              </label>

              {PROVIDERS[provider]?.hint && (
                <p className="muted" style={{ fontSize: 12 }}>
                  {PROVIDERS[provider].hint}
                </p>
              )}

              <label className="field">
                <span>Host IMAP</span>
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.hostinger.com" />
              </label>

              <label className="field">
                <span>Puerto SSL</span>
                <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="993" />
              </label>

              <label className="field">
                <span>Dominio para alias</span>
                <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="tudominio.com" />
              </label>

              <label className="field">
                <span>Correo del buzón Catch-All</span>
                <input
                  type="email"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="catchall@tudominio.com"
                />
              </label>

              <label className="field">
                <span>Contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="Contraseña del correo"
                />
              </label>

              <div className="row">
                <button type="submit" className="primary" disabled={busy || !user.trim() || !pass}>
                  {busy ? 'Conectando…' : 'Probar y guardar'}
                </button>
                {imap?.configured && (
                  <button type="button" className="danger" disabled={busy} onClick={handleDisconnect}>
                    Desconectar
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div className="stack">
              <div
                style={{
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: 'var(--bg-subtle, #f8fafc)',
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Excel vinculado</div>
                    {excel?.configured && excel?.exists ? (
                      <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }} title={excel.filePath}>
                        {fileNameFromPath(excel.filePath)} {selectedNetwork ? `· Red: ${selectedNetwork}` : ''}
                      </div>
                    ) : (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {excel?.configured && !excel?.exists
                          ? 'El archivo vinculado ya no existe.'
                          : 'Ninguno seleccionado (se pedirá dónde guardarlo si creas uno).'}
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                    <button type="button" className="secondary" disabled={excelBusy} onClick={handlePickExcel}>
                      {excel?.configured ? 'Cambiar' : 'Seleccionar'}
                    </button>
                    <button type="button" className="secondary" disabled={excelBusy} onClick={handleCreateExcel}>
                      Crear nuevo
                    </button>
                    {excel?.configured && (
                      <button type="button" className="ghost" disabled={excelBusy} onClick={handleUnlinkExcel}>
                        Desvincular
                      </button>
                    )}
                  </div>
                </div>

                {pendingAlias && (
                  <div className="notice" style={{ marginTop: 8, marginBottom: 0 }}>
                    <div style={{ fontSize: 12 }}>
                      Alias listo (<strong>{pendingAlias.email}</strong>). Selecciona un Excel o crea uno nuevo para guardar su contraseña.
                    </div>
                  </div>
                )}
              </div>

              {(lastAccount || activeOrder || toFilter) && (
                <div className="session-box" aria-label="Datos de la sesión">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13 }}>Datos de la sesión</strong>
                    {lastAccount?.rowNumber && (
                      <span className="pill">
                        Fila {lastAccount.rowNumber} · {lastAccount.network || selectedNetwork || '—'}
                      </span>
                    )}
                  </div>

                  <div className="session-row">
                    <div className="session-val">
                      <strong>Correo:</strong>{' '}
                      <code className="selectable">{lastAccount?.email || toFilter || '—'}</code>
                    </div>
                    {(lastAccount?.email || toFilter) && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => copyText(lastAccount?.email || toFilter, 'Correo')}
                      >
                        Copiar correo
                      </button>
                    )}
                  </div>

                  <div className="session-row">
                    <div className="session-val">
                      <strong>Contraseña:</strong>{' '}
                      <code className="selectable">{lastAccount?.password || '—'}</code>
                    </div>
                    {lastAccount?.password && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => copyText(lastAccount.password, 'Contraseña')}
                      >
                        Copiar clave
                      </button>
                    )}
                  </div>

                  <div className="session-row">
                    <div className="session-val">
                      <strong>Nombre completo:</strong>{' '}
                      <span className="selectable">{lastAccount?.name || '—'}</span>
                    </div>
                    {lastAccount?.name && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => copyText(lastAccount.name, 'Nombre')}
                      >
                        Copiar nombre
                      </button>
                    )}
                  </div>

                  <div className="session-row">
                    <div className="session-val">
                      <strong>Fecha de nacimiento:</strong>{' '}
                      <code className="selectable">{lastAccount?.birthdate || '—'}</code>
                    </div>
                    {lastAccount?.birthdate && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => copyText(lastAccount.birthdate, 'Fecha de nacimiento')}
                      >
                        Copiar fecha
                      </button>
                    )}
                  </div>

                  <div className="session-row">
                    <div className="session-val">
                      <strong>Teléfono:</strong>{' '}
                      <code className="selectable">{phonePrefix || '—'}</code>
                      {' | '}
                      <code className="selectable">{phoneWithoutPrefix || '—'}</code>
                    </div>
                    <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                      {phonePrefix && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => copyText(phonePrefix, 'Prefijo')}
                        >
                          Copiar prefijo
                        </button>
                      )}
                      {phoneWithoutPrefix && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => copyText(phoneWithoutPrefix, 'Número sin prefijo')}
                        >
                          Copiar número
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="row">
                <button type="button" className="primary" disabled={excelBusy} onClick={handleGenerateAlias}>
                  {excelBusy ? 'Guardando…' : '+ Generar y copiar alias'}
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={() => loadMessages()}>
                  {busy ? 'Leyendo…' : 'Refrescar'}
                </button>
              </div>

              <div className="catchall-columns">
                <div className="stack">
                  <label className="field">
                    <span>Filtrar por destinatario (To)</span>
                    <div className="row">
                      <input
                        style={{ flex: 1 }}
                        type="search"
                        placeholder="Ej. 355cc@tudominio.com (vacío = todos)"
                        value={toFilter}
                        onChange={(e) => setToFilter(e.target.value)}
                      />
                      <button type="button" className="secondary" disabled={busy} onClick={() => loadMessages(toFilter)}>
                        Buscar
                      </button>
                    </div>
                  </label>

                  {messages.length === 0 ? (
                    <p className="muted">
                      {busy ? 'Consultando bandeja…' : 'No hay correos recientes que coincidan con el filtro.'}
                    </p>
                  ) : (
                    <div className="stack">
                      {messages.map((m) => (
                        <div key={m.uid} className="order-card">
                          <div className="card-head">
                            <strong style={{ fontSize: 13 }}>{m.subject}</strong>
                            <span className="muted" style={{ fontSize: 11 }}>
                              {m.date ? new Date(m.date).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Para: <span className="selectable">{m.to || '—'}</span>
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            De: {m.from || '—'}
                          </div>
                          {m.text && (
                            <p className="muted selectable" style={{ fontSize: 12 }}>
                              {m.text.slice(0, 280)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="code-panel">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13 }}>Código recibido</strong>
                    <span className="pill">Cada 2s</span>
                  </div>
                  <input
                    type="text"
                    readOnly
                    className="code-textbox"
                    aria-label="Código recibido"
                    value={detectedCode}
                    placeholder="Esperando…"
                  />
                  <div className="muted" style={{ fontSize: 12 }}>
                    {codeSource}
                  </div>
                  <button
                    type="button"
                    className="primary"
                    disabled={!detectedCode}
                    onClick={() => copyText(detectedCode, 'Código')}
                  >
                    Copiar código
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
