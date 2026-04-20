import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type DashboardStats, api } from '../api';
import { AppShell } from '../components/AppShell';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getDashboardStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell title="Dashboard" subtitle="Overview of your tenant">
      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <section>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
            Quick actions
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/ingest"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
            >
              Ingest a file
            </Link>
            <Link
              to="/templates"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
            >
              New template
            </Link>
            <Link
              to="/workflows"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
            >
              New workflow run
            </Link>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Files" value={stats?.counts.files} />
          <Stat label="Entities" value={stats?.counts.entities} />
          <Stat label="Templates" value={stats?.counts.templates} />
          <Stat label="Renders" value={stats?.counts.renders} />
          <Stat label="Workflows" value={stats?.counts.workflows} />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl bg-white border border-slate-200">
            <div className="px-4 py-2 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              Tenant
            </div>
            {stats?.tenant ? (
              <dl className="px-4 py-3 text-sm grid grid-cols-2 gap-y-1">
                <dt className="text-slate-500">Name</dt>
                <dd>{stats.tenant.name}</dd>
                <dt className="text-slate-500">Slug</dt>
                <dd className="font-mono text-xs">{stats.tenant.slug}</dd>
                <dt className="text-slate-500">Users</dt>
                <dd>{stats.tenant.userCount}</dd>
                <dt className="text-slate-500">Created</dt>
                <dd className="text-xs">
                  {new Date(stats.tenant.createdAt).toLocaleString()}
                </dd>
              </dl>
            ) : (
              <div className="px-4 py-6 text-sm text-slate-500">…</div>
            )}
          </section>

          <section className="rounded-xl bg-white border border-slate-200">
            <div className="px-4 py-2 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              Entities by type
            </div>
            {stats && stats.entitiesByType.length === 0 && (
              <div className="px-4 py-6 text-sm text-slate-500">No entities yet.</div>
            )}
            <ul className="divide-y divide-slate-100">
              {stats?.entitiesByType.map((row) => (
                <li
                  key={row.entityType}
                  className="px-4 py-1.5 text-sm flex items-center justify-between"
                >
                  <span className="font-mono text-xs">{row.entityType}</span>
                  <span>{row.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl bg-white border border-slate-200">
            <div className="px-4 py-2 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              Active workflows
            </div>
            {stats && stats.activeWorkflows.length === 0 && (
              <div className="px-4 py-6 text-sm text-slate-500">No active workflows.</div>
            )}
            <ul className="divide-y divide-slate-100">
              {stats?.activeWorkflows.map((wf) => (
                <li key={wf.id} className="px-4 py-1.5 text-sm">
                  <div className="font-medium">{wf.workflowName}</div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {wf.status} · started {new Date(wf.startedAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl bg-white border border-slate-200">
            <div className="px-4 py-2 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              Recent events
            </div>
            {stats && stats.recentEvents.length === 0 && (
              <div className="px-4 py-6 text-sm text-slate-500">No events yet.</div>
            )}
            <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {stats?.recentEvents.map((e) => (
                <li key={e.id} className="px-4 py-1.5 text-sm">
                  <div className="font-mono text-xs">{e.type}</div>
                  <div className="text-[11px] text-slate-500">
                    {new Date(e.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value ?? '—'}</div>
    </div>
  );
}
