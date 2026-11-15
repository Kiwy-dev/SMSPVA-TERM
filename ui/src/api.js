const STORAGE_KEY = 'smspva_local_token';

export function resolveSessionToken() {
  const hash = window.location.hash || '';
  const match = /token=([a-f0-9]+)/i.exec(hash);
  if (match) {
    sessionStorage.setItem(STORAGE_KEY, match[1]);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return match[1];
  }
  return sessionStorage.getItem(STORAGE_KEY) || '';
}

async function request(method, path, body) {
  const token = resolveSessionToken();
  const res = await fetch(path, {
    method,
    headers: {
      'x-smspva-token': token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const get = (path) => request('GET', path);
export const post = (path, body) => request('POST', path, body);
export const del = (path) => request('DELETE', path);
