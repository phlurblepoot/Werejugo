import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { Button, Field } from "../components/kit";
import { AuthCard, errorText } from "./AuthCard";

/** Sign in — or, on a brand-new server, create the first family and admin. */
export function LoginPage() {
  const { login, setup } = useAuth();
  const { data: cfg } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const firstRun = cfg?.firstRun === true;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (firstRun) await setup({ displayName, email, password, familyName });
      else await login(email, password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={firstRun ? "Set up Werejugo" : "Werejugo"}
      tagline={firstRun
        ? "Create the first family on this server. You'll be its owner and the server admin, and can invite everyone else."
        : "Your family's scrapbook of places & journeys."}
    >
      <form onSubmit={submit}>
        {firstRun && (
          <>
            <Field label="Your name" htmlFor="login-name">
              <input id="login-name" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </Field>
            <Field label="Family name" htmlFor="login-family" hint="e.g. “The Wanderers”">
              <input id="login-family" value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
            </Field>
          </>
        )}
        <Field label="Email" htmlFor="login-email">
          <input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="login-password" hint={firstRun ? "At least 8 characters." : undefined}>
          <input
            id="login-password"
            type="password"
            autoComplete={firstRun ? "new-password" : "current-password"}
            minLength={firstRun ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {error && <div className="error-text" role="alert">{error}</div>}

        <Button type="submit" variant="primary" loading={busy} className="auth-submit">
          {firstRun ? "Create family & finish setup" : "Sign in"}
        </Button>
      </form>
      {!firstRun && (
        <p className="hint">
          New here? Ask your family owner for an invite link. Forgot your password? Your family owner or the server admin can send you a reset link.
        </p>
      )}
    </AuthCard>
  );
}
