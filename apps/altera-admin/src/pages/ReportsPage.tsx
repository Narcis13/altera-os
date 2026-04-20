import { useEffect, useState } from 'react';
import { type DocsRenderDetail, type DocsRenderListItem, api } from '../api';
import { AppShell } from '../components/AppShell';

export function ReportsPage() {
  const [items, setItems] = useState<DocsRenderListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocsRenderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api
      .listRenders({ limit: 50 })
      .then((r) => setItems(r.items))
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setBusy(true);
    api
      .getRender(selectedId)
      .then((r) => setDetail(r.render))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }, [selectedId]);

  async function onPublish() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api.publishRender(detail.id);
      const r = await api.getRender(detail.id);
      setDetail(r.render);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onDownloadHtml() {
    if (!detail) return;
    const blob = new Blob([detail.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${detail.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell title="Reports" subtitle="Generated document renders">
      <div className="p-4 grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-xl bg-white border border-slate-200">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-slate-500">Renders</div>
            <button
              type="button"
              onClick={refresh}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              refresh
            </button>
          </div>
          <ul className="divide-y divide-slate-100 max-h-[80vh] overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-6 text-xs text-slate-500 text-center">No renders yet.</li>
            )}
            {items.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${
                    selectedId === r.id ? 'bg-slate-100' : ''
                  }`}
                >
                  <div className="text-sm font-mono truncate">{r.id}</div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-2">
                    <StatusPill status={r.status} />
                    {r.publishedAt && (
                      <span className="text-emerald-700">published</span>
                    )}
                    <span>{new Date(r.renderedAt).toLocaleString()}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="rounded-xl bg-white border border-slate-200 flex flex-col min-w-0">
          {!selectedId && (
            <div className="text-sm text-slate-500 py-16 text-center">
              Select a render on the left.
            </div>
          )}
          {selectedId && (
            <>
              <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono truncate">{detail?.id ?? selectedId}</div>
                  <div className="text-[11px] text-slate-500">
                    {detail && (
                      <>
                        rendered {new Date(detail.renderedAt).toLocaleString()}
                        {detail.publishedAt && (
                          <span className="text-emerald-700 ml-2">
                            · published {new Date(detail.publishedAt).toLocaleString()}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onDownloadHtml}
                    disabled={!detail || busy}
                    className="rounded-md border border-slate-300 text-xs px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Download HTML
                  </button>
                  <button
                    type="button"
                    onClick={onPublish}
                    disabled={!detail || busy || detail.status !== 'success' || !!detail.publishedAt}
                    className="rounded-md bg-emerald-700 text-white text-xs px-2 py-1 disabled:opacity-40"
                  >
                    {detail?.publishedAt ? 'Published' : 'Publish'}
                  </button>
                </div>
              </div>
              {error && <div className="px-3 py-2 text-xs text-red-600">{error}</div>}
              {detail?.errors && detail.errors.length > 0 && (
                <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b">
                  <div className="font-semibold">Render warnings:</div>
                  <pre className="text-[10px] whitespace-pre-wrap break-all">
                    {JSON.stringify(detail.errors, null, 2)}
                  </pre>
                </div>
              )}
              {detail && (
                <iframe
                  title="render"
                  className="flex-1 w-full min-h-[70vh] border-0"
                  srcDoc={detail.html}
                />
              )}
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function StatusPill({ status }: { status: 'success' | 'error' }) {
  const cls =
    status === 'success'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-block rounded px-1 py-0.5 font-mono text-[9px] ${cls}`}>
      {status}
    </span>
  );
}
