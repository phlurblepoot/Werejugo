import type { DocumentItem } from "../../api/client";

function statusText(d: DocumentItem): string {
  if (d.status === "overdue" && d.daysUntilExpiry != null) return `overdue ${Math.abs(d.daysUntilExpiry)} days`;
  if (d.status === "upcoming" && d.daysUntilExpiry != null) return `in ${d.daysUntilExpiry} days`;
  if (d.status === "ok") return d.expiresOn ? `expires ${d.expiresOn}` : "";
  return "no expiry";
}

const DOC_ICON: Record<string, string> = { passport: "🛂", visa: "📄", booking: "🏨", insurance: "🛡️", other: "📎" };

export function DocumentList({ documents, onOpen }: { documents: DocumentItem[]; onOpen: (d: DocumentItem) => void }) {
  return (
    <div>
      {documents.map((d) => (
        <div key={d.id} className="entity-row" onClick={() => onOpen(d)}>
          <span className="er-thumb" aria-hidden="true" style={{ fontSize: 20 }}>{DOC_ICON[d.docType] ?? "📎"}</span>
          <span className="er-main">
            <span className="er-title">{d.title}</span>
            <span className="er-sub">
              {d.docType}
              {(d.ownerPersonName || d.ownerTripName) && ` · ${d.ownerPersonName ?? d.ownerTripName}`}
            </span>
          </span>
          <span className={`doc-status doc-${d.status}`}>{statusText(d)}</span>
        </div>
      ))}
    </div>
  );
}
