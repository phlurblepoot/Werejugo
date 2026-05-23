import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="centered">Loading…</div>;
  }
  return user ? <MapPage /> : <LoginPage />;
}
