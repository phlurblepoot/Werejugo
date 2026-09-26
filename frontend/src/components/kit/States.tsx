import type { ReactNode } from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import { Button } from "./Button";

/** Loading spinner with an optional label. */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="spinner-label">{label}</span>}
    </div>
  );
}

/** A friendly empty/zero state with an icon (or emoji), message and optional action. */
export function EmptyState({
  icon: Icon,
  emoji,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon;
  emoji?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        {Icon ? <Icon size={28} /> : <span className="empty-state-emoji">{emoji ?? "✨"}</span>}
      </div>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

/** Consistent error state with an optional retry. */
export function ErrorState({
  title = "Something went wrong",
  hint,
  onRetry,
}: {
  title?: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title={title}
      hint={hint}
      action={onRetry && <Button onClick={onRetry}>Try again</Button>}
    />
  );
}
