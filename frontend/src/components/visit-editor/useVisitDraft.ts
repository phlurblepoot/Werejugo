import { useState } from "react";
import type {
  Geometry, Item, ItemKind, PathSettings, PathStyle, PinSettings, PinStyle, Waypoint,
} from "../../api/client";
import { buildRoutePath, type LngLat } from "../../lib/geo";
import { defaultColor, defaultIcon, defaultPinStyle, defaultPathStyle } from "../../lib/style";
import type { PinShapeVals } from "../PinStyleControls";
import type { PathVals } from "../PathStyleControls";

export const POINT_KINDS: ItemKind[] = ["place", "food", "custom"];

export interface VisitDraft {
  kind: ItemKind;
  title: string;
  notes: string;
  occurredOn: string;
  themeId: string | null;
  tripId: string | null;
  color: string;
  icon: string;
  pin: PinShapeVals;
  path: PathVals;
  point: [number, number] | null;
  stops: Waypoint[];
  routePath: number[][] | null;
  cruiseLine: string;
  ship: string;
  baseProperties: Record<string, unknown>;
}

export interface VisitError { field: "title" | "location"; message: string; }

function makeInitial(item: Item | null, kind: ItemKind, pin?: PinSettings, path?: PathSettings): VisitDraft {
  const props = (item?.properties ?? {}) as Record<string, unknown>;
  const initPin = (props.pin ?? {}) as PinStyle;
  const pinBase = defaultPinStyle(kind, pin);
  const initPath = (props.path ?? {}) as PathStyle;
  const pathBase = defaultPathStyle(kind, path);
  const pt = item?.geometry?.type === "Point" ? (item.geometry.coordinates as number[]) : null;
  return {
    kind,
    title: item?.title ?? "",
    notes: item?.notes ?? "",
    occurredOn: item?.occurredOn ?? "",
    themeId: item?.themeId ?? null,
    tripId: item?.tripId ?? null,
    color: item?.color ?? defaultColor(kind, pin),
    icon: item?.icon ?? defaultIcon(kind, pin),
    pin: {
      size: initPin.size ?? pinBase.size,
      shape: initPin.shape ?? pinBase.shape,
      borderWidth: initPin.borderWidth ?? pinBase.borderWidth,
      borderColor: initPin.borderColor ?? pinBase.borderColor,
    },
    path: {
      style: initPath.style ?? pathBase.style,
      color: initPath.color ?? pathBase.color,
      width: initPath.width ?? pathBase.width,
      imageUrl: initPath.imageUrl ?? pathBase.imageUrl,
    },
    point: pt ? [pt[0], pt[1]] : null,
    stops: item?.waypoints ?? [],
    routePath: item?.geometry?.type === "LineString" ? (item.geometry.coordinates as number[][]) : null,
    cruiseLine: (props.cruiseLine as string) ?? "",
    ship: (props.ship as string) ?? "",
    baseProperties: props,
  };
}

export function useVisitDraft(item: Item | null, pin?: PinSettings, path?: PathSettings) {
  const [draft, setDraft] = useState<VisitDraft>(() => makeInitial(item, item?.kind ?? "place", pin, path));

  const set = (patch: Partial<VisitDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function setKind(kind: ItemKind) {
    setDraft((d) => ({
      ...d,
      kind,
      color: d.themeId ? d.color : defaultColor(kind, pin),
      icon: d.themeId ? d.icon : defaultIcon(kind, pin),
      pin: defaultPinStyle(kind, pin),
      path: defaultPathStyle(kind, path),
    }));
  }

  function applyTheme(id: string | null, themes: { id: string; color: string; icon: string }[]) {
    setDraft((d) => {
      const t = themes.find((x) => x.id === id);
      return t ? { ...d, themeId: id, color: t.color, icon: t.icon } : { ...d, themeId: id };
    });
  }

  function validate(): VisitError | null {
    if (!draft.title.trim()) return { field: "title", message: "Please give it a title." };
    const isPoint = POINT_KINDS.includes(draft.kind);
    if (isPoint && !draft.point) {
      return { field: "location", message: "Pick a location on the map or search for a place." };
    }
    if (!isPoint && draft.stops.length < 2 && !(draft.routePath && draft.routePath.length >= 2)) {
      return { field: "location", message: "Add at least two stops to draw the route." };
    }
    return null;
  }

  function buildPayload(): Partial<Item> {
    const isPoint = POINT_KINDS.includes(draft.kind);
    let geometry: Geometry | null = null;
    let waypoints: Waypoint[] = [];
    if (isPoint) {
      geometry = draft.point ? { type: "Point", coordinates: draft.point } : null;
    } else {
      const coords = draft.stops.map((s) => [s.lng, s.lat] as LngLat);
      const line = draft.routePath && draft.routePath.length >= 2 ? draft.routePath : buildRoutePath(draft.kind, coords);
      if (line.length >= 2) geometry = { type: "LineString", coordinates: line };
      waypoints = draft.stops;
    }
    const properties: Record<string, unknown> = { ...draft.baseProperties };
    properties.pin = draft.pin;
    if (isPoint) delete properties.path;
    else properties.path = draft.path;
    if (draft.kind === "cruise") {
      if (draft.cruiseLine) properties.cruiseLine = draft.cruiseLine; else delete properties.cruiseLine;
      if (draft.ship) properties.ship = draft.ship; else delete properties.ship;
    }
    return {
      kind: draft.kind,
      title: draft.title.trim(),
      notes: draft.notes,
      themeId: draft.themeId,
      tripId: draft.tripId,
      color: draft.color,
      icon: draft.icon,
      occurredOn: draft.occurredOn || null,
      geometry,
      waypoints,
      properties,
    };
  }

  return { draft, set, setKind, applyTheme, validate, buildPayload };
}
