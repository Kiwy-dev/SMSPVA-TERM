import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import CatchAllDrawer from '../components/CatchAllDrawer.jsx';
import CountryPicker from '../components/CountryPicker.jsx';
import OperatorPicker from '../components/OperatorPicker.jsx';

const COMMON_APPS = [
  { code: 'opt2', label: 'Facebook', badge: 'f', color: '#1877F2' },
  { code: 'opt16', label: 'Instagram', badge: 'IG', color: '#E1306C' },
  { code: 'opt20', label: 'WhatsApp', badge: 'WA', color: '#25D366' },
  { code: 'opt1', label: 'Google', badge: 'G', color: '#4285F4' },
  { code: 'opt29', label: 'Telegram', badge: 'TG', color: '#0088CC' },
  { code: 'opt104', label: 'TikTok', badge: 'TT', color: '#111111' },
  { code: 'opt41', label: 'X / Twitter', badge: 'X', color: '#0F1419' },
  { code: 'opt45', label: 'Discord', badge: 'DC', color: '#5865F2' },
  { code: 'opt15', label: 'Microsoft', badge: 'MS', color: '#0078D4' },
  { code: 'opt132', label: 'OpenAI', badge: 'AI', color: '#10A37F' },
  { code: 'opt83', label: 'PayPal', badge: 'PP', color: '#003087' },
];

function formatPhone(order) {
  const prefix = String(order?.countryCode || '').trim();
  const num = String(order?.phoneNumber || '').trim();
  if (!num) return '—';
  if (/^\+?\d+$/.test(prefix)) return `+${prefix.replace(/^\+/, '')}${num}`;
  return prefix ? `(${prefix}) ${num}` : num;
}

function withExpiry(order) {
  const rawSec = Number(order?.orderExpireIn);
  const sec = Number.isFinite(rawSec) && rawSec > 0 ? rawSec : 600;
  return { ...order, _expiresAt: Date.now() + sec * 1000 };
}

function formatCountdown(remainingMs) {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const sec = String(totalSec % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

export default function Operacion({
  smspva,
  imap = { configured: false },
  excel = { configured: false, filePath: '', exists: false },
  presets,
  countryPrefs = { favorites: [], recents: [] },
  operatorPrefs = { favorites: [], recents: [] },
  remoteCmd = null,
  onPresetsChange,
  onCountryPrefsChange,
  onOperatorPrefsChange,
  onHistoryChange,
  onImapChange,
  onExcelChange,
  onAccountUpdate,
  onGoSettings,
  flash,
}) {
  const [services, setServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [query, setQuery] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [serviceCode, setServiceCode] = useState('');

  const [countries, setCountries] = useState([]);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [countryCode, setCountryCode] = useState('');
  const [operatorCode, setOperatorCode] = useState('');
  const [voice, setVoice] = useState(0);

  const [orders, setOrders] = useState([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [newEmailSeq, setNewEmailSeq] = useState(0);

  useEffect(() => {
    if (orders.length === 0) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [orders.length]);

  useEffect(() => {
    if (!remoteCmd) return;
    if (remoteCmd.action === 'toggleCatchAll') {
      setMailOpen((curr) => (typeof remoteCmd.open === 'boolean' ? remoteCmd.open : !curr));
    } else if (remoteCmd.action === 'selectService') {
      setServiceCode(String(remoteCmd.service || ''));
      setOperatorCode('');
      setShowMore(false);
    } else if (remoteCmd.action === 'selectCountry') {
      setCountryCode(String(remoteCmd.country || ''));
      setOperatorCode('');
    } else if (remoteCmd.action === 'selectOperator') {
      setOperatorCode(String(remoteCmd.operator || ''));
    } else if (remoteCmd.action === 'toggleMoreServices') {
      setShowMore((curr) => (typeof remoteCmd.open === 'boolean' ? remoteCmd.open : !curr));
    }
  }, [remoteCmd]);

  useEffect(() => {
    api.post('/api/ui/report', { mailOpen, serviceCode, countryCode, operatorCode }).catch(() => {});
  }, [mailOpen, serviceCode, countryCode, operatorCode]);

  const loadServices = useCallback(
    async (force = false) => {
      if (!smspva.configured) return;
      setLoadingServices(true);
      try {
        const res = await api.get(`/api/smspva/services${force ? '?force=1' : ''}`);
        setServices(res.result || []);
      } catch (err) {
        flash(err.message, true);
      } finally {
        setLoadingServices(false);
      }
    },
    [smspva.configured, flash],
  );

  const loadOrders = useCallback(async () => {
    if (!smspva.configured) return;
    try {
      const res = await api.get('/api/smspva/orders');
      setOrders((res.result || []).map(withExpiry));
    } catch {
      /* silent refresh */
    }
  }, [smspva.configured]);

  useEffect(() => {
    if (smspva.configured) {
      loadServices(false);
      loadOrders();
    }
  }, [smspva.configured, loadServices, loadOrders]);

  useEffect(() => {
    if (!serviceCode || !smspva.configured) {
      setCountries([]);
      return;
    }
    let cancelled = false;
    setLoadingPrices(true);
    api
      .get(`/api/smspva/prices/${encodeURIComponent(serviceCode)}`)
      .then((res) => {
        if (cancelled) return;
        const list = res.result || [];
        setCountries(list);
        if (!list.some((c) => c.ccode === countryCode)) {
          setCountryCode(list[0]?.ccode || '');
        }
      })
      .catch((err) => {
        if (!cancelled) flash(err.message, true);
      })
      .finally(() => {
        if (!cancelled) setLoadingPrices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceCode, smspva.configured, flash]);

  const filteredServices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services.slice(0, 120);
    return services.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)).slice(0, 120);
  }, [services, query]);

  const selectedService = useMemo(() => services.find((s) => s.code === serviceCode) || null, [services, serviceCode]);
  const selectedCountry = useMemo(() => countries.find((c) => c.ccode === countryCode) || null, [countries, countryCode]);
  const selectedOperator = useMemo(
    () => selectedCountry?.opers?.find((o) => o.opcode === operatorCode) || null,
    [selectedCountry, operatorCode],
  );

  // Polling automático cada 2s para órdenes que aún esperan SMS.
  useEffect(() => {
    if (!smspva.configured || orders.length === 0) return;
    const pending = orders.filter((o) => !(o.sms && o.sms.code));
    if (pending.length === 0) return;

    const timer = setInterval(async () => {
      for (const ord of pending) {
        try {
          const res = await api.get(`/api/smspva/orders/${encodeURIComponent(ord.orderId)}/sms`);
          if (res.result?.sms?.code) {
            setOrders((curr) => curr.map((x) => (x.orderId === ord.orderId ? { ...x, sms: res.result.sms } : x)));
            if (res.history && onHistoryChange) onHistoryChange(res.history);
            flash(`SMS recibido para orden ${ord.orderId}: ${res.result.sms.code}`);
          }
        } catch {
          /* next tick */
        }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [orders, smspva.configured, flash]);

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(String(text));
      flash(`${label} copiado: ${text}`);
    } catch {
      flash('No se pudo copiar al portapapeles.', true);
    }
  };

  const recordRecentCountry = useCallback(
    async (code) => {
      if (!code) return;
      const nextRecents = [code, ...(countryPrefs.recents || []).filter((c) => c !== code)].slice(0, 12);
      try {
        const res = await api.post('/api/country-prefs', { recents: nextRecents });
        if (res.result) onCountryPrefsChange(res.result);
      } catch {
        /* best effort */
      }
    },
    [countryPrefs.recents, onCountryPrefsChange],
  );

  const toggleFavoriteCountry = useCallback(
    async (code) => {
      const current = countryPrefs.favorites || [];
      const nextFavorites = current.includes(code) ? current.filter((c) => c !== code) : [code, ...current];
      try {
        const res = await api.post('/api/country-prefs', { favorites: nextFavorites });
        if (res.result) onCountryPrefsChange(res.result);
      } catch (err) {
        flash(err.message, true);
      }
    },
    [countryPrefs.favorites, onCountryPrefsChange, flash],
  );

  const recordRecentOperator = useCallback(
    async (code) => {
      if (!code) return;
      const nextRecents = [code, ...(operatorPrefs.recents || []).filter((c) => c !== code)].slice(0, 12);
      try {
        const res = await api.post('/api/operator-prefs', { recents: nextRecents });
        if (res.result) onOperatorPrefsChange(res.result);
      } catch {
        /* best effort */
      }
    },
    [operatorPrefs.recents, onOperatorPrefsChange],
  );

  const toggleFavoriteOperator = useCallback(
    async (code) => {
      const current = operatorPrefs.favorites || [];
      const nextFavorites = current.includes(code) ? current.filter((c) => c !== code) : [code, ...current];
      try {
        const res = await api.post('/api/operator-prefs', { favorites: nextFavorites });
        if (res.result) onOperatorPrefsChange(res.result);
      } catch (err) {
        flash(err.message, true);
      }
    },
    [operatorPrefs.favorites, onOperatorPrefsChange, flash],
  );

  const handleBuy = async (opts = {}) => {
    const targetService = opts.service || serviceCode;
    const targetCountry = opts.country || countryCode;
    const targetOperator = opts.operator !== undefined ? opts.operator : operatorCode;
    const targetVoice = opts.voice !== undefined ? opts.voice : voice;
    if (!targetService || !targetCountry) return;

    setBusy(true);
    try {
      const res = await api.post('/api/smspva/orders', {
        service: targetService,
        country: targetCountry,
        operator: targetOperator,
        voice: targetVoice,
      });
      if (res.account) onAccountUpdate(res.account);
      if (res.history && onHistoryChange) onHistoryChange(res.history);
      if (res.result) {
        const nextOrder = withExpiry(res.result);
        setOrders((curr) => [nextOrder, ...curr.filter((o) => o.orderId !== nextOrder.orderId)]);
        recordRecentCountry(targetCountry);
        if (targetOperator) recordRecentOperator(targetOperator);
        flash(`Número asignado: ${formatPhone(nextOrder)}`);
      }
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleSavePreset = async () => {
    if (!selectedService || !selectedCountry) return;
    try {
      const res = await api.post('/api/presets', {
        label: `${selectedService.name} · ${selectedCountry.ccode}${operatorCode ? ` (${operatorCode})` : ''}`,
        service: selectedService.code,
        serviceName: selectedService.name,
        country: selectedCountry.ccode,
        countryName: selectedCountry.cname,
        operator: operatorCode,
        voice,
      });
      onPresetsChange(res.result || []);
      flash('Favorito guardado.');
    } catch (err) {
      flash(err.message, true);
    }
  };

  const handleDeletePreset = async (id) => {
    try {
      const res = await api.del(`/api/presets/${encodeURIComponent(id)}`);
      onPresetsChange(res.result || []);
    } catch (err) {
      flash(err.message, true);
    }
  };

  const orderAction = async (order, action) => {
    setBusy(true);
    try {
      const res = await api.post(`/api/smspva/orders/${encodeURIComponent(order.orderId)}/${action}`, {});
      if (res.account) onAccountUpdate(res.account);
      if (res.history && onHistoryChange) onHistoryChange(res.history);
      if (action === 'cancel' || action === 'block') {
        setOrders((curr) => curr.filter((o) => o.orderId !== order.orderId));
        flash(action === 'cancel' ? `Orden ${order.orderId} cancelada.` : `Número ${order.orderId} reportado.`);
      } else if (action === 'clear') {
        setOrders((curr) => curr.map((o) => (o.orderId === order.orderId ? { ...o, sms: null } : o)));
        flash(`Esperando otro SMS en orden ${order.orderId}.`);
      }
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleRepeat = async (order) => {
    if (!order.phoneNumber || !order.service) return;
    setBusy(true);
    try {
      const res = await api.post('/api/smspva/repeat', {
        number: order.phoneNumber,
        service: order.service,
      });
      if (res.account) onAccountUpdate(res.account);
      if (res.history && onHistoryChange) onHistoryChange(res.history);
      if (res.result) {
        const nextOrder = withExpiry(res.result);
        setOrders((curr) => [nextOrder, ...curr]);
        flash(`Número repetido: ${formatPhone(nextOrder)}`);
      }
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  if (!smspva.configured) {
    return (
      <div className="card">
        <h2>API Key requerida</h2>
        <p className="muted">Configura tu API key de SMSPVA en la pestaña de Configuración para empezar a pedir números.</p>
        <div>
          <button type="button" className="primary" onClick={onGoSettings}>
            Ir a Configuración
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {presets.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Favoritos (1 clic)</h2>
          </div>
          <div className="preset-list">
            {presets.map((p) => (
              <div key={p.id} className="preset-chip">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    setServiceCode(p.service);
                    setCountryCode(p.country);
                    setOperatorCode(p.operator || '');
                    setVoice(p.voice || 0);
                    handleBuy(p);
                  }}
                >
                  {p.label}
                </button>
                <button type="button" className="ghost" onClick={() => handleDeletePreset(p.id)} title="Eliminar">
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Pedir número</h2>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setMailOpen(true);
                  setNewEmailSeq((n) => n + 1);
                }}
              >
                + Nuevo correo
              </button>
              <button type="button" className="ghost" disabled={loadingServices} onClick={() => loadServices(true)}>
                {loadingServices ? 'Cargando…' : 'Actualizar catálogo'}
              </button>
            </div>
          </div>

          <div className="field">
            <span>Selecciona una app</span>
            <div className="app-grid">
              {COMMON_APPS.map((app) => {
                const active = serviceCode === app.code && !showMore;
                return (
                  <button
                    key={app.code}
                    type="button"
                    className={`app-tile ${active ? 'active' : ''}`}
                    onClick={() => {
                      setServiceCode(app.code);
                      setOperatorCode('');
                      setShowMore(false);
                    }}
                  >
                    <span className="app-icon" style={{ background: app.color }}>
                      {app.badge}
                    </span>
                    <span>{app.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className={`app-tile ${showMore ? 'active' : ''}`}
                onClick={() => setShowMore((curr) => !curr)}
              >
                <span className="app-icon" style={{ background: '#65676b' }}>
                  +
                </span>
                <span>… más</span>
              </button>
            </div>
          </div>

          {showMore && (
            <>
              <label className="field">
                <span>Buscar servicio / app</span>
                <input
                  type="search"
                  autoFocus
                  placeholder="Ej. Uber, Amazon, Snapchat, opt72…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>

              <label className="field">
                <span>Servicio ({filteredServices.length} mostrados)</span>
                <select value={serviceCode} onChange={(e) => { setServiceCode(e.target.value); setOperatorCode(''); }}>
                  <option value="">— Selecciona un servicio —</option>
                  {filteredServices.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name} ({s.code}) {s.minPrice != null ? `· desde ${s.minPrice}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <CountryPicker
            countries={countries}
            value={countryCode}
            disabled={!serviceCode || loadingPrices}
            loading={loadingPrices}
            favorites={countryPrefs.favorites || []}
            recents={countryPrefs.recents || []}
            onChange={(code) => {
              setCountryCode(code);
              setOperatorCode('');
              recordRecentCountry(code);
            }}
            onToggleFavorite={toggleFavoriteCountry}
          />

          <OperatorPicker
            operators={selectedCountry?.opers || []}
            value={operatorCode}
            disabled={!selectedCountry}
            favorites={operatorPrefs.favorites || []}
            recents={operatorPrefs.recents || []}
            onChange={(code) => {
              setOperatorCode(code);
              if (code) recordRecentOperator(code);
            }}
            onToggleFavorite={toggleFavoriteOperator}
          />

          <label className="field">
            <span>Tipo de activación</span>
            <select value={voice} onChange={(e) => setVoice(Number(e.target.value))}>
              <option value={0}>SMS estándar (voice=0)</option>
              <option value={1}>Caller-ID (voice=1)</option>
              <option value={2}>Llamada de voz (voice=2)</option>
            </select>
          </label>

          {selectedCountry && (
            <p className="muted">
              Precio estimado:{' '}
              <strong>{selectedOperator ? selectedOperator.price : selectedCountry.minPrice}</strong> por activación.
            </p>
          )}

          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={busy || !serviceCode || !countryCode}
              onClick={() => handleBuy()}
            >
              {busy ? 'Procesando…' : 'Pedir número'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!selectedService || !selectedCountry}
              onClick={handleSavePreset}
            >
              Guardar favorito
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Órdenes activas ({orders.length})</h2>
            <button type="button" className="ghost" onClick={loadOrders}>
              Refrescar
            </button>
          </div>

          {orders.length === 0 ? (
            <p className="muted">No hay órdenes activas en este momento. Cuando pidas un número aparecerá aquí con monitoreo automático cada 2 segundos.</p>
          ) : (
            <div className="stack">
              {orders.map((ord) => {
                const fullPhone = formatPhone(ord);
                const rawPhone = String(ord.phoneNumber || '').trim();
                const code = ord.sms?.code;
                const remainingMs = ord._expiresAt ? Math.max(0, ord._expiresAt - nowMs) : null;
                const expiringSoon = remainingMs !== null && remainingMs <= 60_000;
                return (
                  <div key={ord.orderId} className="order-card">
                    <div className="card-head">
                      <strong>
                        Orden #{ord.orderId} · {ord.service || 'Servicio'}
                      </strong>
                      <div className="row" style={{ gap: 6 }}>
                        {remainingMs !== null && !code && (
                          <span
                            className="pill"
                            style={
                              expiringSoon
                                ? { background: '#fee2e2', color: '#b91c1c', fontWeight: 600 }
                                : undefined
                            }
                          >
                            {remainingMs > 0 ? `Expira en ${formatCountdown(remainingMs)}` : 'Por expirar'}
                          </span>
                        )}
                        <span className="pill">{ord.status || (code ? 'Recibido' : 'Esperando SMS')}</span>
                      </div>
                    </div>

                    <div className="row">
                      <span className="mono selectable" style={{ fontSize: 16, fontWeight: 600 }}>
                        {fullPhone}
                      </span>
                      <button type="button" className="secondary" onClick={() => copyText(fullPhone, 'Número')}>
                        Copiar número
                      </button>
                      {rawPhone && (
                        <button
                          type="button"
                          className="secondary"
                          title="Útil si la app ya tiene seleccionado el país (+52, +44, etc.)"
                          onClick={() => copyText(rawPhone, 'Número sin prefijo')}
                        >
                          Copiar sin prefijo
                        </button>
                      )}
                    </div>

                    {code ? (
                      <div className="code-box">
                        <div>
                          <div className="muted" style={{ fontSize: 12 }}>Código OTP</div>
                          <strong className="mono selectable">{code}</strong>
                        </div>
                        <button type="button" className="primary" onClick={() => copyText(code, 'Código')}>
                          Copiar código
                        </button>
                      </div>
                    ) : (
                      <p className="muted">Consultando SMS cada 2s…</p>
                    )}

                    {ord.sms?.fullText && <p className="muted selectable" style={{ fontSize: 12 }}>{ord.sms.fullText}</p>}

                    <div className="row">
                      {code && (
                        <>
                          <button type="button" className="secondary" disabled={busy} onClick={() => orderAction(ord, 'clear')}>
                            Otro SMS
                          </button>
                          <button type="button" className="secondary" disabled={busy} onClick={() => handleRepeat(ord)}>
                            Repetir número
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        title="Cancela la orden antes de recibir SMS y libera el número sin marcarlo como malo"
                        onClick={() => orderAction(ord, 'cancel')}
                      >
                        Cancelar orden
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        title="Reporta que el número no sirve o ya está registrado en la app para que no te lo vuelvan a dar"
                        onClick={() => orderAction(ord, 'block')}
                      >
                        Bloquear número
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <button type="button" className="drawer-tab" onClick={() => setMailOpen(true)}>
        Correos Catch-All
      </button>

      <CatchAllDrawer
        open={mailOpen}
        onClose={() => setMailOpen(false)}
        imap={imap}
        onImapChange={onImapChange}
        excel={excel}
        onExcelChange={onExcelChange}
        activeOrder={orders[0] || null}
        autoGenerateSeq={newEmailSeq}
        selectedNetwork={
          selectedService?.label ||
          selectedService?.name ||
          COMMON_APPS.find((a) => a.code === serviceCode)?.label ||
          ''
        }
        flash={flash}
      />
    </div>
  );
}
