import { useState } from "react";
import { api, type CustomIcon, type FamilySettings, type ItemKind, type PathSettings, type PathStyle, type PinSettings, type PinStyle } from "../api/client";
import { KIND_LABELS, BASE_PIN, defaultColor, defaultIcon, defaultPinStyle, defaultPathStyle } from "../lib/style";
import { StylePicker } from "./StylePicker";
import { PinStyleControls } from "./PinStyleControls";
import { PathStyleControls } from "./PathStyleControls";

const ROUTE_TARGETS = new Set<Target>(["default", "flight", "cruise", "drive"]);

type Target = "default" | ItemKind;

const TARGETS: Array<{ key: Target; label: string }> = [
  { key: "default", label: "All pins" },
  { key: "place", label: "Place" },
  { key: "food", label: "Food" },
  { key: "flight", label: "Flight" },
  { key: "cruise", label: "Cruise" },
  { key: "drive", label: "Drive" },
  { key: "custom", label: "Custom" },
];

interface Props {
  settings: FamilySettings;
  customIcons: CustomIcon[];
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsPanel({ settings, customIcons, onClose, onSaved }: Props) {
  const [pin, setPin] = useState<PinSettings>(settings.pin ?? {});
  const [path, setPath] = useState<PathSettings>(settings.path ?? {});
  const [target, setTarget] = useState<Target>("default");
  const [busy, setBusy] = useState(false);

  // Effective values shown in the controls (explicit value, else inherited).
  const resolved =
    target === "default"
      ? {
          color: pin.default?.color ?? "#2563eb",
          icon: pin.default?.icon ?? "pin",
          size: pin.default?.size ?? BASE_PIN.size,
          shape: pin.default?.shape ?? BASE_PIN.shape,
          borderWidth: pin.default?.borderWidth ?? BASE_PIN.borderWidth,
          borderColor: pin.default?.borderColor ?? BASE_PIN.borderColor,
        }
      : { color: defaultColor(target, pin), icon: defaultIcon(target, pin), ...defaultPinStyle(target, pin) };

  function patchTarget(patch: Partial<PinStyle>) {
    setPin((prev) => {
      if (target === "default") return { ...prev, default: { ...(prev.default ?? {}), ...patch } };
      return { ...prev, byKind: { ...(prev.byKind ?? {}), [target]: { ...(prev.byKind?.[target] ?? {}), ...patch } } };
    });
  }

  const resolvedPath =
    target === "default"
      ? {
          style: path.default?.style ?? "solid",
          color: path.default?.color ?? "#2563eb",
          width: path.default?.width ?? 3,
        }
      : defaultPathStyle(target, path);

  function patchPath(patch: Partial<PathStyle>) {
    setPath((prev) => {
      if (target === "default") return { ...prev, default: { ...(prev.default ?? {}), ...patch } };
      return { ...prev, byKind: { ...(prev.byKind ?? {}), [target]: { ...(prev.byKind?.[target] ?? {}), ...patch } } };
    });
  }

  function resetTarget() {
    setPin((prev) => {
      if (target === "default") return { ...prev, default: {} };
      const byKind = { ...(prev.byKind ?? {}) };
      delete byKind[target];
      return { ...prev, byKind };
    });
    setPath((prev) => {
      if (target === "default") return { ...prev, default: {} };
      const byKind = { ...(prev.byKind ?? {}) };
      delete byKind[target];
      return { ...prev, byKind };
    });
  }

  async function save() {
    setBusy(true);
    try {
      await api.saveSettings({ ...settings, pin, path });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="section-title"><span>Default pin appearance</span></div>
        <p className="hint" style={{ marginTop: 0 }}>
          Set how pins look by default. "All pins" applies everywhere; each type can override it.
        </p>

        <div className="chips">
          {TARGETS.map((t) => (
            <button key={t.key} className={`chip ${target === t.key ? "active" : ""}`} onClick={() => setTarget(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <StylePicker
            color={resolved.color}
            icon={resolved.icon}
            customIcons={customIcons}
            onColor={(c) => patchTarget({ color: c })}
            onIcon={(i) => patchTarget({ icon: i })}
          />
          <PinStyleControls
            value={{ size: resolved.size, shape: resolved.shape, borderWidth: resolved.borderWidth, borderColor: resolved.borderColor }}
            color={resolved.color}
            icon={resolved.icon}
            onChange={(v) => patchTarget(v)}
          />
          {ROUTE_TARGETS.has(target) && (
            <>
              <div className="section-title"><span>Default trail (path line)</span></div>
              <PathStyleControls
                value={resolvedPath}
                onChange={(v) => patchPath(v)}
              />
            </>
          )}

          <button className="ghost" style={{ marginTop: 4 }} onClick={resetTarget}>
            Reset {target === "default" ? "defaults" : KIND_LABELS[target]} to built-in
          </button>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
        </div>
      </div>
    </div>
  );
}
