import { Navigate, Route, Routes } from 'react-router-dom';
import { sessionStore } from './api';
import { DashboardPage } from './pages/DashboardPage';
import { EventsPage } from './pages/EventsPage';
import { IngestPage } from './pages/IngestPage';
import { LoginPage } from './pages/LoginPage';

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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
