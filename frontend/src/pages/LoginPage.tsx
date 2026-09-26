import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";

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

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{firstRun ? "Set up Werejugo" : "Werejugo"}</h1>
        <p className="tagline">
          {firstRun
            ? "Create the first family on this server. You'll be its owner and can invite everyone else."
            : "Your family's scrapbook of places & journeys."}
        </p>

        {!firstRun && (
          <div className="tabs">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
              Sign in
            </button>
            {signupOpen && (
              <button type="button" className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>
                New family
              </button>
            )}
            <button type="button" className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>
              Join
            </button>
          </div>
        )}

        <form onSubmit={submit}>
          {mode !== "login" && (
            <div className="field">
              <label htmlFor="login-name">Your name</label>
              <input id="login-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>
          )}
          {mode === "create" && (
            <div className="field">
              <label htmlFor="login-family">Family name</label>
              <input id="login-family" value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
            </div>
          )}
          {mode === "join" && (
            <div className="field">
              <label>Invite code</label>
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                required
              />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Password {mode !== "login" && <span>(min 8 chars)</span>}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <div className="error-text">{error}</div>}

          <button type="submit" className="primary" style={{ width: "100%", marginTop: 8 }} disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "create" ? (firstRun ? "Create family & finish setup" : "Create family") : "Join family"}
          </button>
        </form>

        {mode === "create" && !firstRun && (
          <p className="hint">
            You'll become the family owner and can invite others with a code afterwards.
          </p>
        )}
        {mode === "join" && (
          <p className="hint">Ask a family owner for their invite code (shown on the Map page).</p>
        )}
      </div>
    </div>
  );
}
