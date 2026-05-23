import type { Item, ItemKind, Theme } from "../api/client";
import type { ItemStyle } from "../components/MapView";

export const KIND_DEFAULTS: Record<ItemKind, ItemStyle> = {
  place: { color: "#2563eb", icon: "pin", lineColor: "#2563eb", lineWidth: 3 },
  food: { color: "#ea580c", icon: "utensils", lineColor: "#ea580c", lineWidth: 3 },
  flight: { color: "#0ea5e9", icon: "plane", lineColor: "#0ea5e9", lineWidth: 3 },
  cruise: { color: "#0d9488", icon: "ship", lineColor: "#0d9488", lineWidth: 3 },
  drive: { color: "#7c3aed", icon: "car", lineColor: "#7c3aed", lineWidth: 3 },
  custom: { color: "#64748b", icon: "star", lineColor: "#64748b", lineWidth: 3 },
};

export function resolveItemStyle(item: Item, themesById: Map<string, Theme>): ItemStyle {
  const base = KIND_DEFAULTS[item.kind] ?? KIND_DEFAULTS.place;
  const theme = item.themeId ? themesById.get(item.themeId) : undefined;
  const color = item.color ?? theme?.color ?? base.color;
  const icon = item.icon ?? theme?.icon ?? base.icon;
  return {
    color,
    icon,
    lineColor: item.color ?? theme?.lineColor ?? base.lineColor,
    lineWidth: theme?.lineWidth ?? base.lineWidth,
  };
}

export const KIND_LABELS: Record<ItemKind, string> = {
  place: "Place",
  food: "Food",
  flight: "Flight",
  cruise: "Cruise",
  drive: "Drive",
  custom: "Custom",
};
