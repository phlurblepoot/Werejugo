import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: LucideIcon;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

/** A button. Defaults to type="button" so it never submits a form by accident. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, loading = false, className, type = "button", disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("kit-btn", `kit-btn-${variant}`, size === "sm" && "kit-btn-sm", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="kit-btn-spinner" aria-hidden="true" /> : Icon && <Icon size={size === "sm" ? 15 : 17} aria-hidden="true" />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name; also shown as a tooltip. */
  label: string;
  icon: LucideIcon;
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

/** An icon-only button. `label` is required so screen readers can name it. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Icon, variant = "ghost", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx("kit-iconbtn", `kit-btn-${variant}`, size === "sm" && "kit-iconbtn-sm", className)}
      {...rest}
    >
      <Icon size={size === "sm" ? 16 : 19} aria-hidden="true" />
    </button>
  );
});
