import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { type Session, api, sessionStore } from '../api';
import { ChatPanel } from './ChatPanel';

const NAV = [
  { to: '/', label: 'Dashboard', exact: true },
  { to: '/ingest', label: 'Ingest' },
  { to: '/entities', label: 'Entities' },
  { to: '/templates', label: 'Templates' },
  { to: '/reports', label: 'Reports' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/wiki', label: 'Wiki' },
  { to: '/workflows', label: 'Workflows' },
  { to: '/events', label: 'Events' },
  { to: '/settings', label: 'Settings' },
];

const CHAT_OPEN_KEY = 'altera.chatOpen';

export function AppShell({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const nav = useNavigate();
  const [me, setMe] = useState<{ user: Session['user']; tenantSlug: string } | null>(null);
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAT_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (!cancelled) setMe(res);
      })
      .catch(() => {
        sessionStore.clear();
        nav('/login');
      });
    return () => {
      cancelled = true;
    };
  }, [nav]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_OPEN_KEY, chatOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [chatOpen]);

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

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <aside className="w-56 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="text-sm font-semibold tracking-wide">Altera OS</div>
          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
            {me?.tenantSlug ?? '…'}
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                `block rounded-md px-3 py-1.5 text-[13px] ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-slate-800 text-xs text-slate-400">
          <div className="truncate" title={me?.user.email ?? ''}>
            {me?.user.username ?? '…'}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            {me?.user.role ?? '—'}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="mt-2 w-full rounded-md border border-slate-700 px-2 py-1 hover:bg-slate-800"
          >
            Logout
          </button>
        </div>
      </aside>

      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] ${
          chatOpen ? 'mr-[24rem]' : ''
        }`}
      >
        <header className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white">
          <div>
            <h1 className="text-base font-semibold">{title}</h1>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 text-sm">
            {actions}
            <button
              type="button"
              onClick={() => setChatOpen((s) => !s)}
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            >
              {chatOpen ? 'Hide chat' : 'Show chat'}
            </button>
          </div>
        </header>
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>

      <div
        className={`fixed top-0 right-0 h-screen w-96 border-l border-slate-200 bg-white shadow-lg transform transition-transform ${
          chatOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <ChatPanel onClose={() => setChatOpen(false)} />
      </div>
    </div>
  );
}
