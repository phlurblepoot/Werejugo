import { useEffect, useRef } from "react";
import { API_URL, type CustomIcon, type PathStyleName } from "../api/client";
import { PATH_STYLES, drawPathPreview } from "../lib/path";

export interface PathVals {
  style: PathStyleName;
  color: string;
  width: number;
  imageUrl?: string;
}

interface Props {
  value: PathVals;
  customIcons: CustomIcon[];
  onChange: (v: PathVals) => void;
}

const iconSrc = (url: string) => (url.startsWith("/uploads/") ? `${API_URL}${url}` : url);

export function PathStyleControls({ value, customIcons, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const set = (patch: Partial<PathVals>) => onChange({ ...value, ...patch });
  const isImage = value.style === "image";

  useEffect(() => {
    if (canvasRef.current && !isImage) drawPathPreview(canvasRef.current, value.style, value.color);
  }, [value.style, value.color, isImage]);

  return (
    <>
      <div className="field">
        <label>Trail style</label>
        <select value={value.style} onChange={(e) => set({ style: e.target.value as PathStyleName })}>
          {PATH_STYLES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {isImage && (
        <div className="field">
          <label>Pick an image (made of repeating logos)</label>
          {customIcons.length === 0 ? (
            <div className="empty">Upload an image first (the "+ Pin" tile in the icon picker, or Themes &amp; icons).</div>
          ) : (
            <div className="icon-grid">
              {customIcons.map((ci) => (
                <div
                  key={ci.id}
                  className={`icon-choice ${value.imageUrl === ci.url ? "active" : ""}`}
                  title={ci.name}
                  onClick={() => set({ imageUrl: ci.url })}
                >
                  <img src={iconSrc(ci.url)} alt={ci.name} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ alignItems: "flex-end" }}>
        {!isImage && (
          <div className="field">
            <label>Trail color</label>
            <input
              type="color"
              className="color-input"
              value={/^#[0-9a-fA-F]{6}$/.test(value.color) ? value.color : "#2563eb"}
              onChange={(e) => set({ color: e.target.value })}
            />
          </div>
        )}
        <div className="field" style={{ flex: 1 }}>
          <label>Trail width ({value.width}px)</label>
          <input type="range" min={2} max={20} value={value.width} onChange={(e) => set({ width: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>Preview</label>
          {isImage ? (
            <div className="pin-preview" style={{ width: 120 }}>
              {value.imageUrl ? <img src={iconSrc(value.imageUrl)} alt="" style={{ maxHeight: 28, maxWidth: 110 }} /> : <span style={{ color: "var(--muted)", fontSize: 11 }}>none</span>}
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              width={120}
              height={28}
              style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", display: "block" }}
            />
          )}
        </div>
      </div>
    </>
  );
}
