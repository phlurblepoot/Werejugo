import { useState } from "react";
import { api, API_URL, type DocType, type DocumentItem } from "../../api/client";
import { EntityPicker } from "../shared/EntityPicker";

type OwnerKind = "none" | "person" | "trip";
const DOC_TYPES: DocType[] = ["passport", "visa", "booking", "insurance", "other"];

interface Props { doc: DocumentItem | null; onClose: () => void; onSaved: () => void }

export function DocumentForm({ doc, onClose, onSaved }: Props) {
  const editing = Boolean(doc);
  const [title, setTitle] = useState(doc?.title ?? "");
  const [docType, setDocType] = useState<DocType>(doc?.docType ?? "passport");
  const [ownerKind, setOwnerKind] = useState<OwnerKind>(doc?.ownerPersonId ? "person" : doc?.ownerTripId ? "trip" : "none");
  const [ownerId, setOwnerId] = useState<string | null>(doc?.ownerPersonId ?? doc?.ownerTripId ?? null);
  const [ownerLabel, setOwnerLabel] = useState<string | null>(doc?.ownerPersonName ?? doc?.ownerTripName ?? null);
  const [issuedOn, setIssuedOn] = useState(doc?.issuedOn ?? "");
  const [expiresOn, setExpiresOn] = useState(doc?.expiresOn ?? "");
  const [reminderLeadDays, setReminderLeadDays] = useState(String(doc?.reminderLeadDays ?? 30));
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickOwnerKind(k: OwnerKind) { setOwnerKind(k); setOwnerId(null); setOwnerLabel(null); }

  async function save() {
    if (!title.trim()) { setError("Please enter a title."); return; }
    setBusy(true); setError(null);
    const data = {
      title: title.trim(), docType,
      ownerPersonId: ownerKind === "person" ? ownerId : null,
      ownerTripId: ownerKind === "trip" ? ownerId : null,
      issuedOn: issuedOn || null, expiresOn: expiresOn || null,
      reminderLeadDays: Number(reminderLeadDays) || 30, notes,
    };
    try {
      if (editing && doc) {
        await api.updateDocument(doc.id, data);
        if (file) await api.attachDocumentFile(doc.id, file);
      } else {
        await api.createDocument(data, file);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!doc) return;
    await api.deleteDocument(doc.id);
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? "Edit document" : "Add document"}</h2>

        <div className="field"><label>Title</label>
          <input value={title} placeholder="e.g. Passport" onChange={(e) => setTitle(e.target.value)} /></div>

        <div className="row">
          <div className="field"><label>Type</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label>Owner</label>
            <div className="tabs">
              {(["none", "person", "trip"] as OwnerKind[]).map((k) => (
                <button key={k} type="button" className={ownerKind === k ? "active" : ""} onClick={() => pickOwnerKind(k)}>
                  {k === "none" ? "None" : k === "person" ? "Person" : "Trip"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {ownerKind !== "none" && (
          <div className="field">
            <label>{ownerKind === "person" ? "Person" : "Trip"}</label>
            {ownerId ? (
              <span className="fchip act">{ownerLabel}
                <button aria-label="Clear owner" onClick={() => { setOwnerId(null); setOwnerLabel(null); }}>✕</button>
              </span>
            ) : (
              <EntityPicker type={ownerKind} placeholder={`Search ${ownerKind}…`} onPick={(e) => { setOwnerId(e.id); setOwnerLabel(e.label); }} />
            )}
          </div>
        )}

        <div className="row">
          <div className="field"><label>Issued</label><input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></div>
          <div className="field"><label>Expires</label><input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></div>
          <div className="field"><label>Remind (days before)</label><input type="number" value={reminderLeadDays} onChange={(e) => setReminderLeadDays(e.target.value)} /></div>
        </div>

        <div className="field"><label>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        <div className="field"><label>File (optional)</label>
          {doc?.fileUrl && <div><a href={`${API_URL}${doc.fileUrl}`} target="_blank" rel="noreferrer">📎 {doc.originalName || "View current file"}</a></div>}
          <input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>

        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          {editing && <button className="danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
