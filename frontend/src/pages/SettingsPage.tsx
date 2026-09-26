import { useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";

export function SettingsPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  // Backups contain every family on the server, so only the server owner
  // (the first family's owner) may make or restore them.
  const isServerOwner = user?.isInstanceOwner === true;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<File | null>(null);

  async function download() {
    setBusy(true);
    try {
      const blob = await api.downloadBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "werejugo-backup.tar.gz";
      a.click();
      URL.revokeObjectURL(url);
      toast("Backup downloaded", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Backup failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!fileRef.current) return;
    setBusy(true);
    try {
      const { counts } = await api.restoreBackup(fileRef.current);
      const n = Object.values(counts).reduce((a, b) => a + b, 0);
      toast(`Restored ${n} rows — signing you out so you can log in to the restored data`, "success");
      // Accounts were replaced too, so the current session may no longer exist.
      setTimeout(() => { logout(); window.location.assign("/"); }, 1500);
      setConfirm("");
      setFileName("");
      fileRef.current = null;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Restore failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="app-header"><span className="brand">⚙️ Settings</span></header>
      <div className="page-body" style={{ maxWidth: 560 }}>
        <div className="section-title"><span>Backup</span></div>
        {!isServerOwner && (
          <p className="er-sub">Backups of this server are managed by the server owner.</p>
        )}
        {isServerOwner && (
          <>
            <p className="er-sub">Download the entire server — database, photos, documents, pin icons and map overlays — as one archive.</p>
            <button className="primary" disabled={busy} onClick={download}>⬇ Download backup</button>
            <div className="section-title" style={{ marginTop: 20 }}><span>Restore</span></div>
            <p className="er-sub">Replaces <strong>all</strong> current data with the uploaded archive. This cannot be undone.</p>
            <label className="er-sub" htmlFor="restore-file">Restore archive (.tar.gz)</label>
            <input
              id="restore-file"
              type="file"
              accept=".gz,.tgz,application/gzip"
              onChange={(e) => { fileRef.current = e.target.files?.[0] ?? null; setFileName(e.target.files?.[0]?.name ?? ""); }}
            />
            {fileName && (
              <div style={{ marginTop: 8 }}>
                <label className="er-sub">Type <code>restore</code> to confirm:</label>{" "}
                <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="restore" />
                <button className="danger" disabled={busy || confirm !== "restore"} onClick={restore} style={{ marginLeft: 8 }}>
                  Restore &amp; replace
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
