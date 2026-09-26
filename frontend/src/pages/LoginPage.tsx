import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { Button, Field, SegmentedControl } from "../components/kit";

type Mode = "login" | "create" | "join";

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // What this server allows: a first run only offers setup; afterwards
  // "New family" appears only when the owner has opened signup.
  const { data: cfg } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const firstRun = cfg?.firstRun === true;
  const signupOpen = cfg?.signupOpen === true;
  useEffect(() => {
    if (firstRun) setMode("create");
    else if (!signupOpen && mode === "create") setMode("login");
  }, [firstRun, signupOpen, mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else if (mode === "create") {
        await register({ mode: "create", email, password, displayName, familyName });
      } else {
        await register({ mode: "join", email, password, displayName, inviteCode });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const modes = [
    { value: "login" as const, label: "Sign in" },
    ...(signupOpen ? [{ value: "create" as const, label: "New family" }] : []),
    { value: "join" as const, label: "Join" },
  ];
  const submitLabel =
    mode === "login" ? "Sign in" : mode === "create" ? (firstRun ? "Create family & finish setup" : "Create family") : "Join family";

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-mark"><Compass size={24} aria-hidden="true" /></span>
          <h1>{firstRun ? "Set up Werejugo" : "Werejugo"}</h1>
        </div>
        <p className="tagline">
          {firstRun
            ? "Create the first family on this server. You'll be its owner and can invite everyone else."
            : "Your family's scrapbook of places & journeys."}
        </p>

        {!firstRun && <SegmentedControl label="What would you like to do?" value={mode} onChange={setMode} options={modes} />}

        <form onSubmit={submit} noValidate={false}>
          {mode !== "login" && (
            <Field label="Your name" htmlFor="login-name">
              <input id="login-name" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </Field>
          )}
          {mode === "create" && (
            <Field label="Family name" htmlFor="login-family" hint={firstRun ? "e.g. “The Wanderers”" : undefined}>
              <input id="login-family" value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
            </Field>
          )}
          {mode === "join" && (
            <Field label="Invite code" htmlFor="login-invite" hint="Ask a family owner — it's on their Settings page.">
              <input
                id="login-invite"
                autoCapitalize="characters"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                required
              />
            </Field>
          )}
          <Field label="Email" htmlFor="login-email">
            <input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="login-password" hint={mode !== "login" ? "At least 8 characters." : undefined}>
            <input
              id="login-password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "login" ? undefined : 8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          {error && <div className="error-text" role="alert">{error}</div>}

          <Button type="submit" variant="primary" loading={busy} className="auth-submit">
            {submitLabel}
          </Button>
        </form>

        {mode === "create" && !firstRun && (
          <p className="hint">You'll become the family owner and can invite others with a code afterwards.</p>
        )}
      </div>
    </div>
  );
}
