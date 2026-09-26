import { Backpack, CalendarDays, IdCard, Images, Map as MapIcon, Users, type LucideIcon } from "lucide-react";

export interface ModuleDef {
  key: string;
  label: string;
  /** Short label for the phone tab bar. */
  short: string;
  icon: LucideIcon;
  path: string;
  /** Shown in the phone tab bar (the rest live under "More"). */
  tab: boolean;
}

export const MODULES: ModuleDef[] = [
  { key: "map", label: "Map", short: "Map", icon: MapIcon, path: "/map", tab: true },
  { key: "people", label: "People", short: "People", icon: Users, path: "/people", tab: false },
  { key: "photos", label: "Photos", short: "Photos", icon: Images, path: "/photos", tab: true },
  { key: "documents", label: "Documents", short: "Docs", icon: IdCard, path: "/documents", tab: true },
  { key: "planning", label: "Planning", short: "Trips", icon: CalendarDays, path: "/planning", tab: true },
  { key: "packing", label: "Packing", short: "Packing", icon: Backpack, path: "/packing", tab: false },
];

export const moduleByKey = (key: string): ModuleDef => {
  const m = MODULES.find((x) => x.key === key);
  if (!m) throw new Error(`Unknown module: ${key}`);
  return m;
};
