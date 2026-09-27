import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api, type ImmichStatus } from "../../api/client";
import { useAuth } from "../../lib/auth";
import { useToast } from "../Toast";
import { Badge, Button, Card, Field, Modal } from "../kit";
import { errorText } from "../../pages/AuthCard";

/** Settings → "Photos (Immich)": is the family connected, and (owners) the login for using Immich directly. */
export function ImmichCard() {
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ["immich", "status"], queryFn: api.immichStatus });
  const [setting, setSetting] = useState(false);
  if (!data) return null;
  const isOwner = user?.role === "owner";
  const askAdmin = user?.isAdmin
    ? <>Connect it in <Link to="/admin?tab=immich">Admin → Immich</Link>.</>
    : "The server admin connects families to Immich.";

  return (
    <Card
      title="Photos (Immich)"
      description="Your family's photos and videos are kept in its own account on the server's Immich photo library."
      actions={<Badge tone={data.enabled ? "accent" : data.state === "error" ? "danger" : "neutral"}>{label(data)}</Badge>}
    >
      {data.state === "none" && <p className="er-sub">Not connected yet. {askAdmin}</p>}
      {data.state === "error" && <p className="er-sub">Werejugo can't use your family's Immich account right now. {askAdmin}</p>}
      {data.enabled && isOwner && data.email && (
        <>
          <dl className="immich-login">
            <dt>Immich address</dt><dd><code>{data.url}</code></dd>
            <dt>Your family's Immich login</dt><dd><code>{data.email}</code></dd>
          </dl>
          {data.canSetPassword ? (
            <>
              <p className="er-sub">
                You don't need Immich to use Werejugo. To also use Immich's own web page or phone app at home, set a password for this login.
                Photos you add there show up in Werejugo too.
              </p>
              <Button size="sm" icon={KeyRound} onClick={() => setSetting(true)}>Set Immich password</Button>
            </>
          ) : (
            <p className="er-sub">This family uses an Immich account that already existed; change its password in Immich.</p>
          )}
        </>
      )}
      {data.enabled && !isOwner && <p className="er-sub">Connected. Your family's owners can see the Immich login here.</p>}
      <PasswordModal open={setting} email={data.email ?? ""} url={data.url ?? ""} onClose={() => setSetting(false)} />
    </Card>
  );
}

const label = (d: ImmichStatus) => (d.enabled ? "Connected" : d.state === "error" ? "Needs attention" : "Not connected");

function PasswordModal({ open, email, url, onClose }: { open: boolean; email: string; url: string; onClose: () => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => { setPassword(""); setAgain(""); setError(""); onClose(); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters");
    if (password !== again) return setError("The two passwords don't match");
    setBusy(true);
    setError("");
    try {
      await api.setImmichPassword(password);
      toast(`Immich password set. Sign in at ${url} as ${email}`, "success");
      close();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) close(); }}
      title="Set your family's Immich password"
      description={`For signing in to Immich directly as ${email}. Werejugo keeps working either way; it doesn't store this password.`}
    >
      <form onSubmit={(e) => void submit(e)}>
        <Field label="New Immich password" htmlFor="immich-pw">
          <input id="immich-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Type it again" htmlFor="immich-pw2" error={error || undefined}>
          <input id="immich-pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
        <div className="kit-modal-actions">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Set password</Button>
        </div>
      </form>
    </Modal>
  );
}
