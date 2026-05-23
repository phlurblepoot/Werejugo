import { API_URL, type CustomIcon } from "../api/client";
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
}

export function StylePicker({ color, icon, customIcons, onColor, onIcon }: Props) {
  return (
    <>
      <div className="field">
        <label>Color</label>
        <div className="swatches">
          {PALETTE.map((c) => (
            <div
              key={c}
              className={`swatch ${c === color ? "active" : ""}`}
              style={{ background: c }}
              onClick={() => onColor(c)}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <label>Icon</label>
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
        </div>
      </div>
    </>
  );
}
