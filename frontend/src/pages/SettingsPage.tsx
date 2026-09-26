import { useRef, useState } from "react";
import { Copy, Download, Monitor, Moon, Settings as SettingsIcon, Sun, Upload } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { useTheme, type ThemePreference } from "../lib/theme";
import { useToast } from "../components/Toast";
import { Avatar, Badge, Button, Card, Field, PageHeader, SegmentedControl } from "../components/kit";

export function SettingsPage() {
  const { user, family, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const { toast } = useToast();
  // Backups contain every family on the server, so only the server owner
  // (the first family's owner) may make or restore them.
  const isServerOwner = user?.isInstanceOwner === true;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<File | null>(null);

  async function copyInvite() {
    if (!family) return;
    try {
      await navigator.clipboard.writeText(family.inviteCode);
      toast("Invite code copied", "success");
    } catch {
      toast(`Invite code: ${family.inviteCode}`, "info");
    }
  }

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
      <PageHeader icon={SettingsIcon} title="Settings" />
      <div className="page-body">
        <div className="settings-stack">
          {user && (
            <Card title="Account">
              <div className="settings-account">
                <Avatar name={user.displayName} color={user.color} size={48} />
                <div>
                  <div className="settings-name">{user.displayName}</div>
                  <div className="er-sub">{user.email}</div>
                </div>
                <Badge tone="neutral">{user.role === "owner" ? "Family owner" : "Member"}</Badge>
              </div>
            </Card>
          )}

          {family && (
            <Card title="Family" description="Share the invite code so family members can join from the sign-in page.">
              <div className="settings-row">
                <span className="settings-label">Name</span>
                <span>{family.name}</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">Invite code</span>
                <code className="invite-code">{family.inviteCode}</code>
                <Button size="sm" icon={Copy} onClick={() => void copyInvite()}>Copy</Button>
              </div>
            </Card>
          )}

          <Card title="Appearance" description="Applies to this device.">
            <SegmentedControl<ThemePreference>
              label="Theme"
              value={preference}
              onChange={setPreference}
              options={[
                { value: "system", label: "System", icon: Monitor },
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
              ]}
            />
          </Card>

          <Card title="Backup" description={isServerOwner
            ? "Download the entire server — database, photos, documents, pin icons and map overlays — as one archive."
            : undefined}>
            {!isServerOwner && (
              <p className="er-sub">Backups of this server are managed by the server owner.</p>
            )}
            {isServerOwner && (
              <>
                <Button variant="primary" icon={Download} disabled={busy} onClick={download}>Download backup</Button>

                <div className="settings-divider" />
                <h3 className="settings-subtitle">Restore</h3>
                <p className="er-sub">Replaces <strong>all</strong> current data with the uploaded archive. This cannot be undone.</p>
                <Field label="Restore archive (.tar.gz)" htmlFor="restore-file">
                  <input
                    id="restore-file"
                    type="file"
                    accept=".gz,.tgz,application/gzip"
                    onChange={(e) => { fileRef.current = e.target.files?.[0] ?? null; setFileName(e.target.files?.[0]?.name ?? ""); }}
                  />
                </Field>
                {fileName && (
                  <div className="restore-confirm">
                    <Field label={<>Type <code>restore</code> to confirm</>} htmlFor="restore-confirm">
                      <input id="restore-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="restore" />
                    </Field>
                    <Button variant="danger" icon={Upload} disabled={busy || confirm !== "restore"} onClick={restore}>
                      Restore &amp; replace
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
