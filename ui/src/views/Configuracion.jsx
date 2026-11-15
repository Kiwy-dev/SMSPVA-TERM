import { useState } from 'react';
import * as api from '../api.js';

export default function Configuracion({ smspva, access, update, network, onRefreshState, flash }) {
  const [apiKey, setApiKey] = useState('');
  const [apiConsent, setApiConsent] = useState(true);

  const [accessToken, setAccessToken] = useState('');
  const [accessConsent, setAccessConsent] = useState(true);

  const [updateToken, setUpdateToken] = useState('');
  const [updateConsent, setUpdateConsent] = useState(true);

  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await onRefreshState();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const copyShareUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      flash('Enlace de Tailscale copiado al portapapeles.');
    } catch {
      flash('No se pudo copiar el enlace.', true);
    }
  };

  return (
    <div className="grid-2">
      <div className="stack">
        <div className="card">
          <h2>API Key de SMSPVA</h2>
        <p className="muted">
          Estado: <strong>{smspva.configured ? 'Configurada y validada' : 'Pendiente'}</strong>
          {smspva.account?.name ? ` · Cuenta: ${smspva.account.name}` : ''}
        </p>

        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.post('/api/smspva/apikey', { apiKey, persistConsent: apiConsent });
              setApiKey('');
              flash('API key de SMSPVA validada y guardada.');
            });
          }}
        >
          <label className="field">
            <span>{smspva.configured ? 'Reemplazar API key' : 'Nueva API key'}</span>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Pega tu apikey de SMSPVA"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>

          <label className="check">
            <input type="checkbox" checked={apiConsent} onChange={(e) => setApiConsent(e.target.checked)} />
            <span>Guardar localmente en ~/.credentials/smspva-api.env con permisos restringidos.</span>
          </label>

          <div className="row">
            <button type="submit" className="primary" disabled={busy || !apiKey.trim()}>
              Validar y guardar
            </button>
            {smspva.configured && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.del('/api/smspva/apikey');
                    flash('API key eliminada.');
                  })
                }
              >
                Borrar API key
              </button>
            )}
          </div>
        </form>
        </div>

        <div className="card">
          <h2>Acceso remoto (Tailscale)</h2>
          <p className="muted">
            Puerto activo: <strong>{network?.port || 47820}</strong> · Solo permite conexiones desde{' '}
            <strong>localhost</strong> y la red <strong>Tailscale (100.64.0.0/10)</strong>.
          </p>
          {network?.shareUrls?.length > 0 ? (
            <div className="stack">
              {network.shareUrls.map((url) => (
                <div key={url} className="code-box">
                  <span className="mono selectable" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                    {url}
                  </span>
                  <button type="button" className="primary" onClick={() => copyShareUrl(url)}>
                    Copiar enlace
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">
              Tailscale no detectado aún en esta PC. Cuando conectes Tailscale, recarga o presiona Actualizar para ver tu enlace remoto.
            </p>
          )}
          <div>
            <button type="button" className="secondary" disabled={busy} onClick={() => run(async () => {})}>
              Detectar Tailscale
            </button>
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <h2>Bloqueo por token (AccessGate)</h2>
          <p className="muted">
            Repositorio: <strong>{access?.repository}</strong> · Estado:{' '}
            <strong>{access?.unlocked ? 'Desbloqueado' : 'Bloqueado'}</strong>
          </p>
          {access?.error && <p className="muted">{access.error}</p>}

          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.post('/api/access/unlock', { token: accessToken, persistConsent: accessConsent });
                setAccessToken('');
                flash('Token de acceso validado.');
              });
            }}
          >
            <label className="field">
              <span>Token privado de issues (Kiwy-dev/kiwyrium-reportes)</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="github_pat_..."
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={accessConsent} onChange={(e) => setAccessConsent(e.target.checked)} />
              <span>Guardar en ~/.credentials/kiwyrium-reports.env</span>
            </label>
            <div className="row">
              <button type="submit" className="primary" disabled={busy || !accessToken.trim()}>
                Guardar token de acceso
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post('/api/access/recheck', {});
                    flash('Acceso verificado con GitHub.');
                  })
                }
              >
                Revalidar ahora
              </button>
            </div>
          </form>
        </div>

        <div className="card">
          <h2>Actualizaciones (Releases privadas)</h2>
          <p className="muted">
            Versión actual: <strong>v{update?.currentVersion || '0.1.0'}</strong> · Estado:{' '}
            <strong>{update?.state || 'idle'}</strong>
            {update?.availableVersion ? ` · Disponible: v${update.availableVersion}` : ''}
          </p>
          {update?.error && <p className="muted">{update.error}</p>}
          {update?.downloadedPath && <p className="muted">Descargado en: {update.downloadedPath}</p>}

          <div className="row">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const res = await api.post('/api/updates/check', {});
                  flash(
                    res.result?.availableVersion
                      ? `Nueva versión disponible: v${res.result.availableVersion}`
                      : 'Ya tienes la última versión.',
                  );
                })
              }
            >
              Buscar actualizaciones
            </button>
            {update?.state === 'available' && (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post('/api/updates/download', {});
                    flash('Actualización descargada y verificada con SHA-256.');
                  })
                }
              >
                Descargar v{update.availableVersion}
              </button>
            )}
          </div>

          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.post('/api/updates/token', { token: updateToken, persistConsent: updateConsent });
                setUpdateToken('');
                flash('Token de releases guardado.');
              });
            }}
          >
            <label className="field">
              <span>Token de releases ({update?.tokenConfigured ? 'configurado' : 'pendiente'})</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="github_pat_... (solo lectura en releases)"
                value={updateToken}
                onChange={(e) => setUpdateToken(e.target.value)}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={updateConsent} onChange={(e) => setUpdateConsent(e.target.checked)} />
              <span>Guardar en ~/.credentials/smspva-update.env</span>
            </label>
            <div className="row">
              <button type="submit" className="secondary" disabled={busy || !updateToken.trim()}>
                Guardar token de releases
              </button>
              {update?.tokenConfigured && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.del('/api/updates/token');
                      flash('Token de releases eliminado.');
                    })
                  }
                >
                  Borrar token
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
