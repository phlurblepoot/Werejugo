import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { ShareView } from "./pages/ShareView";

export function App() {
  // Public read-only share links: /s/<token> — no login required.
  const shareMatch = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)/);
  if (shareMatch) return <ShareView token={shareMatch[1]} />;

  const { user, loading } = useAuth();
  if (loading) return <div className="centered">Loading…</div>;
  return user ? <MapPage /> : <LoginPage />;
}
