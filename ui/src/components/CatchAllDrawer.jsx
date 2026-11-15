import { useCallback, useEffect, useState } from 'react';
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

export default function CatchAllDrawer({ open, onClose, imap, onImapChange, flash }) {
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

  const loadMessages = useCallback(
    async (filterValue = toFilter) => {
      if (!imap?.configured) return;
      setBusy(true);
      try {
        const qs = filterValue ? `?to=${encodeURIComponent(filterValue)}` : '';
        const res = await api.get(`/api/imap/messages${qs}`);
        setMessages(res.result || []);
      } catch (err) {
        flash(err.message, true);
      } finally {
        setBusy(false);
      }
    },
    [imap?.configured, toFilter, flash],
  );

  useEffect(() => {
    if (open && imap?.configured && !editing) {
      loadMessages();
    }
  }, [open, imap?.configured, editing, loadMessages]);

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

  const handleGenerateAlias = async () => {
    const dom = imap?.domain || (imap?.user?.includes('@') ? imap.user.split('@')[1] : '');
    const alias = randomAlias(dom);
    setToFilter(alias);
    try {
      await navigator.clipboard.writeText(alias);
      flash(`Alias generado y copiado: ${alias}`);
    } catch {
      flash(`Alias generado: ${alias}`);
    }
  };

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
              <div className="row">
                <button type="button" className="primary" onClick={handleGenerateAlias}>
                  + Generar y copiar alias
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={() => loadMessages()}>
                  {busy ? 'Leyendo…' : 'Refrescar'}
                </button>
              </div>

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
                      {m.code && (
                        <div className="code-box">
                          <div>
                            <div className="muted" style={{ fontSize: 11 }}>Código detectado</div>
                            <strong className="mono selectable">{m.code}</strong>
                          </div>
                          <button type="button" className="primary" onClick={() => copyText(m.code, 'Código')}>
                            Copiar
                          </button>
                        </div>
                      )}
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
          )}
        </div>
      </aside>
    </>
  );
}
