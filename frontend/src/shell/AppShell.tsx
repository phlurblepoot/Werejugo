import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../api/client";
import { MapPage } from "../pages/MapPage";
import { PeoplePage } from "../pages/PeoplePage";
import { PhotosPage } from "../pages/PhotosPage";
import { DocumentsPage } from "../pages/DocumentsPage";
import { PlanningPage } from "../pages/PlanningPage";
import { PackingPage } from "../pages/PackingPage";
import { Rail } from "./Rail";
import { ComingSoon } from "./ComingSoon";
import { MODULES } from "./modules";

export function AppShell() {
  const { logout } = useAuth();
  const { data: dueCount } = useQuery({ queryKey: ["documents-due-count"], queryFn: api.documentsDueCount });
  return (
    <div className="shell">
      <Rail onSignOut={logout} badges={{ documents: dueCount?.count ?? 0 }} />
      <div className="shell-main">
        <Routes>
          <Route path="/" element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/photos" element={<PhotosPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/packing" element={<PackingPage />} />
          {MODULES.filter((m) => !m.enabled).map((m) => (
            <Route key={m.key} path={m.path} element={<ComingSoon label={m.label} />} />
          ))}
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Routes>
      </div>
    </div>
  );
}
