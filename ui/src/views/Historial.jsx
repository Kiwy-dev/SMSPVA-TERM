import { useState } from 'react';
import * as api from '../api.js';

function formatPhone(item) {
  const prefix = String(item?.countryCode || '').trim();
  const num = String(item?.phoneNumber || '').trim();
  if (!num) return '—';
  if (/^\+?\d+$/.test(prefix)) return `+${prefix.replace(/^\+/, '')}${num}`;
  return prefix ? `(${prefix}) ${num}` : num;
}

export default function Historial({ history = [], onHistoryChange, flash }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const q = query.trim().toLowerCase();
  const visible = q
    ? history.filter((item) =>
        [item.orderId, item.service, item.country, item.operator, item.phoneNumber, item.code, item.status]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(q)),
      )
    : history;

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(String(text));
      flash(`${label} copiado: ${text}`);
    } catch {
      flash('No se pudo copiar al portapapeles.', true);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      const res = await api.del('/api/history');
      onHistoryChange(res.result || []);
      flash('Historial limpiado.');
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Historial de activaciones ({history.length})</h2>
        {history.length > 0 && (
          <button type="button" className="danger" disabled={busy} onClick={handleClear}>
            Limpiar historial
          </button>
        )}
      </div>

      {history.length > 0 && (
        <label className="field">
          <input
            type="search"
            placeholder="Filtrar por orden, servicio, país, número, código o estado…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}

      {visible.length === 0 ? (
        <p className="muted">No hay activaciones registradas todavía.</p>
      ) : (
        <div className="stack">
          {visible.map((item) => {
            const phone = formatPhone(item);
            return (
              <div key={item.orderId} className="order-card">
                <div className="card-head">
                  <strong>
                    Orden #{item.orderId} · {item.service || 'Servicio'}
                    {item.country ? ` · ${item.country}` : ''}
                    {item.operator ? ` (${item.operator})` : ''}
                  </strong>
                  <span className="pill">{item.status || 'Registrado'}</span>
                </div>

                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="row">
                    <span className="mono" style={{ fontWeight: 600 }}>{phone}</span>
                    {phone !== '—' && (
                      <button type="button" className="secondary" onClick={() => copyText(phone, 'Número')}>
                        Copiar número
                      </button>
                    )}
                    {item.code && (
                      <button type="button" className="primary" onClick={() => copyText(item.code, 'Código')}>
                        OTP: {item.code}
                      </button>
                    )}
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleString('es-MX') : ''}
                  </span>
                </div>

                {item.fullText && (
                  <p className="muted" style={{ fontSize: 12 }}>{item.fullText}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
