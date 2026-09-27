import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { Button, Field, Spinner } from "../components/kit";
import { AuthCard, errorText } from "./AuthCard";

/** Public page for a one-time invite link: create a new family, or join one. */
export function InvitePage() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { user, acceptInvite, logout } = useAuth();
  const preview = useQuery({ queryKey: ["invite", token], queryFn: () => api.invitePreview(token), retry: false });
  const [displayName, setDisplayName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (preview.isLoading) return <AuthCard title="Werejugo"><Spinner label="Checking your invite…" /></AuthCard>;
  if (preview.isError || !preview.data) {
    return (
      <AuthCard title="Invite not valid" tagline="This invite link has expired, was already used, or was cancelled. Ask whoever sent it for a new one.">
        <Button variant="primary" className="auth-submit" onClick={() => nav("/")}>Go to sign in</Button>
      </AuthCard>
    );
  }
  const inv = preview.data;
  const newFamily = inv.kind === "family";

  if (user) {
    return (
      <AuthCard title="You're already signed in" tagline={`You're signed in as ${user.displayName}. Sign out to use this invite with a different account.`}>
        <Button variant="primary" className="auth-submit" onClick={logout}>Sign out</Button>
      </AuthCard>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await acceptInvite(token, { displayName, email, password, ...(newFamily ? { familyName } : {}) });
      nav("/", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={newFamily ? "Start your family on Werejugo" : `Join ${inv.familyName}`}
      tagline={newFamily
        ? `${inv.invitedBy ?? "The server admin"} invited you to create a family space on this server.`
        : `${inv.invitedBy ?? "A family owner"} invited you to join as ${inv.role === "owner" ? "an owner" : "a member"}.`}
    >
      <form onSubmit={submit}>
        <Field label="Your name" htmlFor="inv-name">
          <input id="inv-name" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </Field>
        {newFamily && (
          <Field label="Family name" htmlFor="inv-family" hint="e.g. “The Smiths”">
            <input id="inv-family" value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
          </Field>
        )}
        <Field label="Email" htmlFor="inv-email">
          <input id="inv-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="inv-password" hint="At least 8 characters.">
          <input id="inv-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {newFamily && (
          <p className="privacy-note">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              This server is run by {inv.adminName ?? "its admin"}. As the server admin they can see and manage all data on it,
              including your family's.
            </span>
          </p>
        )}
        {error && <div className="error-text" role="alert">{error}</div>}
        <Button type="submit" variant="primary" loading={busy} className="auth-submit">
          {newFamily ? "Create my family" : "Join family"}
        </Button>
      </form>
      <p className="hint">This invite expires {formatDate(inv.expiresAt.slice(0, 10))}.</p>
    </AuthCard>
  );
}
