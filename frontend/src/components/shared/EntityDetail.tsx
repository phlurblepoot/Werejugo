import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string | null;
  onClose?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  children: ReactNode;
}

/** Generic detail modal: header (title/subtitle), optional edit/delete, and a body. */
export function EntityDetail({ title, subtitle, onClose, onEdit, onDelete, children }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {subtitle && <div style={{ color: "var(--muted)", fontSize: 13 }}>{subtitle}</div>}
          </div>
          {onClose && <button className="ghost" aria-label="Close" title="Close" onClick={onClose}>✕</button>}
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
        {(onEdit || onDelete) && (
          <div className="modal-actions">
            {onDelete && <button className="danger" style={{ marginRight: "auto" }} onClick={onDelete}>Delete</button>}
            {onEdit && <button className="primary" onClick={onEdit}>Edit</button>}
          </div>
        )}
      </div>
    </div>
  );
}
