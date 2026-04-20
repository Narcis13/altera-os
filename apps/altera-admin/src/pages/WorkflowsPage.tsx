import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { sessionStore } from '../api';

interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowRun {
  id: string;
  workflowName: string;
  workflowVersion: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  visitedSteps: number;
  elapsedMs: number;
}

const SAMPLE_YAML = `version: "1.0"
name: hello
steps:
  - id: greet
    kind: assign
    set:
      message: "Hello, \${input.name ?? 'world'}!"
  - id: done
    kind: return
    output:
      message: \${state.message}
`;

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = sessionStore.get();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (session) headers.set('authorization', `Bearer ${session.accessToken}`);
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export function WorkflowsPage() {
  const [defs, setDefs] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [yaml, setYaml] = useState(SAMPLE_YAML);
  const [input, setInput] = useState('{\n  "name": "Altera"\n}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<unknown>(null);

  function refresh() {
    apiFetch<{ definitions: WorkflowDefinition[] }>('/api/flows/definitions')
      .then((r) => setDefs(r.definitions))
      .catch((e) => setError(e.message));
    apiFetch<{ items: WorkflowRun[] }>('/api/flows/runs?limit=20')
      .then((r) => setRuns(r.items))
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onRun() {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = input.trim() ? JSON.parse(input) : {};
    } catch (e) {
      setError(`Invalid input JSON: ${(e as Error).message}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ run: unknown }>('/api/flows/runs', {
        method: 'POST',
        body: JSON.stringify({ yaml, input: parsedInput }),
      });
      setLastRun(r.run);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Workflows" subtitle="glyphrail definitions + recent runs">
      <div className="p-4 grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl bg-white border border-slate-200 flex flex-col">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Adhoc workflow YAML
            </div>
            <button
              type="button"
              onClick={onRun}
              disabled={busy}
              className="rounded-md bg-slate-900 text-white text-xs px-3 py-1.5 disabled:opacity-40"
            >
              Run
            </button>
          </div>
          <textarea
            spellCheck={false}
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            className="font-mono text-[12px] p-3 resize-none focus:outline-none min-h-[20rem]"
          />
          <div className="px-3 py-2 border-t border-slate-200">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
              Input (JSON)
            </div>
            <textarea
              spellCheck={false}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full h-20 font-mono text-[11px] rounded border border-slate-200 p-2 resize-none focus:outline-none"
            />
          </div>
          {error && <div className="px-3 py-2 text-xs text-red-600">{error}</div>}
          {lastRun !== null && (
            <div className="px-3 py-2 border-t border-slate-200">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                Last run
              </div>
              <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
                {JSON.stringify(lastRun, null, 2)}
              </pre>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="rounded-xl bg-white border border-slate-200">
            <div className="px-3 py-2 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              Definitions
            </div>
            <ul className="divide-y divide-slate-100">
              {defs.length === 0 && (
                <li className="px-4 py-4 text-xs text-slate-500 text-center">No definitions yet.</li>
              )}
              {defs.map((d) => (
                <li key={d.id} className="px-3 py-2 text-sm">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-[11px] font-mono text-slate-500">
                    v{d.version} · {d.source}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-white border border-slate-200">
            <div className="px-3 py-2 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              Recent runs
            </div>
            <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {runs.length === 0 && (
                <li className="px-4 py-4 text-xs text-slate-500 text-center">No runs yet.</li>
              )}
              {runs.map((r) => (
                <li key={r.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.workflowName}</span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {r.visitedSteps} steps · {r.elapsedMs}ms ·{' '}
                    {new Date(r.startedAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'completed'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'failed' || status === 'timed_out'
        ? 'bg-red-100 text-red-700'
        : status === 'running' || status === 'paused'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block rounded px-1 py-0.5 font-mono text-[9px] ${cls}`}>
      {status}
    </span>
  );
}
