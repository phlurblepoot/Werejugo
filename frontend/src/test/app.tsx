import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../components/Toast";
import { ConfirmProvider } from "../components/kit";
import type { UploadManager } from "../lib/uploads/manager";
import { withUploads } from "./uploads";

/** Everything the signed-in app provides: queries, toasts, confirms and uploads. */
export function withApp(ui: ReactNode, opts: { manager?: UploadManager; qc?: QueryClient } = {}) {
  const qc = opts.qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ConfirmProvider>{withUploads(ui, opts.manager)}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
