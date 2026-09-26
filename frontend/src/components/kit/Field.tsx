import type { ReactNode } from "react";
import { cx } from "./cx";

/** A labelled form control with optional hint and error text. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("kit-field", error ? "kit-field-invalid" : null, className)}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <div className="kit-field-error" role="alert">{error}</div> : hint ? <div className="kit-field-hint">{hint}</div> : null}
    </div>
  );
}
