import { useEffect, useState } from "react";
import { api, type Person, type FamilyMember, type MediaDto } from "../../api/client";
import { MediaUploader } from "../shared/MediaUploader";
import { EntityThumb } from "../shared/EntityThumb";

interface Props {
  person: Person | null;
  onClose: () => void;
  onSaved: (person: Person) => void;
}

export function PersonForm({ person, onClose, onSaved }: Props) {
  const editing = Boolean(person);
  const [displayName, setDisplayName] = useState(person?.displayName ?? "");
  const [relationship, setRelationship] = useState(person?.relationship ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const [userId, setUserId] = useState<string | null>(person?.userId ?? null);
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(person?.avatarMediaId ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(person?.avatarUrl ?? null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.listFamilyMembers().then(setMembers).catch(() => setMembers([])); }, []);

  function onAvatar(media: MediaDto) {
    setAvatarMediaId(media.id);
    setAvatarUrl(media.thumbUrl ?? media.url);
  }

  async function save() {
    if (!displayName.trim()) { setError("Please enter a name."); return; }
    setBusy(true);
    setError(null);
    const payload = { displayName: displayName.trim(), relationship, notes, userId, avatarMediaId };
    try {
      const saved = editing && person
        ? await api.updatePerson(person.id, payload)
        : await api.createPerson(payload);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? "Edit person" : "Add person"}</h2>

        <div className="field" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <EntityThumb thumbUrl={avatarUrl} label={displayName || "?"} size={56} />
          <MediaUploader onUploaded={onAvatar} label="📷 Set photo" />
        </div>

        <div className="field">
          <label>Name</label>
          <input value={displayName} placeholder="e.g. Grandma" onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label>Relationship</label>
          <input value={relationship} placeholder="e.g. Grandmother" onChange={(e) => setRelationship(e.target.value)} />
        </div>
        <div className="field">
          <label>Linked account (optional)</label>
          <select value={userId ?? ""} onChange={(e) => setUserId(e.target.value || null)}>
            <option value="">— Not a login account —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.email})</option>)}
          </select>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
