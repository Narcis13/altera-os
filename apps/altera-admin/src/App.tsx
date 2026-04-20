import { Navigate, Route, Routes } from 'react-router-dom';
import { sessionStore } from './api';
import { DashboardPage } from './pages/DashboardPage';
import { EntitiesPage } from './pages/EntitiesPage';
import { EventsPage } from './pages/EventsPage';
import { IngestPage } from './pages/IngestPage';
import { LoginPage } from './pages/LoginPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage, TasksPage, WikiPage } from './pages/StubPages';
import { TemplatesPage } from './pages/TemplatesPage';
import { WorkflowsPage } from './pages/WorkflowsPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = sessionStore.get();
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/events"
        element={
          <RequireAuth>
            <EventsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/ingest"
        element={
          <RequireAuth>
            <IngestPage />
          </RequireAuth>
        }
      />
      <Route
        path="/entities"
        element={
          <RequireAuth>
            <EntitiesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/templates"
        element={
          <RequireAuth>
            <TemplatesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/reports"
        element={
          <RequireAuth>
            <ReportsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/workflows"
        element={
          <RequireAuth>
            <WorkflowsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/tasks"
        element={
          <RequireAuth>
            <TasksPage />
          </RequireAuth>
        }
      />
      <Route
        path="/wiki"
        element={
          <RequireAuth>
            <WikiPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
