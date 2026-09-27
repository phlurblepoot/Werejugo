import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { UploadManager, type UploadTask } from "./manager";
import { httpTransport, localResumeStore } from "./transport";

/** The app's upload manager (tests can provide their own). */
export const UploadsContext = createContext<UploadManager | null>(null);

/** What shows photos, refreshed as each upload lands. */
const PHOTO_QUERIES = ["media", "visits", "person", "people", "relations", "immich"];

/** One upload manager for the signed-in app, so uploads carry on from page to page. */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [manager] = useState(() => new UploadManager({
    transport: httpTransport,
    resume: localResumeStore(user?.id ?? "signed-out"),
    onFinished: () => { for (const k of PHOTO_QUERIES) void qc.invalidateQueries({ queryKey: [k] }); },
  }));

  useEffect(() => { void manager.restore(); }, [manager]);

  // Leaving while bytes are still going up loses them (until the file is chosen again).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!manager.sending) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [manager]);

  return <UploadsContext.Provider value={manager}>{children}</UploadsContext.Provider>;
}

export function useUploads(): UploadManager {
  const m = useContext(UploadsContext);
  if (!m) throw new Error("useUploads() needs <UploadsProvider>");
  return m;
}

export function useUploadTasks(): UploadTask[] {
  const m = useUploads();
  return useSyncExternalStore(m.subscribe, m.snapshot);
}
