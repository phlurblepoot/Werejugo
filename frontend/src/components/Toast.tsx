import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  /** Show a transient notification. */
  toast: (message: string, kind?: ToastKind) => void;
  /** Fire a one-off confetti burst (for milestones like the first pin). */
  celebrate: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICON: Record<ToastKind, string> = { success: "✅", error: "⚠️", info: "💬" };
const CONFETTI_COLORS = ["#2563eb", "#f59e0b", "#ec4899", "#10b981", "#a855f7", "#ef4444"];

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confettiKey, setConfettiKey] = useState(0);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    const ms = kind === "error" ? 5000 : 3200;
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ms);
  }, []);

  const celebrate = useCallback(() => setConfettiKey((k) => k + 1), []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast, celebrate }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
            <span className="toast-icon">{ICON[t.kind]}</span>
            <span className="toast-msg">{t.message}</span>
          </div>
        ))}
      </div>
      {confettiKey > 0 && <Confetti key={confettiKey} />}
    </ToastContext.Provider>
  );
}

/** Access toast + celebrate from anywhere under the provider. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/** Lightweight, dependency-free CSS confetti burst that auto-cleans after the animation. */
function Confetti() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), 4000);
    return () => clearTimeout(t);
  }, []);
  if (done) return null;
  const pieces = Array.from({ length: 90 }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.5;
        const duration = 1.8 + Math.random() * 1.4;
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        const size = 7 + (i % 4) * 2;
        return (
          <span
            key={i}
            className="confetti-piece"
            style={{
              left: `${left}%`,
              width: size,
              height: size * 1.4,
              background: color,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
            }}
          />
        );
      })}
    </div>
  );
}
