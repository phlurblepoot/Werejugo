import type { ReactNode } from "react";

/** Animated loading spinner with an optional label. */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="spinner-label">{label}</span>}
    </div>
  );
}

/** Centered, friendly empty/zero-state with an emoji, message, and optional call-to-action. */
export function EmptyState({
  emoji,
  title,
  hint,
  action,
}: {
  emoji: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-emoji" aria-hidden="true">{emoji}</div>
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
    <div className="empty-state">
      <div className="empty-state-emoji" aria-hidden="true">⚠️</div>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
      {onRetry && (
        <div className="empty-state-action">
          <button onClick={onRetry}>Try again</button>
        </div>
      )}
    </div>
  );
}
