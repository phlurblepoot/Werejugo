import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { MapPage } from "../pages/MapPage";
import { PeoplePage } from "../pages/PeoplePage";
import { PhotosPage } from "../pages/PhotosPage";
import { Rail } from "./Rail";
import { ComingSoon } from "./ComingSoon";
import { MODULES } from "./modules";

export function AppShell() {
  const { logout } = useAuth();
  return (
    <div className="shell">
      <Rail onSignOut={logout} />
      <div className="shell-main">
        <Routes>
          <Route path="/" element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/photos" element={<PhotosPage />} />
          {MODULES.filter((m) => !m.enabled).map((m) => (
            <Route key={m.key} path={m.path} element={<ComingSoon label={m.label} />} />
          ))}
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Routes>
      </div>
    </div>
  );
}
