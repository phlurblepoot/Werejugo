export interface ModuleDef {
  key: string;
  label: string;
  icon: string; // emoji
  path: string;
  enabled: boolean;
}

// The left-rail modules, in build order. Only Map is live in Phase 1.
export const MODULES: ModuleDef[] = [
  { key: "map", label: "Map", icon: "🗺️", path: "/map", enabled: true },
  { key: "people", label: "People", icon: "👤", path: "/people", enabled: true },
  { key: "photos", label: "Photos", icon: "🖼️", path: "/photos", enabled: true },
  { key: "documents", label: "Documents", icon: "🛂", path: "/documents", enabled: true },
  { key: "planning", label: "Planning", icon: "📅", path: "/planning", enabled: true },
  { key: "packing", label: "Packing", icon: "🎒", path: "/packing", enabled: true },
];
