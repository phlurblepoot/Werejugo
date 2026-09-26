import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Button, Field, Spinner } from "../components/kit";
import { AuthCard, errorText } from "./AuthCard";

/** Public page for a one-time password reset link. */
export function ResetPasswordPage() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const preview = useQuery({ queryKey: ["reset", token], queryFn: () => api.resetPreview(token), retry: false });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (preview.isLoading) return <AuthCard title="Werejugo"><Spinner label="Checking your link…" /></AuthCard>;
  if (preview.isError || !preview.data) {
    return (
      <AuthCard title="Link not valid" tagline="This reset link has expired or was already used. Ask your family owner or the server admin for a new one.">
        <Button variant="primary" className="auth-submit" onClick={() => nav("/")}>Go to sign in</Button>
      </AuthCard>
    );
  }
  if (done) {
    return (
      <AuthCard title="Password changed" tagline="You can now sign in with your new password. Any other devices were signed out.">
        <Button variant="primary" className="auth-submit" onClick={() => nav("/", { replace: true })}>Sign in</Button>
      </AuthCard>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Choose a new password" tagline={`For ${preview.data.displayName} (${preview.data.email}).`}>
      <form onSubmit={submit}>
        <Field label="New password" htmlFor="reset-password" hint="At least 8 characters.">
          <input id="reset-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Repeat new password" htmlFor="reset-confirm">
          <input id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        {error && <div className="error-text" role="alert">{error}</div>}
        <Button type="submit" variant="primary" loading={busy} className="auth-submit">Set new password</Button>
      </form>
    </AuthCard>
  );
}
