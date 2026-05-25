import { useRef, useState } from "react";
import { api, API_URL, type CustomIcon } from "../api/client";
import { ICON_GLYPHS, isImageIcon } from "../lib/icons";

export const PALETTE = [
  "#2563eb", "#0ea5e9", "#0d9488", "#16a34a", "#ca8a04",
  "#ea580c", "#dc2626", "#db2777", "#7c3aed", "#475569",
];

interface Props {
  color: string;
  icon: string;
  customIcons: CustomIcon[];
  onColor: (c: string) => void;
  onIcon: (i: string) => void;
  // When provided, shows an inline "upload your own pin" tile.
  onUploaded?: () => void;
}

export function StylePicker({ color, icon, customIcons, onColor, onIcon, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const created = await api.uploadIcon(file, file.name.replace(/\.[^.]+$/, ""));
      onIcon(created.url); // select the new pin immediately
      onUploaded?.(); // let the parent refresh the family icon list
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="field">
        <label>Color</label>
        <div className="swatches" style={{ alignItems: "center" }}>
          {PALETTE.map((c) => (
            <div
              key={c}
              className={`swatch ${c.toLowerCase() === color.toLowerCase() ? "active" : ""}`}
              style={{ background: c }}
              onClick={() => onColor(c)}
            />
          ))}
          <input
            type="color"
            className="color-input"
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#2563eb"}
            onChange={(e) => onColor(e.target.value)}
            title="Pick any color"
          />
        </div>
      </div>
      <div className="field">
        <label>Icon / custom pin</label>
        <div className="icon-grid">
          {Object.keys(ICON_GLYPHS).map((name) => (
            <div
              key={name}
              className={`icon-choice ${icon === name ? "active" : ""}`}
              title={name}
              onClick={() => onIcon(name)}
            >
              {ICON_GLYPHS[name]}
            </div>
          ))}
          {customIcons.map((ci) => (
            <div
              key={ci.id}
              className={`icon-choice ${icon === ci.url ? "active" : ""}`}
              title={ci.name}
              onClick={() => onIcon(ci.url)}
            >
              <img src={isImageIcon(ci.url) ? `${API_URL}${ci.url}` : ci.url} alt={ci.name} />
            </div>
          ))}
          {onUploaded && (
            <div
              className="icon-choice"
              title="Upload a custom pin image"
              style={{ fontSize: 13, color: "var(--muted)" }}
              onClick={() => !busy && fileRef.current?.click()}
            >
              {busy ? "…" : "+ Pin"}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
