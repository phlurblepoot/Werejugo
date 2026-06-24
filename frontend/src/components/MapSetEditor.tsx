import { useState } from "react";
import { api, type MapSet } from "../api/client";
import { useToast } from "./Toast";

interface Props {
  mapSet: MapSet | null; // null = create
  onClose: () => void;
  onSaved: (m: MapSet) => void;
  onDeleted: (id: string) => void;
  onImported: () => void;
}

export function MapSetEditor({ mapSet, onClose, onSaved, onDeleted, onImported }: Props) {
  const { toast } = useToast();
  const editing = Boolean(mapSet);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function importFile(file: File) {
    if (!mapSet) return;
    setImportMsg("Importing…");
    try {
      const { imported, skipped } = await api.importFile(mapSet.id, file);
      const msg = `Imported ${imported} item(s)${skipped ? `, skipped ${skipped}` : ""}.`;
      setImportMsg(msg);
      onImported();
      toast(msg, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      setImportMsg(msg);
      toast(msg, "error");
    }
  }
  const [name, setName] = useState(mapSet?.name ?? "");
  const [description, setDescription] = useState(mapSet?.description ?? "");
  const [baseKind, setBaseKind] = useState<"vector" | "custom">(mapSet?.baseKind ?? "vector");
  const [styleUrl, setStyleUrl] = useState(mapSet?.styleUrl ?? "");
  const [overlayUrl, setOverlayUrl] = useState(mapSet?.overlayUrl ?? "");
  const [bounds, setBounds] = useState<number[]>(mapSet?.overlayBounds ?? [-100, 25, -80, 45]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadOverlay(file: File) {
    setBusy(true);
    try {
      const { url } = await api.uploadImage(file);
      setOverlayUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function setBound(i: number, v: number) {
    const next = [...bounds];
    next[i] = v;
    setBounds(next);
  }

  async function save() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Partial<MapSet> = {
      name: name.trim(),
      description,
      baseKind,
      styleUrl: styleUrl.trim() || null,
      overlayUrl: baseKind === "custom" ? overlayUrl || null : null,
      overlayBounds: baseKind === "custom" ? bounds : null,
    };
    try {
      const saved = editing && mapSet ? await api.updateMapSet(mapSet.id, payload) : await api.createMapSet(payload);
      toast(editing ? "Map set saved" : `Map set “${saved.name}” created`, "success");
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!mapSet) return;
    if (!confirm(`Delete "${mapSet.name}" and all its items? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteMapSet(mapSet.id);
      toast("Map set deleted", "success");
      onDeleted(mapSet.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete map set", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? "Map set settings" : "New map set"}</h2>

        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Trips" />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="field">
          <label>Base map</label>
          <div className="tabs">
            <button className={baseKind === "vector" ? "active" : ""} onClick={() => setBaseKind("vector")}>
              Vector map
            </button>
            <button className={baseKind === "custom" ? "active" : ""} onClick={() => setBaseKind("custom")}>
              Custom image
            </button>
          </div>
        </div>

        {baseKind === "vector" ? (
          <div className="field">
            <label>Custom vector style URL (optional — leave blank for default)</label>
            <input value={styleUrl} onChange={(e) => setStyleUrl(e.target.value)} placeholder="https://…/style.json" />
          </div>
        ) : (
          <>
            <div className="field">
              <label>Overlay image</label>
              <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadOverlay(e.target.files[0])} />
              {overlayUrl && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Uploaded ✓</div>}
            </div>
            <div className="field">
              <label>Image geographic bounds (west, south, east, north)</label>
              <div className="row">
                <input type="number" step="any" value={bounds[0]} onChange={(e) => setBound(0, Number(e.target.value))} />
                <input type="number" step="any" value={bounds[1]} onChange={(e) => setBound(1, Number(e.target.value))} />
                <input type="number" step="any" value={bounds[2]} onChange={(e) => setBound(2, Number(e.target.value))} />
                <input type="number" step="any" value={bounds[3]} onChange={(e) => setBound(3, Number(e.target.value))} />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                These tell the map where to place your image (corner longitudes/latitudes).
              </div>
            </div>
          </>
        )}

        {editing && (
          <>
            <div className="section-title"><span>Import items</span></div>
            <label className="filebtn">
              Choose GPX / KML / GeoJSON file…
              <input
                type="file"
                accept=".gpx,.kml,.geojson,.json,application/json"
                hidden
                onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
              />
            </label>
            {importMsg && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{importMsg}</div>}
          </>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          {editing && <button className="danger" onClick={remove} disabled={busy} style={{ marginRight: "auto" }}>Delete</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
