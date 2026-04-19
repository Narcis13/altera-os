import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type EntityAttribute,
  type EntityDetailResponse,
  type EntityListItem,
  type EntityListParams,
  type EntitySearchHit,
  type EntityStatus,
  type TaxonomyResponse,
  api,
} from '../api';

const PAGE_SIZE = 25;
const ALL_STATUSES: EntityStatus[] = ['raw', 'classified', 'structured', 'archived'];

function StatusPill({ status }: { status: EntityStatus }) {
  const color =
    status === 'classified'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'structured'
        ? 'bg-indigo-100 text-indigo-700'
        : status === 'archived'
          ? 'bg-slate-200 text-slate-600'
          : 'bg-amber-100 text-amber-700';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono ${color}`}>
      {status}
    </span>
  );
}

function formatValue(attr: EntityAttribute): React.ReactNode {
  if (attr.valueText !== null) return attr.valueText;
  if (attr.valueNumber !== null) return String(attr.valueNumber);
  if (attr.valueDate !== null) return new Date(attr.valueDate).toLocaleString();
  if (attr.valueJson !== null) {
    return (
      <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-700">
        {JSON.stringify(attr.valueJson, null, 2)}
      </pre>
    );
  }
  return <span className="text-slate-400">—</span>;
}

export function EntitiesPage() {
  const [entityType, setEntityType] = useState('');
  const [statuses, setStatuses] = useState<EntityStatus[]>([]);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [period, setPeriod] = useState('');
  const [offset, setOffset] = useState(0);

  const [entities, setEntities] = useState<EntityListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(null);
  const [ftsHits, setFtsHits] = useState<EntitySearchHit[]>([]);

  const params: EntityListParams = useMemo(() => {
    const p: EntityListParams = { limit: PAGE_SIZE, offset };
    if (entityType) p.entityType = entityType;
    if (statuses.length > 0) p.status = statuses;
    if (search) p.search = search;
    return p;
  }, [entityType, statuses, search, offset]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await api.listEntities(params);
      let filtered = res.entities;
      if (period) {
        filtered = filtered.filter((e) => (e.name ?? '').includes(period));
      }
      setEntities(filtered);
      setTotal(res.total);
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [params, period]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    api
      .getTaxonomy()
      .then((t) => {
        if (!cancelled) setTaxonomy(t);
      })
      .catch(() => {
        if (!cancelled) setTaxonomy(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api
      .getEntity(selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setDetailError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function runFts() {
    const q = searchInput.trim();
    if (!q) {
      setSearch('');
      setFtsHits([]);
      setOffset(0);
      return;
    }
    try {
      const res = await api.searchEntities(q, 50);
      setFtsHits(res.hits);
      setSearch(q);
      setOffset(0);
    } catch (e) {
      setListError((e as Error).message);
    }
  }

  function clearFts() {
    setSearchInput('');
    setSearch('');
    setFtsHits([]);
    setOffset(0);
  }

  function toggleStatus(s: EntityStatus) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
    setOffset(0);
  }

  const activeEntityTypes = taxonomy?.entries.map((e) => e.entityType) ?? [];
  const defaults = taxonomy?.defaults ?? [];
  const typeOptions = Array.from(new Set([...activeEntityTypes, ...defaults])).sort();

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
        <div>
          <h1 className="text-lg font-semibold">Entities — EAV browser</h1>
          <p className="text-xs text-slate-500">
            Classified entities + their attributes, with full-text search.
          </p>
        </div>
        <Link to="/" className="text-sm text-slate-600 hover:underline">
          ← Dashboard
        </Link>
      </header>

      <main className="p-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="space-y-4 min-w-0">
          <div className="rounded-xl bg-white border border-slate-200 p-4 space-y-3">
            <div>
              <label htmlFor="ent-search" className="text-xs uppercase tracking-wide text-slate-500">
                Full-text search
              </label>
              <div className="flex gap-2 mt-1">
                <input
                  id="ent-search"
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runFts();
                  }}
                  placeholder="invoice 2024 logistics…"
                  className="flex-1 text-sm border border-slate-300 rounded-md px-2 py-1.5"
                />
                <button
                  type="button"
                  onClick={() => void runFts()}
                  className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5"
                >
                  Search
                </button>
                {search && (
                  <button
                    type="button"
                    onClick={clearFts}
                    className="rounded-md border border-slate-300 text-sm px-3 py-1.5"
                  >
                    Clear
                  </button>
                )}
              </div>
              {search && ftsHits.length > 0 && (
                <div className="mt-2 text-xs text-slate-500">
                  Top FTS matches:
                  <ul className="space-y-1 mt-1 max-h-32 overflow-y-auto">
                    {ftsHits.slice(0, 8).map((h) => (
                      <li key={h.attributeId}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(h.entityId)}
                          className="text-left hover:underline"
                          dangerouslySetInnerHTML={{ __html: h.snippet }}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                Entity type
              </div>
              <select
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value);
                  setOffset(0);
                }}
                className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5"
              >
                <option value="">Any</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Status</div>
              <div className="flex flex-wrap gap-2">
                {ALL_STATUSES.map((s) => (
                  <label key={s} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={statuses.includes(s)}
                      onChange={() => toggleStatus(s)}
                    />
                    <span className="font-mono">{s}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="period-filter" className="text-xs uppercase tracking-wide text-slate-500">
                Period (name contains)
              </label>
              <input
                id="period-filter"
                type="text"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setOffset(0);
                }}
                placeholder="2024-Q1"
                className="w-full mt-1 text-sm border border-slate-300 rounded-md px-2 py-1.5"
              />
            </div>
          </div>

          <div className="rounded-xl bg-white border border-slate-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div className="text-xs uppercase tracking-wide text-slate-500">Entities</div>
              <div className="text-xs text-slate-500">
                {loading ? 'loading…' : `${entities.length} shown · ${total} total`}
              </div>
            </div>
            {listError && <div className="px-4 py-3 text-xs text-red-600">{listError}</div>}
            <ul className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
              {entities.length === 0 && !loading && (
                <li className="px-4 py-6 text-sm text-slate-500 text-center">
                  No entities match these filters.
                </li>
              )}
              {entities.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${
                      selectedId === e.id ? 'bg-slate-100' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-slate-900">
                        {e.name ?? e.id}
                      </span>
                      <StatusPill status={e.status} />
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 truncate">
                      {e.entityType ?? '—'}
                      {e.classificationConfidence !== null
                        ? ` · conf=${e.classificationConfidence.toFixed(2)}`
                        : ''}
                      {` · ${new Date(e.ingestedAt).toLocaleString()}`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-xs">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-slate-500">offset {offset}</span>
              <button
                type="button"
                disabled={entities.length < PAGE_SIZE}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-4 min-w-0">
          {!selectedId && (
            <div className="text-sm text-slate-500 py-16 text-center">
              Select an entity on the left to see its attributes.
            </div>
          )}
          {selectedId && detailLoading && (
            <div className="text-sm text-slate-500 py-6">Loading…</div>
          )}
          {detailError && <div className="text-sm text-red-600">{detailError}</div>}
          {detail && (
            <div className="space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Entity</div>
                <div className="text-base font-medium text-slate-900 break-all">
                  {detail.entity.name ?? detail.entity.id}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs font-mono text-slate-500 flex-wrap">
                  <StatusPill status={detail.entity.status} />
                  <span>{detail.entity.entityType ?? 'unclassified'}</span>
                  {detail.entity.classificationConfidence !== null && (
                    <span>conf={detail.entity.classificationConfidence.toFixed(2)}</span>
                  )}
                  <span>{new Date(detail.entity.ingestedAt).toLocaleString()}</span>
                  {detail.entity.sourceFileId && (
                    <span className="truncate">file={detail.entity.sourceFileId}</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                  Attributes ({detail.attributes.length})
                </div>
                <div className="border border-slate-200 rounded-md divide-y divide-slate-100">
                  {detail.attributes.map((a) => (
                    <div key={a.id} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 font-mono">{a.key}</span>
                        <span className="text-slate-500">
                          {a.extractedBy}
                          {a.confidence !== null ? ` · conf=${a.confidence.toFixed(2)}` : ''}
                          {a.isSensitive ? ' · sensitive' : ''}
                        </span>
                      </div>
                      <div className="mt-1 text-slate-700 whitespace-pre-wrap break-words">
                        {formatValue(a)}
                      </div>
                    </div>
                  ))}
                  {detail.attributes.length === 0 && (
                    <div className="px-3 py-4 text-center text-slate-500">
                      No attributes on this entity.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
