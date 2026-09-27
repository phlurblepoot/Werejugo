import { useState } from "react";
import { api, type CustomIcon, type Theme } from "../api/client";
import { API_URL } from "../api/client";
import { glyphFor, isImageIcon } from "../lib/icons";
import { StylePicker } from "./StylePicker";

interface Props {
  themes: Theme[];
  customIcons: CustomIcon[];
  onClose: () => void;
  onChanged: () => void;
}

export function ManagePanel({ themes, customIcons, onClose, onChanged }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [icon, setIcon] = useState("pin");
  const [busy, setBusy] = useState(false);
  const [iconName, setIconName] = useState("");
  // The theme being edited: its name, pin colour and icon, and trail colour.
  const [editing, setEditing] = useState<{ id: string; name: string; color: string; icon: string; lineColor: string } | null>(null);

  async function saveTheme() {
    if (!editing || !editing.name.trim()) return;
    setBusy(true);
    try {
      await api.updateTheme(editing.id, { name: editing.name.trim(), color: editing.color, icon: editing.icon, lineColor: editing.lineColor });
      setEditing(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addTheme() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createTheme({ name: name.trim(), color, icon, lineColor: color });
      setName("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function deleteTheme(id: string) {
    await api.deleteTheme(id);
    onChanged();
  }

  async function uploadIcon(file: File) {
    setBusy(true);
    try {
      await api.uploadIcon(file, iconName || file.name);
      setIconName("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function deleteIcon(id: string) {
    // Existing items referencing this icon URL will fall back to default styling.
    await api.deleteIcon(id);
    onChanged();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Themes &amp; icons</h2>

        <div className="section-title"><span>Your themes</span></div>
        {themes.filter((t) => !t.isBuiltin).length === 0 && (
          <div className="empty">No custom themes yet.</div>
        )}
        {themes.filter((t) => !t.isBuiltin).map((t) => editing?.id === t.id ? (
          <div key={t.id} className="theme-edit" role="group" aria-label={`Edit ${t.name}`}>
            <div className="field">
              <label htmlFor={`theme-name-${t.id}`}>Name</label>
              <input id={`theme-name-${t.id}`} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <StylePicker color={editing.color} icon={editing.icon} customIcons={customIcons}
              onColor={(c) => setEditing({ ...editing, color: c })} onIcon={(i) => setEditing({ ...editing, icon: i })} />
            <div className="field">
              <label htmlFor={`theme-line-${t.id}`}>Trail colour</label>
              <input id={`theme-line-${t.id}`} type="color" value={editing.lineColor} onChange={(e) => setEditing({ ...editing, lineColor: e.target.value })} />
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="primary" onClick={() => void saveTheme()} disabled={busy || !editing.name.trim()}>Save theme</button>
              <button onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={t.id} className="item-row">
            <div className="badge" style={{ background: t.color }}>
              {isImageIcon(t.icon) ? <img src={`${API_URL}${t.icon}`} alt="" /> : glyphFor(t.icon)}
            </div>
            <div className="meta"><div className="title">{t.name}</div></div>
            <button className="ghost" aria-label={`Edit ${t.name}`}
              onClick={() => setEditing({ id: t.id, name: t.name, color: t.color, icon: t.icon, lineColor: t.lineColor || t.color })}>✎</button>
            <button className="ghost" aria-label={`Delete ${t.name}`} onClick={() => deleteTheme(t.id)}>✕</button>
          </div>
        ))}

        <div className="section-title"><span>New theme</span></div>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beach days" />
        </div>
        <StylePicker color={color} icon={icon} customIcons={customIcons} onColor={setColor} onIcon={setIcon} />
        <button onClick={addTheme} disabled={busy || !name.trim()}>Add theme</button>

        <div className="section-title"><span>Custom icons</span></div>
        <div className="icon-grid" style={{ marginBottom: 8 }}>
          {customIcons.map((ci) => (
            <div key={ci.id} className="icon-choice" title={ci.name} style={{ position: "relative" }}>
              <img src={isImageIcon(ci.url) ? `${API_URL}${ci.url}` : ci.url} alt={ci.name} />
              <button
                className="ghost"
                style={{ position: "absolute", top: -8, right: -8, padding: "0 4px", fontSize: 11 }}
                onClick={() => deleteIcon(ci.id)}
              >
                ✕
              </button>
            </div>
          ))}
          {customIcons.length === 0 && <div className="empty">No custom icons yet.</div>}
        </div>
        <div className="field">
          <label>Icon name</label>
          <input value={iconName} onChange={(e) => setIconName(e.target.value)} placeholder="optional label" />
        </div>
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadIcon(e.target.files[0])} />

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
