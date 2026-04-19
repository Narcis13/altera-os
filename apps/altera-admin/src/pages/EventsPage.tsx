import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { type RealtimeTransport, useRealtime } from '../realtime';

const EVENT_TYPES = [
  'file.uploaded',
  'entity.created',
  'entity.classified',
  'workflow.started',
  'workflow.completed',
  'report.rendered',
  'report.published',
] as const;

const SAMPLE_PAYLOADS: Record<(typeof EVENT_TYPES)[number], unknown> = {
  'file.uploaded': {
    fileId: 'fil_demo',
    name: 'demo.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1234,
    hashSha256: 'demo',
  },
  'entity.created': { entityId: 'ent_demo', entityType: 'doc' },
  'entity.classified': { entityId: 'ent_demo', classification: 'invoice', confidence: 0.93 },
  'workflow.started': { workflowId: 'wf_demo', runId: 'run_demo' },
  'workflow.completed': { workflowId: 'wf_demo', runId: 'run_demo', status: 'success' },
  'report.rendered': { reportId: 'rpt_demo', format: 'pdf' },
  'report.published': { reportId: 'rpt_demo', destination: 's3://bucket/key' },
};

export function EventsPage() {
  const [transport, setTransport] = useState<RealtimeTransport>('sse');
  const [topicFilter, setTopicFilter] = useState<string[]>([]);
  const [emitType, setEmitType] = useState<(typeof EVENT_TYPES)[number]>('file.uploaded');
  const [emitting, setEmitting] = useState(false);
  const [emitError, setEmitError] = useState<string | null>(null);

  const realtime = useRealtime({ transport, topics: topicFilter });

  function toggleTopic(t: string) {
    setTopicFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function onEmit() {
    setEmitting(true);
    setEmitError(null);
    try {
      await api.debugEmit({ type: emitType, payload: SAMPLE_PAYLOADS[emitType] });
    } catch (e) {
      setEmitError((e as Error).message);
    } finally {
      setEmitting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
        <div>
          <h1 className="text-lg font-semibold">Events — Realtime Debug</h1>
          <p className="text-xs text-slate-500">SSE / WS event stream</p>
        </div>
        <Link to="/" className="text-sm text-slate-600 hover:underline">
          ← Dashboard
        </Link>
      </header>

      <main className="p-6 grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-xl bg-white border border-slate-200 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Transport</div>
            <div className="flex gap-2 text-sm">
              {(['sse', 'ws'] as const).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setTransport(t)}
                  className={`px-3 py-1.5 rounded-md border ${
                    transport === t
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="mt-3 text-xs">
              status: <StatusBadge status={realtime.status} />
              {realtime.error && (
                <div className="text-red-600 mt-1 break-words">{realtime.error}</div>
              )}
            </div>
          </section>

          <section className="rounded-xl bg-white border border-slate-200 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
              Topics filter
            </div>
            <p className="text-xs text-slate-500 mb-2">Empty = all</p>
            <div className="space-y-1 text-sm">
              {EVENT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={topicFilter.includes(t)}
                    onChange={() => toggleTopic(t)}
                  />
                  <span className="font-mono text-xs">{t}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-xl bg-white border border-slate-200 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Emit (debug)</div>
            <select
              value={emitType}
              onChange={(e) => setEmitType(e.target.value as (typeof EVENT_TYPES)[number])}
              className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 mb-2"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onEmit}
              disabled={emitting}
              className="w-full rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
            >
              {emitting ? 'Emitting…' : 'Emit sample event'}
            </button>
            {emitError && <div className="text-red-600 text-xs mt-2">{emitError}</div>}
          </section>
        </aside>

        <section className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Live events ({realtime.events.length})
            </div>
            <button
              type="button"
              onClick={realtime.clear}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Clear
            </button>
          </div>
          {realtime.events.length === 0 ? (
            <div className="text-sm text-slate-500 py-8 text-center">
              Waiting for events. Emit one to see it appear.
            </div>
          ) : (
            <ul className="space-y-2 max-h-[70vh] overflow-y-auto">
              {realtime.events.map((ev) => (
                <li
                  key={ev.id}
                  className="border border-slate-200 rounded-md p-2 text-xs font-mono"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{ev.type}</span>
                    <span className="text-slate-500">
                      {new Date(ev.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-slate-500 truncate">{ev.id}</div>
                  <pre className="mt-1 overflow-x-auto text-[11px] text-slate-700 whitespace-pre-wrap break-all">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'open'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'connecting' || status === 'idle'
        ? 'bg-slate-100 text-slate-700'
        : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono ${color}`}>
      {status}
    </span>
  );
}
