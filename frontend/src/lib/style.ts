import type { Item, ItemKind, PinSettings, PinStyle, Theme } from "../api/client";
import type { ItemStyle } from "../components/MapView";

interface KindDefault {
  color: string;
  icon: string;
  lineColor: string;
  lineWidth: number;
}

export const KIND_DEFAULTS: Record<ItemKind, KindDefault> = {
  place: { color: "#2563eb", icon: "pin", lineColor: "#2563eb", lineWidth: 3 },
  food: { color: "#ea580c", icon: "utensils", lineColor: "#ea580c", lineWidth: 3 },
  flight: { color: "#0ea5e9", icon: "plane", lineColor: "#0ea5e9", lineWidth: 3 },
  cruise: { color: "#0d9488", icon: "ship", lineColor: "#0d9488", lineWidth: 3 },
  drive: { color: "#7c3aed", icon: "car", lineColor: "#7c3aed", lineWidth: 3 },
  custom: { color: "#64748b", icon: "star", lineColor: "#64748b", lineWidth: 3 },
};

export const BASE_PIN = {
  size: 28,
  shape: "circle" as const,
  borderWidth: 2,
  borderColor: "#ffffff",
};

/**
 * Resolve an item's full pin style, layering (lowest → highest precedence):
 * base → family default → per-kind default → theme → per-item override.
 */
export function resolveItemStyle(item: Item, themesById: Map<string, Theme>, pin?: PinSettings): ItemStyle {
  const base = KIND_DEFAULTS[item.kind] ?? KIND_DEFAULTS.place;
  const theme = item.themeId ? themesById.get(item.themeId) : undefined;
  const fam = pin?.default ?? {};
  const kindS = pin?.byKind?.[item.kind] ?? {};
  const itemPin = (item.properties?.pin ?? {}) as PinStyle;

  return {
    color: item.color ?? theme?.color ?? kindS.color ?? fam.color ?? base.color,
    icon: item.icon ?? theme?.icon ?? kindS.icon ?? fam.icon ?? base.icon,
    lineColor: item.color ?? theme?.lineColor ?? base.lineColor,
    lineWidth: theme?.lineWidth ?? base.lineWidth,
    size: itemPin.size ?? kindS.size ?? fam.size ?? BASE_PIN.size,
    shape: itemPin.shape ?? kindS.shape ?? fam.shape ?? BASE_PIN.shape,
    borderWidth: itemPin.borderWidth ?? kindS.borderWidth ?? fam.borderWidth ?? BASE_PIN.borderWidth,
    borderColor: itemPin.borderColor ?? kindS.borderColor ?? fam.borderColor ?? BASE_PIN.borderColor,
  };
}

/** The default size/shape/border for a kind, from settings (per-kind → family → base). */
export function defaultPinStyle(kind: ItemKind, pin?: PinSettings) {
  const fam = pin?.default ?? {};
  const k = pin?.byKind?.[kind] ?? {};
  return {
    size: k.size ?? fam.size ?? BASE_PIN.size,
    shape: k.shape ?? fam.shape ?? BASE_PIN.shape,
    borderWidth: k.borderWidth ?? fam.borderWidth ?? BASE_PIN.borderWidth,
    borderColor: k.borderColor ?? fam.borderColor ?? BASE_PIN.borderColor,
  };
}

export function defaultColor(kind: ItemKind, pin?: PinSettings): string {
  return pin?.byKind?.[kind]?.color ?? pin?.default?.color ?? KIND_DEFAULTS[kind].color;
}

export function defaultIcon(kind: ItemKind, pin?: PinSettings): string {
  return pin?.byKind?.[kind]?.icon ?? pin?.default?.icon ?? KIND_DEFAULTS[kind].icon;
}

export const KIND_LABELS: Record<ItemKind, string> = {
  place: "Place",
  food: "Food",
  flight: "Flight",
  cruise: "Cruise",
  drive: "Drive",
  custom: "Custom",
};
