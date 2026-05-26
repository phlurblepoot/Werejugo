import { useEffect, useRef } from "react";
import type { PathStyleName } from "../api/client";
import { PATH_STYLES, drawPathPreview } from "../lib/path";

export interface PathVals {
  style: PathStyleName;
  color: string;
  width: number;
}

interface Props {
  value: PathVals;
  onChange: (v: PathVals) => void;
}

export function PathStyleControls({ value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const set = (patch: Partial<PathVals>) => onChange({ ...value, ...patch });

  useEffect(() => {
    if (canvasRef.current) drawPathPreview(canvasRef.current, value.style, value.color);
  }, [value.style, value.color]);

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
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>Trail color</label>
          <input
            type="color"
            className="color-input"
            value={/^#[0-9a-fA-F]{6}$/.test(value.color) ? value.color : "#2563eb"}
            onChange={(e) => set({ color: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Trail width ({value.width}px)</label>
          <input type="range" min={2} max={16} value={value.width} onChange={(e) => set({ width: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>Preview</label>
          <canvas
            ref={canvasRef}
            width={120}
            height={28}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", display: "block" }}
          />
        </div>
      </div>
    </>
  );
}
