import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button, IconButton } from "./Button";
import { cx } from "./cx";

/**
 * A dialog: a centred card on desktop, a bottom sheet on phones. Focus is
 * trapped inside, Escape and the overlay close it, and it is announced as a
 * dialog with its title.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="kit-overlay" />
        <Dialog.Content className={cx("kit-modal", `kit-modal-${size}`)} {...(description ? {} : { "aria-describedby": undefined })}>
          <div className="kit-modal-head">
            <Dialog.Title className="kit-modal-title">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close" icon={X} size="sm" />
            </Dialog.Close>
          </div>
          {description && <Dialog.Description className="kit-modal-desc">{description}</Dialog.Description>}
          {children && <div className="kit-modal-body">{children}</div>}
          {footer && <div className="kit-modal-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Provides `useConfirm()`: `if (await confirm({ title: "Delete trip?", danger: true })) …` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    resolver.current?.(false);
    setPending(options);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={pending !== null}
        onOpenChange={(open) => { if (!open) settle(false); }}
        title={pending?.title ?? ""}
        description={pending?.message}
        size="sm"
        footer={
          <>
            <Button onClick={() => settle(false)}>{pending?.cancelLabel ?? "Cancel"}</Button>
            <Button variant={pending?.danger ? "danger" : "primary"} onClick={() => settle(true)} autoFocus>
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

/** Ask the user to confirm an action. Falls back to window.confirm outside a provider. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx ?? (async (o) => window.confirm(typeof o.message === "string" ? `${o.title}\n\n${o.message}` : o.title));
}
