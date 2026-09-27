import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FolderOpen, RotateCw, X } from "lucide-react";
import { useUploads, useUploadTasks } from "../lib/uploads/UploadsProvider";
import type { UploadTask } from "../lib/uploads/manager";
import { MEDIA_ACCEPT } from "../components/shared/MediaUploader";
import { Button, IconButton } from "../components/kit";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function statusText(t: UploadTask): string {
  const at = Math.min(t.sent + t.inflight, t.size);
  switch (t.state) {
    case "queued": return "Waiting…";
    case "uploading": return `Sending ${formatBytes(at)} of ${formatBytes(t.size)}`;
    case "processing": return "Adding to Immich…";
    case "done": return t.duplicate ? "Already in your library" : t.error ?? "Added";
    case "paused": return `Paused at ${Math.floor((t.sent / t.size) * 100)}%. Choose the file again to finish.`;
    case "failed": return t.error ?? "Failed";
  }
}

/** Every upload in progress, in a corner card (above the tab bar on phones). */
export function UploadTray() {
  const manager = useUploads();
  const tasks = useUploadTasks();
  const [collapsed, setCollapsed] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const [choosingFor, setChoosingFor] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  if (!tasks.length) return null;

  const done = tasks.filter((t) => t.state === "done").length;
  const failed = tasks.filter((t) => t.state === "failed").length;
  const paused = tasks.filter((t) => t.state === "paused").length;
  const working = tasks.filter((t) => t.state === "queued" || t.state === "uploading" || t.state === "processing");
  const total = tasks.reduce((n, t) => n + t.size, 0);
  const sent = tasks.reduce((n, t) => n + (t.state === "done" || t.state === "processing" ? t.size : Math.min(t.sent + t.inflight, t.size)), 0);
  const pct = total ? Math.floor((sent / total) * 100) : 100;

  const title = working.length
    ? `${done} of ${tasks.length} uploaded · ${pct}%`
    : failed || paused
      ? `${done} uploaded · ${failed + paused} need${failed + paused === 1 ? "s" : ""} attention`
      : `${done} uploaded`;

  function choose(key: string) {
    setChoosingFor(key);
    setPickError(null);
    picker.current?.click();
  }

  return (
    <section className={`upload-tray${collapsed ? " is-collapsed" : ""}`} aria-label="Uploads">
      <header className="upload-tray-head">
        <strong className="upload-tray-title">{title}</strong>
        {done > 0 && !working.length && (
          <Button size="sm" variant="ghost" onClick={() => manager.clearFinished()}>Clear finished</Button>
        )}
        <IconButton size="sm" icon={collapsed ? ChevronUp : ChevronDown} label={collapsed ? "Show uploads" : "Hide uploads"} onClick={() => setCollapsed((c) => !c)} />
      </header>
      {working.length > 0 && (
        <div className="upload-bar" role="progressbar" aria-label="All uploads" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {/* Announced once, not on every percent. */}
      <p className="sr-only" role="status" aria-live="polite">
        {working.length ? "" : failed ? `${failed} upload${failed === 1 ? "" : "s"} failed` : `${done} uploaded`}
      </p>
      {!collapsed && (
        <ul className="upload-list">
          {tasks.map((t) => {
            const at = t.state === "done" || t.state === "processing" ? t.size : Math.min(t.sent + t.inflight, t.size);
            const p = t.size ? Math.floor((at / t.size) * 100) : 0;
            const bad = t.state === "failed" || (t.state === "done" && !!t.error && !t.duplicate);
            const waiting = t.state === "paused";
            return (
              <li key={t.key} className={`upload-row is-${t.state}`}>
                <div className="upload-row-main">
                  <div className="upload-name-line">
                    <span className="upload-name" title={t.name}>{t.name}</span>
                    {t.state !== "uploading" && <span className="upload-size">{formatBytes(t.size)}</span>}
                  </div>
                  <div className={`upload-status${bad ? " is-bad" : waiting ? " is-waiting" : ""}`}>
                    {t.state === "done" && !bad && <CheckCircle2 size={13} aria-hidden="true" />}
                    {(bad || waiting) && <AlertTriangle size={13} aria-hidden="true" />}
                    <span>{statusText(t)}</span>
                  </div>
                  {(t.state === "uploading" || t.state === "processing" || t.state === "paused" || t.state === "queued") && (
                    <div className={`upload-bar is-small${t.state === "processing" ? " is-busy" : ""}`} role="progressbar" aria-label={t.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}>
                      <span style={{ width: `${p}%` }} />
                    </div>
                  )}
                </div>
                <div className="upload-actions">
                  {t.state === "failed" && t.canRetry && (
                    <IconButton size="sm" icon={RotateCw} label={`Retry ${t.name}`} onClick={() => void manager.retry(t.key)} />
                  )}
                  {t.state === "paused" && (
                    <IconButton size="sm" icon={FolderOpen} label={`Choose ${t.name} again`} onClick={() => choose(t.key)} />
                  )}
                  {t.state !== "processing" && (
                    <IconButton size="sm" icon={X} label={t.state === "done" ? `Hide ${t.name}` : `Cancel ${t.name}`}
                      onClick={() => (t.state === "done" ? manager.dismiss(t.key) : void manager.cancel(t.key))} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {pickError && <p className="error-text upload-pick-error" role="alert">{pickError}</p>}
      <input
        ref={picker}
        type="file"
        accept={MEDIA_ACCEPT}
        hidden
        data-testid="upload-resume-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && choosingFor) setPickError(manager.resumeWith(choosingFor, f));
          e.target.value = "";
          setChoosingFor(null);
        }}
      />
    </section>
  );
}
