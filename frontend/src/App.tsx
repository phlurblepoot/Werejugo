import { Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { ShareView } from "./pages/ShareView";
import { InvitePage } from "./pages/InvitePage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AppShell } from "./shell/AppShell";

export function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      {/* Public pages — no login required. */}
      <Route path="/s/:token" element={<ShareView />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/reset/:token" element={<ResetPasswordPage />} />
      <Route
        path="/*"
        element={loading ? <div className="centered">Loading…</div> : user ? <AppShell /> : <LoginPage />}
      />
    </Routes>
  );
}
