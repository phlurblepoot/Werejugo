import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";

/** A titled surface for grouping related content (e.g. a settings section). */
export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("kit-card", className)}>
      {(title || actions) && (
        <header className="kit-card-head">
          <div>
            {title && <h2 className="kit-card-title">{title}</h2>}
            {description && <p className="kit-card-desc">{description}</p>}
          </div>
          {actions && <div className="kit-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export const AVATAR_COLORS = ["#0f766e", "#b45309", "#7c3aed", "#be185d", "#1d4ed8", "#15803d", "#c2410c", "#0e7490"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A round picture or initials on a colour derived from the name. */
export function Avatar({ name, src, color, size = 32 }: { name: string; src?: string | null; color?: string | null; size?: number }) {
  const bg = color || AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return src ? (
    <img className="kit-avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="kit-avatar" aria-hidden="true" style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.4) }}>
      {initials(name)}
    </span>
  );
}

/** A pill: optionally selectable (onClick/active) or removable (onRemove). */
export function Chip({
  children,
  active,
  onClick,
  onRemove,
  removeLabel = "Remove",
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const body = onClick ? (
    <button type="button" className="kit-chip-body" aria-pressed={active} onClick={onClick}>{children}</button>
  ) : (
    <span className="kit-chip-body">{children}</span>
  );
  return (
    <span className={cx("kit-chip", active && "is-active")}>
      {body}
      {onRemove && (
        <button type="button" className="kit-chip-remove" aria-label={removeLabel} onClick={onRemove}>
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/** A small count or label, e.g. "3" on a nav item. */
export function Badge({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "accent" | "neutral" }) {
  return <span className={cx("kit-badge", `kit-badge-${tone}`)}>{children}</span>;
}
