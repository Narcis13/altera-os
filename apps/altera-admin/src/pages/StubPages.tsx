import { AppShell } from '../components/AppShell';

function Stub({ title, body }: { title: string; body: string }) {
  return (
    <AppShell title={title} subtitle="Coming in a later sprint">
      <div className="p-8">
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {body}
        </div>
      </div>
    </AppShell>
  );
}

export function TasksPage() {
  return (
    <Stub
      title="Tasks"
      body="Personal task tracker for the current tenant. Stub for Sprint 7 — wiring planned for a future milestone."
    />
  );
}

export function WikiPage() {
  return (
    <Stub
      title="Wiki"
      body="Tenant-scoped wiki. Stub for Sprint 7 — content editor planned for a future milestone."
    />
  );
}

export function SettingsPage() {
  return (
    <Stub
      title="Settings"
      body="Tenant + user preferences. Stub for Sprint 7 — settings surface planned for a future milestone."
    />
  );
}
