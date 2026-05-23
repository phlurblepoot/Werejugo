import { useState } from "react";
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
        <h1>Werejugo</h1>
        <p className="tagline">Your family's scrapbook of places &amp; journeys.</p>

        <div className="tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Sign in
          </button>
          <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>
            New family
          </button>
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>
            Join
          </button>
        </div>

        <form onSubmit={submit}>
          {mode !== "login" && (
            <div className="field">
              <label>Your name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>
          )}
          {mode === "create" && (
            <div className="field">
              <label>Family name</label>
              <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
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

          <button className="primary" style={{ width: "100%", marginTop: 8 }} disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "create" ? "Create family" : "Join family"}
          </button>
        </form>

        {mode === "create" && (
          <p className="hint">
            You'll become the family owner and can invite others with a code afterwards.
          </p>
        )}
      </div>
    </div>
  );
}
