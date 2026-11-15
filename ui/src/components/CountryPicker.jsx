import { useMemo, useState } from 'react';

function flagUrl(ccode) {
  const raw = String(ccode || '').trim().toLowerCase();
  if (!raw) return '';
  const iso = raw === 'uk' ? 'gb' : raw;
  return `https://flagcdn.com/24x18/${iso}.png`;
}

function CountryFlag({ ccode }) {
  const [failed, setFailed] = useState(false);
  const url = flagUrl(ccode);
  if (!url || failed) {
    return <span className="flag-fallback">{String(ccode || '?').slice(0, 2).toUpperCase()}</span>;
  }
  return (
    <img
      className="flag-img"
      src={url}
      alt={ccode}
      width={20}
      height={15}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function CountryPicker({
  countries,
  value,
  disabled,
  loading,
  favorites = [],
  recents = [],
  onChange,
  onToggleFavorite,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'favorites' | 'recents'
  const [sortMode, setSortMode] = useState('name'); // 'name' | 'price-asc' | 'price-desc'

  const selected = useMemo(
    () => countries.find((c) => c.ccode === value) || null,
    [countries, value],
  );

  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const recentOrder = useMemo(() => new Map(recents.map((code, idx) => [code, idx])), [recents]);

  const visibleCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = countries.filter((c) => {
      if (filterMode === 'favorites' && !favSet.has(c.ccode)) return false;
      if (filterMode === 'recents' && !recentOrder.has(c.ccode)) return false;
      if (!q) return true;
      return c.cname.toLowerCase().includes(q) || c.ccode.toLowerCase().includes(q);
    });

    list = [...list].sort((a, b) => {
      if (sortMode === 'price-asc') return a.minPrice - b.minPrice || a.cname.localeCompare(b.cname, 'es');
      if (sortMode === 'price-desc') return b.minPrice - a.minPrice || a.cname.localeCompare(b.cname, 'es');
      if (filterMode === 'recents') {
        return (recentOrder.get(a.ccode) ?? 999) - (recentOrder.get(b.ccode) ?? 999);
      }
      return a.cname.localeCompare(b.cname, 'es');
    });
    return list;
  }, [countries, search, filterMode, sortMode, favSet, recentOrder]);

  return (
    <div className="field">
      <span>País {loading ? '(cargando precios…)' : ''}</span>

      <button
        type="button"
        className="country-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <span className="country-trigger-main">
            <CountryFlag ccode={selected.ccode} />
            <strong>{selected.cname}</strong>
            <span className="muted">({selected.ccode}) · desde {selected.minPrice} · stock {selected.totalCount}</span>
          </span>
        ) : (
          <span className="muted">{disabled ? 'Selecciona un servicio primero' : '— Selecciona un país —'}</span>
        )}
        <span className="muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && !disabled && (
        <div className="country-menu">
          <div className="country-controls">
            <input
              type="search"
              placeholder="Buscar país o código (ej. MX, Colombia)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                <button
                  type="button"
                  className={`chip-btn ${filterMode === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterMode('all')}
                >
                  Todos ({countries.length})
                </button>
                <button
                  type="button"
                  className={`chip-btn ${filterMode === 'favorites' ? 'active' : ''}`}
                  onClick={() => setFilterMode('favorites')}
                >
                  ★ Favoritos ({countries.filter((c) => favSet.has(c.ccode)).length})
                </button>
                <button
                  type="button"
                  className={`chip-btn ${filterMode === 'recents' ? 'active' : ''}`}
                  onClick={() => setFilterMode('recents')}
                >
                  Recientes ({countries.filter((c) => recentOrder.has(c.ccode)).length})
                </button>
              </div>

              <select
                className="sort-select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                aria-label="Ordenar países"
              >
                <option value="name">Orden: A–Z</option>
                <option value="price-asc">Precio: más barato a caro</option>
                <option value="price-desc">Precio: más caro a barato</option>
              </select>
            </div>
          </div>

          <div className="country-list">
            {visibleCountries.length === 0 ? (
              <p className="muted" style={{ padding: 10 }}>
                Sin países en esta vista.
              </p>
            ) : (
              visibleCountries.map((c) => {
                const isFav = favSet.has(c.ccode);
                const isSelected = c.ccode === value;
                return (
                  <div key={c.ccode} className={`country-item ${isSelected ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="country-pick"
                      onClick={() => {
                        onChange(c.ccode);
                        setOpen(false);
                      }}
                    >
                      <CountryFlag ccode={c.ccode} />
                      <span className="country-name">
                        <strong>{c.cname}</strong> <span className="muted">({c.ccode})</span>
                      </span>
                      <span className="country-meta">
                        <strong>{c.minPrice}</strong> · stock {c.totalCount}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`fav-star ${isFav ? 'active' : ''}`}
                      onClick={() => onToggleFavorite(c.ccode)}
                      title={isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}
                    >
                      {isFav ? '★' : '☆'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
