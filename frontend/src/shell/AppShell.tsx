import { useEffect, useMemo, useState } from "react";
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
import { SettingsPage } from "../pages/SettingsPage";
import { AdminPage } from "../pages/AdminPage";
import { TripInvitePage } from "../pages/TripInvitePage";
import { Rail } from "./Rail";
import { BottomNav } from "./BottomNav";
import { CommandPalette } from "./CommandPalette";
import { FirstRunWelcome } from "./FirstRunWelcome";
import { ShellContext } from "./ShellContext";
import { AdminViewBanner } from "./AdminViewBanner";
import { UploadTray } from "./UploadTray";
import { UploadsProvider } from "../lib/uploads/UploadsProvider";

export function AppShell() {
  const { logout, user } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: dueCount } = useQuery({ queryKey: ["documents-due-count"], queryFn: api.documentsDueCount });
  const { data: faceCount } = useQuery({ queryKey: ["faces-count"], queryFn: api.facesCount, staleTime: 5 * 60_000 });
  const badges = { documents: dueCount?.count ?? 0, people: faceCount?.review ?? 0 };
  const shell = useMemo(() => ({ openSearch: () => setSearchOpen(true) }), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ShellContext.Provider value={shell}>
      <UploadsProvider>
        <div className="shell">
          <Rail onSignOut={logout} onSearch={shell.openSearch} badges={badges} account={user} />
          <div className="shell-col">
            <AdminViewBanner />
            <main className="shell-main">
              <Routes>
                <Route path="/" element={<Navigate to="/map" replace />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/people" element={<PeoplePage />} />
                <Route path="/photos" element={<PhotosPage />} />
                <Route path="/documents" element={<DocumentsPage />} />
                <Route path="/planning" element={<PlanningPage />} />
                <Route path="/packing" element={<PackingPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/trip-invite/:token" element={<TripInvitePage />} />
                <Route path="/admin" element={user?.isAdmin ? <AdminPage /> : <Navigate to="/map" replace />} />
                <Route path="*" element={<Navigate to="/map" replace />} />
              </Routes>
            </main>
          </div>
          <BottomNav onSignOut={logout} onSearch={shell.openSearch} badges={badges} account={user} />
          <FirstRunWelcome />
          <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
          <UploadTray />
        </div>
      </UploadsProvider>
    </ShellContext.Provider>
  );
}
