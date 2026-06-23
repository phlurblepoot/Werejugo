import { Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { ShareView } from "./pages/ShareView";
import { AppShell } from "./shell/AppShell";

export function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      {/* Public read-only share links — no login required. */}
      <Route path="/s/:token" element={<ShareView />} />
      <Route
        path="/*"
        element={loading ? <div className="centered">Loading…</div> : user ? <AppShell /> : <LoginPage />}
      />
    </Routes>
  );
}
