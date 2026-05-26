import { useEffect, useState } from "react";
import {
  api,
  type CustomIcon,
  type FamilySettings,
  type ItemKind,
  type PathSettings,
  type PathStyle,
  type PinSettings,
  type PinStyle,
} from "../api/client";
import { KIND_LABELS, BASE_PIN, defaultColor, defaultIcon, defaultPinStyle, defaultPathStyle } from "../lib/style";
import { StylePicker } from "./StylePicker";
import { PinStyleControls } from "./PinStyleControls";
import { PathStyleControls } from "./PathStyleControls";

type Target = string; // "default" | ItemKind | `line:<name>`

const KIND_TARGETS: Array<{ key: string; label: string }> = [
  { key: "default", label: "All pins" },
  { key: "place", label: "Place" },
  { key: "food", label: "Food" },
  { key: "flight", label: "Flight" },
  { key: "cruise", label: "Cruise" },
  { key: "drive", label: "Drive" },
  { key: "custom", label: "Custom" },
];
const ROUTE_KINDS = new Set(["default", "flight", "cruise", "drive"]);

const isLine = (t: Target) => t.startsWith("line:");
const lineKey = (t: Target) => t.slice(5);

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
  const [lines, setLines] = useState<Array<{ name: string; url: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.searchCruiseLines("").then(setLines).catch(() => {});
  }, []);

  const showPath = ROUTE_KINDS.has(target) || isLine(target);

  const resolvedPin = (() => {
    if (target === "default") {
      const d = pin.default ?? {};
      return {
        color: d.color ?? "#2563eb",
        icon: d.icon ?? "pin",
        size: d.size ?? BASE_PIN.size,
        shape: d.shape ?? BASE_PIN.shape,
        borderWidth: d.borderWidth ?? BASE_PIN.borderWidth,
        borderColor: d.borderColor ?? BASE_PIN.borderColor,
      };
    }
    if (isLine(target)) {
      const lp = pin.byLine?.[lineKey(target)] ?? {};
      const cr = defaultPinStyle("cruise", pin);
      return {
        color: lp.color ?? defaultColor("cruise", pin),
        icon: lp.icon ?? defaultIcon("cruise", pin),
        size: lp.size ?? cr.size,
        shape: lp.shape ?? cr.shape,
        borderWidth: lp.borderWidth ?? cr.borderWidth,
        borderColor: lp.borderColor ?? cr.borderColor,
      };
    }
    const k = target as ItemKind;
    return { color: defaultColor(k, pin), icon: defaultIcon(k, pin), ...defaultPinStyle(k, pin) };
  })();

  const resolvedPath = (() => {
    if (target === "default") {
      const d = path.default ?? {};
      return { style: d.style ?? "solid", color: d.color ?? "#2563eb", width: d.width ?? 3, imageUrl: d.imageUrl };
    }
    if (isLine(target)) {
      const lp = path.byLine?.[lineKey(target)] ?? {};
      const cr = defaultPathStyle("cruise", path);
      return { style: lp.style ?? cr.style, color: lp.color ?? cr.color, width: lp.width ?? cr.width, imageUrl: lp.imageUrl ?? cr.imageUrl };
    }
    return defaultPathStyle(target as ItemKind, path);
  })();

  function patchPin(patch: Partial<PinStyle>) {
    setPin((prev) => {
      if (target === "default") return { ...prev, default: { ...(prev.default ?? {}), ...patch } };
      if (isLine(target)) {
        const key = lineKey(target);
        return { ...prev, byLine: { ...(prev.byLine ?? {}), [key]: { ...(prev.byLine?.[key] ?? {}), ...patch } } };
      }
      return { ...prev, byKind: { ...(prev.byKind ?? {}), [target]: { ...(prev.byKind?.[target as ItemKind] ?? {}), ...patch } } };
    });
  }

  function patchPath(patch: Partial<PathStyle>) {
    setPath((prev) => {
      if (target === "default") return { ...prev, default: { ...(prev.default ?? {}), ...patch } };
      if (isLine(target)) {
        const key = lineKey(target);
        return { ...prev, byLine: { ...(prev.byLine ?? {}), [key]: { ...(prev.byLine?.[key] ?? {}), ...patch } } };
      }
      return { ...prev, byKind: { ...(prev.byKind ?? {}), [target]: { ...(prev.byKind?.[target as ItemKind] ?? {}), ...patch } } };
    });
  }

  function resetTarget() {
    const clear = <T extends { default?: unknown; byKind?: Record<string, unknown>; byLine?: Record<string, unknown> }>(prev: T): T => {
      if (target === "default") return { ...prev, default: {} };
      if (isLine(target)) {
        const byLine = { ...(prev.byLine ?? {}) };
        delete byLine[lineKey(target)];
        return { ...prev, byLine };
      }
      const byKind = { ...(prev.byKind ?? {}) };
      delete byKind[target];
      return { ...prev, byKind };
    };
    setPin((p) => clear(p));
    setPath((p) => clear(p));
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

  const targetLabel = isLine(target) ? lineKey(target) : KIND_LABELS[target as ItemKind] ?? "defaults";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="section-title"><span>Default pin &amp; trail appearance</span></div>
        <p className="hint" style={{ marginTop: 0 }}>
          "All pins" applies everywhere; each type — or a specific cruise line — can override it.
        </p>

        <div className="chips">
          {KIND_TARGETS.map((t) => (
            <button key={t.key} className={`chip ${target === t.key ? "active" : ""}`} onClick={() => setTarget(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {lines.length > 0 && (
          <select
            style={{ marginTop: 8 }}
            value={isLine(target) ? lineKey(target) : ""}
            onChange={(e) => setTarget(e.target.value ? `line:${e.target.value}` : "default")}
          >
            <option value="">— Per cruise line… —</option>
            {lines.map((l) => (
              <option key={l.url} value={l.name}>{l.name}</option>
            ))}
          </select>
        )}

        <div style={{ marginTop: 12 }}>
          <StylePicker
            color={resolvedPin.color}
            icon={resolvedPin.icon}
            customIcons={customIcons}
            onColor={(c) => patchPin({ color: c })}
            onIcon={(i) => patchPin({ icon: i })}
          />
          <PinStyleControls
            value={{ size: resolvedPin.size, shape: resolvedPin.shape, borderWidth: resolvedPin.borderWidth, borderColor: resolvedPin.borderColor }}
            color={resolvedPin.color}
            icon={resolvedPin.icon}
            onChange={(v) => patchPin(v)}
          />
          {showPath && (
            <>
              <div className="section-title"><span>Default trail (path line)</span></div>
              <PathStyleControls value={resolvedPath} customIcons={customIcons} onChange={(v) => patchPath(v)} />
            </>
          )}
          <button className="ghost" style={{ marginTop: 4 }} onClick={resetTarget}>
            Reset {targetLabel} to built-in
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
