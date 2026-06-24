import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type DocumentItem, type DocumentFilters, type DocType } from "../api/client";
import { DocumentList } from "../components/documents/DocumentList";
import { DocumentForm } from "../components/documents/DocumentForm";
import { EmptyState, ErrorState, Spinner } from "../components/ui";

const DOC_TYPES: DocType[] = ["passport", "visa", "booking", "insurance", "other"];

export function DocumentsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<DocumentFilters>({});
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: documents, isLoading, isError, refetch } = useQuery({
    queryKey: ["documents", filters],
    queryFn: () => api.listDocuments(filters),
  });

  const due = (documents ?? []).filter((d) => d.status === "overdue" || d.status === "upcoming");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["documents"] });
    qc.invalidateQueries({ queryKey: ["documents-due-count"] });
  };

  function setType(t: DocType | undefined) { setFilters((f) => ({ ...f, docType: t })); }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">🛂 Documents</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding(true)}>+ Add</button>
      </header>

      <div style={{ padding: 16, overflow: "auto" }}>
        {isError ? (
          <ErrorState hint="Couldn't load documents." onRetry={() => refetch()} />
        ) : isLoading ? (
          <Spinner label="Loading documents…" />
        ) : (documents && documents.length > 0) ? (
          <>
            {due.length > 0 && (
              <div className="renewals">
                <h4>⏰ Coming up ({due.length})</h4>
                <DocumentList documents={due} onOpen={setEditing} />
              </div>
            )}

            <div className="photo-filter-bar">
              {DOC_TYPES.map((t) => (
                <span key={t} className={`fchip ${filters.docType === t ? "act" : ""}`} onClick={() => setType(filters.docType === t ? undefined : t)}>{t}</span>
              ))}
              <input placeholder="Search…" value={filters.q ?? ""} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))} />
            </div>

            <DocumentList documents={documents} onOpen={setEditing} />
          </>
        ) : (
          <EmptyState emoji="🛂" title="No documents yet" hint="Add passports, visas, bookings and insurance — and we'll remind you before they expire."
            action={<button className="primary" onClick={() => setAdding(true)}>Add a document</button>} />
        )}
      </div>

      {(adding || editing) && (
        <DocumentForm
          doc={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}
