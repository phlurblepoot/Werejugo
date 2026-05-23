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
        {themes.filter((t) => !t.isBuiltin).map((t) => (
          <div key={t.id} className="item-row">
            <div className="badge" style={{ background: t.color }}>
              {isImageIcon(t.icon) ? <img src={`${API_URL}${t.icon}`} alt="" /> : glyphFor(t.icon)}
            </div>
            <div className="meta"><div className="title">{t.name}</div></div>
            <button className="ghost" onClick={() => deleteTheme(t.id)}>✕</button>
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
