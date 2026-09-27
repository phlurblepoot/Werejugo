import type { ReactNode } from "react";
import { Compass } from "lucide-react";

/** The centred card used by sign-in, setup, invite and password-reset pages. */
export function AuthCard({ title, tagline, children }: { title: string; tagline?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-mark"><Compass size={24} aria-hidden="true" /></span>
          <h1>{title}</h1>
        </div>
        {tagline && <p className="tagline">{tagline}</p>}
        {children}
      </div>
    </div>
  );
}

/** A readable message from an API error (which may carry zod's field errors). */
export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return "Something went wrong";
  try {
    const parsed = JSON.parse(err.message) as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
    const first = Object.values(parsed.fieldErrors ?? {}).flat()[0] ?? parsed.formErrors?.[0];
    if (first) return first;
  } catch {
    /* plain message */
  }
  return err.message;
}
