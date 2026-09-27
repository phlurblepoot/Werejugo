import { useState } from "react";
import type {
  CruiseDetails, FamilySettings, Geometry, Item, ItemKind, PathSettings, PathStyle, PinSettings, PinStyle, RouteInfo, Theme, Waypoint,
} from "../../api/client";
import { buildRoutePath, type LngLat } from "../../lib/geo";
import { inheritedStyle } from "../../lib/style";
import type { ItemStyle } from "../MapView";
import type { PinShapeVals } from "../PinStyleControls";
import type { PathVals } from "../PathStyleControls";

export const POINT_KINDS: ItemKind[] = ["place", "food", "stay", "custom"];

export interface VisitDraft {
  kind: ItemKind;
  title: string;
  notes: string;
  occurredOn: string;
  /** A cruise's last day. */
  occurredEnd: string;
  themeId: string | null;
  tripId: string | null;
  color: string;
  icon: string;
  pin: PinShapeVals;
  path: PathVals;
  point: [number, number] | null;
  stops: Waypoint[];
  routePath: number[][] | null;
  /** Where `routePath` came from (roads, water, CruiseMapper…) and its length. */
  route: RouteInfo | null;
  cruiseLine: string;
  ship: string;
  /** From CruiseMapper, kept with the cruise. */
  cruise: CruiseDetails | null;
  baseProperties: Record<string, unknown>;
}

export interface VisitError { field: "title" | "location"; message: string; }

/** What the draft's pin and trail would be without choices of its own (see inheritedStyle). */
function inheritedOf(d: Pick<VisitDraft, "kind" | "themeId" | "cruiseLine">, ctx: StyleContext, pathStyle?: string): ItemStyle {
  return inheritedStyle(d.kind, { themeId: d.themeId, cruiseLine: d.cruiseLine, pathStyle }, ctx.themesById, ctx.settings);
}
const pinOf = (s: ItemStyle): PinShapeVals => ({ size: s.size, shape: s.shape, borderWidth: s.borderWidth, borderColor: s.borderColor });
const pathOf = (s: ItemStyle): PathVals => ({ style: s.pathStyle, color: s.lineColor, width: s.lineWidth, imageUrl: s.pathImageUrl });

interface StyleContext { themesById: Map<string, Theme>; settings: FamilySettings }

function makeInitial(item: Item | null, kind: ItemKind, ctx: StyleContext): VisitDraft {
  const props = (item?.properties ?? {}) as Record<string, unknown>;
  const initPin = (props.pin ?? {}) as PinStyle;
  const initPath = (props.path ?? {}) as PathStyle;
  const cruiseLine = (props.cruiseLine as string) ?? "";
  const inh = inheritedOf({ kind, themeId: item?.themeId ?? null, cruiseLine }, ctx, initPath.style);
  const pinBase = pinOf(inh);
  const pathBase = pathOf(inh);
  const pt = item?.geometry?.type === "Point" ? (item.geometry.coordinates as number[]) : null;
  return {
    kind,
    title: item?.title ?? "",
    notes: item?.notes ?? "",
    occurredOn: item?.occurredOn ?? "",
    occurredEnd: item?.occurredEnd ?? "",
    themeId: item?.themeId ?? null,
    tripId: item?.tripId ?? null,
    color: item?.color ?? inh.color,
    icon: item?.icon ?? inh.icon,
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
    route: (props.route as RouteInfo | undefined) ?? null,
    cruiseLine,
    ship: (props.ship as string) ?? "",
    cruise: (props.cruise as CruiseDetails | undefined) ?? null,
    baseProperties: props,
  };
}

/**
 * The item's own style choices: what differs from what it would inherit (the
 * rest follows the family's defaults, its theme and its cruise line).
 */
export function ownStyle(d: VisitDraft, ctx: StyleContext) {
  const inh = inheritedOf(d, ctx);
  const inhPath = pathOf(inheritedOf(d, ctx, d.path.style));
  const pin = Object.fromEntries((Object.keys(d.pin) as Array<keyof PinShapeVals>)
    .filter((k) => d.pin[k] !== pinOf(inh)[k]).map((k) => [k, d.pin[k]])) as Partial<PinShapeVals>;
  const path = Object.fromEntries((Object.keys(d.path) as Array<keyof PathVals>)
    .filter((k) => d.path[k] !== undefined && d.path[k] !== (k === "style" ? pathOf(inh).style : inhPath[k]))
    .map((k) => [k, d.path[k]])) as Partial<PathVals>;
  return {
    color: d.color.toLowerCase() !== inh.color.toLowerCase() ? d.color : null,
    icon: d.icon !== inh.icon ? d.icon : null,
    pin,
    path,
  };
}

export function useVisitDraft(item: Item | null, pin?: PinSettings, path?: PathSettings, themes: Theme[] = []) {
  const ctx: StyleContext = { themesById: new Map(themes.map((t) => [t.id, t])), settings: { pin, path } };
  const [draft, setDraft] = useState<VisitDraft>(() => makeInitial(item, item?.kind ?? "place", ctx));

  /**
   * Another kind, theme or cruise line: whatever was still following the defaults
   * follows the new ones; the item's own choices stay.
   */
  function restyle(before: VisitDraft, after: VisitDraft): VisitDraft {
    const was = inheritedOf(before, ctx);
    const now = inheritedOf(after, ctx);
    const follow = <T,>(value: T, old: T, next: T) => (value === old ? next : value);
    const [wasPin, nowPin] = [pinOf(was), pinOf(now)];
    const style = follow(after.path.style, was.pathStyle, now.pathStyle);
    // A trail's default width depends on its style (patterns are wider).
    const wasWidth = inheritedOf(before, ctx, before.path.style).lineWidth;
    const nowWidth = inheritedOf(after, ctx, style).lineWidth;
    return {
      ...after,
      color: follow(after.color, was.color, now.color),
      icon: follow(after.icon, was.icon, now.icon),
      pin: Object.fromEntries((Object.keys(after.pin) as Array<keyof PinShapeVals>).map((k) => [k, follow(after.pin[k], wasPin[k], nowPin[k])])) as unknown as PinShapeVals,
      path: {
        ...after.path,
        style,
        color: follow(after.path.color, was.lineColor, now.lineColor),
        width: follow(after.path.width, wasWidth, nowWidth),
        imageUrl: follow(after.path.imageUrl, was.pathImageUrl, now.pathImageUrl),
      },
    };
  }

  const set = (patch: Partial<VisitDraft>) =>
    setDraft((d) => ("cruiseLine" in patch && patch.cruiseLine !== d.cruiseLine ? restyle(d, { ...d, ...patch }) : { ...d, ...patch }));

  function setKind(kind: ItemKind) {
    setDraft((d) => restyle(d, {
      ...d,
      kind,
      // Another kind's line (roads for a drive, water for a cruise) is worked out again.
      routePath: kind === d.kind ? d.routePath : null,
      route: kind === d.kind ? d.route : null,
    }));
  }

  function applyTheme(id: string | null) {
    setDraft((d) => restyle(d, { ...d, themeId: id }));
  }

  /** What this draft would get without choices of its own (for "Use default"). */
  const inherited = { ...inheritedOf(draft, ctx), lineWidth: inheritedOf(draft, ctx, draft.path.style).lineWidth };

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
    let route: RouteInfo | null = null;
    if (isPoint) {
      geometry = draft.point ? { type: "Point", coordinates: draft.point } : null;
    } else {
      const coords = draft.stops.map((s) => [s.lng, s.lat] as LngLat);
      const known = draft.routePath && draft.routePath.length >= 2;
      const line = known ? draft.routePath! : buildRoutePath(draft.kind, coords);
      if (line.length >= 2) geometry = { type: "LineString", coordinates: line };
      waypoints = draft.stops;
      // A line kept from before sources were recorded stays unknown.
      route = known ? draft.route : { source: draft.kind === "drive" ? "straight" : "great-circle" };
    }
    const properties: Record<string, unknown> = { ...draft.baseProperties };
    // Only the item's own choices: the rest follows the family's defaults.
    const own = ownStyle(draft, ctx);
    if (Object.keys(own.pin).length) properties.pin = own.pin; else delete properties.pin;
    if (!isPoint && Object.keys(own.path).length) properties.path = own.path; else delete properties.path;
    if (route) properties.route = route; else delete properties.route;
    if (draft.kind === "cruise") {
      if (draft.cruiseLine) properties.cruiseLine = draft.cruiseLine; else delete properties.cruiseLine;
      if (draft.ship) properties.ship = draft.ship; else delete properties.ship;
      if (draft.cruise) properties.cruise = draft.cruise; else delete properties.cruise;
    } else {
      delete properties.cruise;
    }
    return {
      kind: draft.kind,
      title: draft.title.trim(),
      notes: draft.notes,
      themeId: draft.themeId,
      tripId: draft.tripId,
      color: own.color,
      icon: own.icon,
      occurredOn: draft.occurredOn || null,
      ...(draft.kind === "cruise" ? { occurredEnd: draft.occurredEnd || null } : {}),
      geometry,
      waypoints,
      properties,
    };
  }

  return { draft, set, setKind, applyTheme, validate, buildPayload, inherited };
}
