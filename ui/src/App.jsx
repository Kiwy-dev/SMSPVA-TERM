import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import Configuracion from './views/Configuracion.jsx';
import Historial from './views/Historial.jsx';
import Operacion from './views/Operacion.jsx';

export default function App() {
  const [section, setSection] = useState('operacion');
  const [state, setState] = useState(null);
  const [notice, setNotice] = useState(null);
  const [unlockToken, setUnlockToken] = useState('');
  const [unlockConsent, setUnlockConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [remoteCmd, setRemoteCmd] = useState(null);
  const timerRef = useRef(0);

  const flash = useCallback((text, error = false) => {
    setNotice({ text, error });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  const refreshState = useCallback(async () => {
    const res = await api.get('/api/state');
    setState(res);
  }, []);

  useEffect(() => {
    refreshState().catch((err) => flash(err.message, true));
  }, [refreshState, flash]);

  useEffect(() => {
    const token = api.resolveSessionToken();
    if (!token) return;
    const es = new EventSource(`/api/ui/events?token=${encodeURIComponent(token)}`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type !== 'command') return;
        if (msg.action === 'navigate' && msg.section) {
          setSection(msg.section);
        } else {
          setRemoteCmd({ ...msg, _ts: Date.now() + Math.random() });
        }
      } catch {
        /* ignore malformed event */
      }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    api.post('/api/ui/report', { section }).catch(() => {});
  }, [section]);

  const handleUnlock = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/access/unlock', { token: unlockToken, persistConsent: unlockConsent });
      setUnlockToken('');
      await refreshState();
      flash('Acceso desbloqueado.');
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="lock-screen">
        <div className="card lock-card">
          <h2>Conectando…</h2>
          <p className="muted">Iniciando servidor local de SMSPVA.</p>
          {notice && <div className={`notice ${notice.error ? 'error' : ''}`}>{notice.text}</div>}
        </div>
      </div>
    );
  }

  if (state.locked) {
    return (
      <div className="lock-screen">
        <div className="card lock-card">
          <div className="brand">
            <div className="brand-badge">SP</div>
            <div>
              <strong>SMSPVA · Acceso privado</strong>
              <small>{state.access?.repository}</small>
            </div>
          </div>
          <p className="muted">{state.access?.error || 'Ingresa el token privado de acceso para continuar.'}</p>
          {notice && <div className={`notice ${notice.error ? 'error' : ''}`}>{notice.text}</div>}
          <form className="stack" onSubmit={handleUnlock}>
            <label className="field">
              <span>Token de acceso (github_pat_...)</span>
              <input
                type="password"
                autoComplete="new-password"
                value={unlockToken}
                onChange={(e) => setUnlockToken(e.target.value)}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={unlockConsent} onChange={(e) => setUnlockConsent(e.target.checked)} />
              <span>Guardar en ~/.credentials/kiwyrium-reports.env</span>
            </label>
            <button type="submit" className="primary" disabled={busy || !unlockToken.trim()}>
              {busy ? 'Verificando…' : 'Desbloquear'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const account = state.smspva?.account;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-badge">SP</div>
          <div>
            <strong>SMSPVA</strong>
            <small>Activation v2</small>
          </div>
        </div>

        <nav className="nav">
          <button
            type="button"
            className={section === 'operacion' ? 'active' : ''}
            onClick={() => setSection('operacion')}
          >
            Operación
          </button>
          <button
            type="button"
            className={section === 'historial' ? 'active' : ''}
            onClick={() => setSection('historial')}
          >
            Historial ({(state.history || []).length})
          </button>
          <button
            type="button"
            className={section === 'configuracion' ? 'active' : ''}
            onClick={() => setSection('configuracion')}
          >
            Configuración
          </button>
        </nav>

        <div className="sidebar-foot">
          <strong>{account?.name || 'Sin sesión SMSPVA'}</strong>
          <span className="muted">Saldo: {account?.balance ?? '—'}</span>
          {account?.karma !== undefined && <span className="muted">Karma: {account.karma}</span>}
          <span className="muted" style={{ fontSize: 12 }}>v{state.update?.currentVersion || '0.1.0'}</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{section === 'operacion' ? 'Operación' : section === 'historial' ? 'Historial' : 'Configuración'}</h1>
          <div className="pills">
            <span className="pill primary">Saldo: {account?.balance ?? '—'}</span>
            {account?.karma !== undefined && <span className="pill">Karma: {account.karma}</span>}
            <span className="pill">{state.access?.unlocked ? 'Acceso OK' : 'Bloqueado'}</span>
          </div>
        </header>

        {notice && (
          <div className={`notice ${notice.error ? 'error' : ''}`}>
            <span>{notice.text}</span>
            <button type="button" className="ghost" onClick={() => setNotice(null)}>
              Cerrar
            </button>
          </div>
        )}

        {section === 'operacion' ? (
          <Operacion
            smspva={state.smspva}
            imap={state.imap || { configured: false }}
            excel={state.excel || { configured: false, filePath: '', exists: false }}
            presets={state.presets || []}
            countryPrefs={state.countryPrefs || { favorites: [], recents: [] }}
            operatorPrefs={state.operatorPrefs || { favorites: [], recents: [] }}
            remoteCmd={remoteCmd}
            onPresetsChange={(presets) => setState((curr) => ({ ...curr, presets }))}
            onCountryPrefsChange={(countryPrefs) => setState((curr) => ({ ...curr, countryPrefs }))}
            onOperatorPrefsChange={(operatorPrefs) => setState((curr) => ({ ...curr, operatorPrefs }))}
            onHistoryChange={(history) => setState((curr) => ({ ...curr, history }))}
            onImapChange={(imap) => setState((curr) => ({ ...curr, imap }))}
            onExcelChange={(excel) => setState((curr) => ({ ...curr, excel }))}
            onAccountUpdate={(nextAccount) =>
              setState((curr) => ({ ...curr, smspva: { ...curr.smspva, configured: true, account: nextAccount } }))
            }
            onGoSettings={() => setSection('configuracion')}
            flash={flash}
          />
        ) : section === 'historial' ? (
          <Historial
            history={state.history || []}
            onHistoryChange={(history) => setState((curr) => ({ ...curr, history }))}
            flash={flash}
          />
        ) : (
          <Configuracion
            smspva={state.smspva}
            access={state.access}
            update={state.update}
            network={state.network}
            onRefreshState={refreshState}
            flash={flash}
          />
        )}
      </main>
    </div>
  );
}
