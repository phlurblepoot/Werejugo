import { API_URL, type PinShape } from "../api/client";
import { glyphFor, isImageIcon } from "../lib/icons";

export interface PinShapeVals {
  size: number;
  shape: PinShape;
  borderWidth: number;
  borderColor: string;
}

interface Props {
  value: PinShapeVals;
  color: string;
  icon: string;
  onChange: (v: PinShapeVals) => void;
}

function iconSrc(icon: string): string {
  return icon.startsWith("/uploads/") ? `${API_URL}${icon}` : icon;
}

export function PinStyleControls({ value, color, icon, onChange }: Props) {
  const set = (patch: Partial<PinShapeVals>) => onChange({ ...value, ...patch });
  const radius = value.shape === "circle" ? "50%" : value.shape === "rounded" ? "6px" : "0";
  const inner = Math.round(value.size * (value.shape === "none" ? 0.9 : 0.62));

  return (
    <>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Pin size ({value.size}px)</label>
          <input type="range" min={16} max={56} value={value.size} onChange={(e) => set({ size: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>Preview</label>
          <div className="pin-preview">
            <div
              style={{
                width: value.size,
                height: value.size,
                borderRadius: radius,
                background: value.shape !== "none" ? color : "transparent",
                border: value.shape !== "none" ? `${value.borderWidth}px solid ${value.borderColor}` : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: Math.round(value.size * 0.5),
                color: "#fff",
              }}
            >
              {isImageIcon(icon) ? (
                <img src={iconSrc(icon)} alt="" style={{ width: inner, height: inner, objectFit: "contain" }} />
              ) : (
                glyphFor(icon)
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Shape</label>
          <select value={value.shape} onChange={(e) => set({ shape: e.target.value as PinShape })}>
            <option value="circle">Circle</option>
            <option value="rounded">Rounded square</option>
            <option value="square">Square</option>
            <option value="none">Icon only</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Border ({value.borderWidth}px)</label>
          <input type="range" min={0} max={6} value={value.borderWidth} onChange={(e) => set({ borderWidth: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>Border color</label>
          <input
            type="color"
            className="color-input"
            value={/^#[0-9a-fA-F]{6}$/.test(value.borderColor) ? value.borderColor : "#ffffff"}
            onChange={(e) => set({ borderColor: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}
