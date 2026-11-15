import { useMemo, useState } from 'react';

export default function OperatorPicker({
  operators = [],
  value,
  disabled,
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
    () => operators.find((o) => o.opcode === value) || null,
    [operators, value],
  );

  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const recentOrder = useMemo(() => new Map(recents.map((code, idx) => [code, idx])), [recents]);

  const visibleOperators = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = operators.filter((o) => {
      if (filterMode === 'favorites' && !favSet.has(o.opcode)) return false;
      if (filterMode === 'recents' && !recentOrder.has(o.opcode)) return false;
      if (!q) return true;
      return String(o.opcode || '').toLowerCase().includes(q);
    });

    list = [...list].sort((a, b) => {
      const pa = Number(a.price);
      const pb = Number(b.price);
      if (sortMode === 'price-asc') return pa - pb || a.opcode.localeCompare(b.opcode, 'es');
      if (sortMode === 'price-desc') return pb - pa || a.opcode.localeCompare(b.opcode, 'es');
      if (filterMode === 'recents') {
        return (recentOrder.get(a.opcode) ?? 999) - (recentOrder.get(b.opcode) ?? 999);
      }
      return a.opcode.localeCompare(b.opcode, 'es');
    });
    return list;
  }, [operators, search, filterMode, sortMode, favSet, recentOrder]);

  return (
    <div className="field">
      <span>Operador (opcional)</span>

      <button
        type="button"
        className="country-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <span className="country-trigger-main">
            <strong>{selected.opcode}</strong>
            <span className="muted">
              · precio {selected.price} · stock {Number(selected.count) === 9999 ? 'alto' : selected.count}
            </span>
          </span>
        ) : (
          <span className="muted">
            {disabled ? 'Selecciona un país primero' : 'Automático (cualquier operador disponible)'}
          </span>
        )}
        <span className="muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && !disabled && (
        <div className="country-menu">
          <div className="country-controls">
            <input
              type="search"
              placeholder="Buscar operador (ej. Telcel, AT&T, Any)…"
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
                  Todos ({operators.length})
                </button>
                <button
                  type="button"
                  className={`chip-btn ${filterMode === 'favorites' ? 'active' : ''}`}
                  onClick={() => setFilterMode('favorites')}
                >
                  ★ Favoritos ({operators.filter((o) => favSet.has(o.opcode)).length})
                </button>
                <button
                  type="button"
                  className={`chip-btn ${filterMode === 'recents' ? 'active' : ''}`}
                  onClick={() => setFilterMode('recents')}
                >
                  Recientes ({operators.filter((o) => recentOrder.has(o.opcode)).length})
                </button>
              </div>

              <select
                className="sort-select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                aria-label="Ordenar operadores"
              >
                <option value="name">Orden: A–Z</option>
                <option value="price-asc">Precio: más barato a caro</option>
                <option value="price-desc">Precio: más caro a barato</option>
              </select>
            </div>
          </div>

          <div className="country-list">
            {filterMode === 'all' && !search.trim() && (
              <div className={`country-item ${value === '' ? 'active' : ''}`}>
                <button
                  type="button"
                  className="country-pick"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  <span className="country-name">
                    <strong>Automático</strong> <span className="muted">(cualquier operador disponible)</span>
                  </span>
                </button>
              </div>
            )}

            {visibleOperators.length === 0 ? (
              <p className="muted" style={{ padding: 10 }}>
                Sin operadores en esta vista.
              </p>
            ) : (
              visibleOperators.map((o) => {
                const isFav = favSet.has(o.opcode);
                const isSelected = o.opcode === value;
                return (
                  <div key={o.opcode} className={`country-item ${isSelected ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="country-pick"
                      onClick={() => {
                        onChange(o.opcode);
                        setOpen(false);
                      }}
                    >
                      <span className="country-name">
                        <strong>{o.opcode}</strong>
                      </span>
                      <span className="country-meta">
                        <strong>{o.price}</strong> · stock {Number(o.count) === 9999 ? 'alto' : o.count}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`fav-star ${isFav ? 'active' : ''}`}
                      onClick={() => onToggleFavorite(o.opcode)}
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
