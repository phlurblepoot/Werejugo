import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* storage unavailable (private mode) — dismissal lasts for this visit only */
  }
}

/**
 * A small "getting started" card for a family with no data yet. It sits in a
 * corner instead of covering the app, can be dismissed, and re-checks on every
 * navigation so it disappears as soon as something has been added.
 */
export function FirstRunWelcome() {
  const { family } = useAuth();
  const { pathname } = useLocation();
  const key = `werejugo.welcome-dismissed.${family?.id ?? "unknown"}`;
  const [dismissed, setDismissed] = useState(() => readFlag(key));
  const { data, refetch } = useQuery({
    queryKey: ["first-run-stats"],
    queryFn: () => api.getStats(""),
    enabled: !dismissed,
  });

  useEffect(() => {
    if (!dismissed) void refetch();
  }, [pathname, dismissed, refetch]);

  if (dismissed || !data) return null;
  if (data.items > 0 || data.photos > 0 || data.trips > 0) return null;

  function dismiss() {
    writeFlag(key);
    setDismissed(true);
  }

  return (
    <aside className="first-run-card" role="complementary" aria-label="Getting started">
      <button type="button" className="first-run-close" aria-label="Dismiss" onClick={dismiss}>×</button>
      <div className="first-run-title">👋 Welcome to Werejugo</div>
      <p className="first-run-hint">Your family travel hub is empty. A good way to start:</p>
      <div className="first-run-actions">
        <Link className="first-run-cta" to="/people">＋ Add people</Link>
        <Link className="first-run-cta" to="/planning">＋ Create a trip</Link>
        <Link className="first-run-cta" to="/map">＋ Pin a place</Link>
      </div>
    </aside>
  );
}
