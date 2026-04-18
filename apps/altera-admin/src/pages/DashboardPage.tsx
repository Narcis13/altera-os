import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Session, api, sessionStore } from '../api';

export function DashboardPage() {
  const nav = useNavigate();
  const [me, setMe] = useState<{ user: Session['user']; tenantSlug: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (!cancelled) setMe(res);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onLogout() {
    const session = sessionStore.get();
    if (session) {
      try {
        await api.logout(session.refreshToken);
      } catch {
        /* ignore */
      }
    }
    sessionStore.clear();
    nav('/login');
  }

  if (err) {
    return (
      <div className="p-6">
        <p className="text-red-600 text-sm">{err}</p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-3 rounded-md bg-slate-900 text-white text-sm px-3 py-1.5"
        >
          Back to login
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
        <div>
          <h1 className="text-lg font-semibold">Altera OS — Admin</h1>
          <p className="text-xs text-slate-500">Sprint 1 skeleton</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-600">
            {me?.user.username ?? '…'}{' '}
            <span className="text-slate-400">@ {me?.tenantSlug ?? ''}</span>
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="p-6 grid gap-4 sm:grid-cols-2">
        <Card title="Tenant" value={me?.tenantSlug ?? '…'} />
        <Card title="Role" value={me?.user.role ?? '…'} />
        <Card title="Email" value={me?.user.email ?? '…'} />
        <Card
          title="Created"
          value={me?.user.createdAt ? new Date(me.user.createdAt).toLocaleString() : '…'}
        />
      </main>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 text-base font-medium text-slate-900">{value}</div>
    </div>
  );
}
