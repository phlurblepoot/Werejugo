import type { FamilySettings, Item, ItemKind, PinSettings, PinStyle, PathStyle, Theme } from "../api/client";
import { isPatternStyle } from "./path";
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
export function resolveItemStyle(item: Item, themesById: Map<string, Theme>, settings?: FamilySettings): ItemStyle {
  const base = KIND_DEFAULTS[item.kind] ?? KIND_DEFAULTS.place;
  const theme = item.themeId ? themesById.get(item.themeId) : undefined;
  const lineName = typeof item.properties?.cruiseLine === "string" ? (item.properties.cruiseLine as string) : "";
  const pin = settings?.pin;
  const fam = pin?.default ?? {};
  const kindS = pin?.byKind?.[item.kind] ?? {};
  const lineS = lineName ? (pin?.byLine?.[lineName] ?? {}) : {};
  const itemPin = (item.properties?.pin ?? {}) as PinStyle;

  // Path (trail) style — independent of the pin's colours.
  const path = settings?.path;
  const pFam = path?.default ?? {};
  const pKind = path?.byKind?.[item.kind] ?? {};
  const pLine = lineName ? (path?.byLine?.[lineName] ?? {}) : {};
  const itemPath = (item.properties?.path ?? {}) as PathStyle;
  const pathStyle = itemPath.style ?? pLine.style ?? pKind.style ?? pFam.style ?? "solid";
  const lineColor = itemPath.color ?? pLine.color ?? pKind.color ?? pFam.color ?? theme?.lineColor ?? base.lineColor;
  const lineWidth = itemPath.width ?? pLine.width ?? pKind.width ?? pFam.width ?? (isPatternStyle(pathStyle) ? 9 : base.lineWidth);
  const pathImageUrl = itemPath.imageUrl ?? pLine.imageUrl ?? pKind.imageUrl ?? pFam.imageUrl;

  return {
    color: item.color ?? theme?.color ?? lineS.color ?? kindS.color ?? fam.color ?? base.color,
    icon: item.icon ?? theme?.icon ?? lineS.icon ?? kindS.icon ?? fam.icon ?? base.icon,
    lineColor,
    lineWidth,
    pathStyle,
    pathImageUrl,
    size: itemPin.size ?? lineS.size ?? kindS.size ?? fam.size ?? BASE_PIN.size,
    shape: itemPin.shape ?? lineS.shape ?? kindS.shape ?? fam.shape ?? BASE_PIN.shape,
    borderWidth: itemPin.borderWidth ?? lineS.borderWidth ?? kindS.borderWidth ?? fam.borderWidth ?? BASE_PIN.borderWidth,
    borderColor: itemPin.borderColor ?? lineS.borderColor ?? kindS.borderColor ?? fam.borderColor ?? BASE_PIN.borderColor,
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

/** Default trail style for a kind, from settings (per-kind → family → base). */
export function defaultPathStyle(kind: ItemKind, path?: import("../api/client").PathSettings) {
  const fam = path?.default ?? {};
  const k = path?.byKind?.[kind] ?? {};
  const style = k.style ?? fam.style ?? "solid";
  const color = k.color ?? fam.color ?? KIND_DEFAULTS[kind].lineColor;
  const width = k.width ?? fam.width ?? (isPatternStyle(style) ? 9 : 3);
  const imageUrl = k.imageUrl ?? fam.imageUrl;
  return { style, color, width, imageUrl };
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
