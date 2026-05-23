import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import Supercluster from "supercluster";
import type { Item, MapSet } from "../api/client";
import { API_URL } from "../api/client";
import { MAP_STYLE_URL } from "../lib/config";
import { glyphFor, isImageIcon } from "../lib/icons";
import { buildRoutePath, type LngLat } from "../lib/geo";

export interface ItemStyle {
  color: string;
  icon: string;
  lineColor: string;
  lineWidth: number;
}

interface Props {
  mapSet: MapSet;
  items: Item[];
  selectedItemId: string | null;
  getStyle: (item: Item) => ItemStyle;
  pickMode: boolean;
  editMode: boolean;
  visitedGeo?: { type: "FeatureCollection"; features: unknown[] } | null;
  onPick: (lng: number, lat: number) => void;
  onSelectItem: (id: string) => void;
  onMovePoint: (item: Item, lng: number, lat: number) => void;
  onMoveWaypoint: (item: Item, index: number, lng: number, lat: number) => void;
}

function absoluteUrl(url: string): string {
  return url.startsWith("/uploads/") ? `${API_URL}${url}` : url;
}

function customOverlayStyle(mapSet: MapSet): StyleSpecification {
  const b = mapSet.overlayBounds ?? [-180, -85, 180, 85];
  const [w, s, e, n] = b;
  return {
    version: 8,
    sources: {
      overlay: {
        type: "image",
        url: absoluteUrl(mapSet.overlayUrl ?? ""),
        coordinates: [
          [w, n],
          [e, n],
          [e, s],
          [w, s],
        ],
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0b1020" } },
      { id: "overlay", type: "raster", source: "overlay", paint: { "raster-opacity": 1 } },
    ],
  };
}

function styleFor(mapSet: MapSet): string | StyleSpecification {
  if (mapSet.baseKind === "custom" && mapSet.overlayUrl) return customOverlayStyle(mapSet);
  return mapSet.styleUrl || MAP_STYLE_URL;
}

export function MapView(props: Props) {
  const { mapSet, items, selectedItemId, pickMode, editMode, visitedGeo } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const pickRef = useRef(pickMode);
  pickRef.current = pickMode;

  // Latest props for use inside long-lived event handlers.
  const dataRef = useRef(props);
  dataRef.current = props;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(mapSet),
      center: [mapSet.defaultLng, mapSet.defaultLat],
      zoom: mapSet.defaultZoom,
    });
    map.addControl(new maplibregl.NavigationControl({}), "top-right");
    mapRef.current = map;

    map.on("click", (e) => {
      if (pickRef.current) onPickRef(e.lngLat.lng, e.lngLat.lat);
    });
    map.on("load", () => renderAll());
    // Re-cluster markers as the viewport changes.
    map.on("moveend", () => {
      if (mapRef.current?.isStyleLoaded()) renderMarkers(mapRef.current);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickRef = (lng: number, lat: number) => dataRef.current.onPick(lng, lat);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(styleFor(mapSet));
    map.once("styledata", () => renderAll());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSet.id, mapSet.baseKind, mapSet.overlayUrl, mapSet.styleUrl, JSON.stringify(mapSet.overlayBounds)]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  useEffect(() => {
    renderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedItemId, editMode, visitedGeo]);

  // Fly to an item when it becomes selected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedItemId) return;
    const item = items.find((i) => i.id === selectedItemId);
    const center = item && firstCoord(item);
    if (center) map.flyTo({ center, zoom: Math.max(map.getZoom(), 4), speed: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId]);

  function renderAll() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    renderVisited(map);
    renderRoutes(map);
    renderMarkers(map);
  }

  function renderVisited(map: maplibregl.Map) {
    const data = dataRef.current.visitedGeo ?? { type: "FeatureCollection", features: [] };
    const existing = map.getSource("visited") as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data as never);
    } else {
      map.addSource("visited", { type: "geojson", data: data as never });
      map.addLayer({
        id: "visited-fill",
        type: "fill",
        source: "visited",
        paint: { "fill-color": "#2563eb", "fill-opacity": 0.3, "fill-outline-color": "#60a5fa" },
      });
    }
  }

  function routeFeatures(override?: { itemId: string; coords: LngLat[] }) {
    const { items, getStyle } = dataRef.current;
    return items
      .filter((it) => it.geometry?.type === "LineString")
      .map((it) => {
        const coords =
          override && override.itemId === it.id
            ? override.coords
            : (it.geometry!.coordinates as number[][]);
        return {
          type: "Feature" as const,
          properties: { color: getStyle(it).lineColor, width: getStyle(it).lineWidth },
          geometry: { type: "LineString" as const, coordinates: coords },
        };
      });
  }

  function renderRoutes(map: maplibregl.Map, override?: { itemId: string; coords: LngLat[] }) {
    const data = { type: "FeatureCollection" as const, features: routeFeatures(override) };
    const existing = map.getSource("routes") as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data as never);
    } else {
      map.addSource("routes", { type: "geojson", data: data as never });
      map.addLayer({
        id: "routes-line",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": 0.85,
        },
      });
    }
  }

  function renderMarkers(map: maplibregl.Map) {
    const { items, getStyle, onSelectItem, onMovePoint, onMoveWaypoint } = dataRef.current;
    const handlers = { onSelectItem, onMoveWaypoint, onMovePoint };
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Route waypoints are always shown (not clustered).
    for (const item of items) {
      if (item.geometry?.type === "Point") continue;
      item.waypoints.forEach((wp, index) => {
        markersRef.current.push(makeMarker(map, item, getStyle(item), [wp.lng, wp.lat], index, handlers));
      });
    }

    // Point items are clustered by viewport + zoom.
    const pointItems = items.filter((i) => i.geometry?.type === "Point");
    const byId = new Map(pointItems.map((i) => [i.id, i]));
    const index = new Supercluster<{ itemId: string }>({ radius: 50, maxZoom: 16 });
    index.load(
      pointItems.map((i) => {
        const c = i.geometry!.coordinates as number[];
        return {
          type: "Feature" as const,
          properties: { itemId: i.id },
          geometry: { type: "Point" as const, coordinates: [c[0], c[1]] },
        };
      }),
    );
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    for (const c of index.getClusters(bbox, Math.round(map.getZoom()))) {
      const [lng, lat] = c.geometry.coordinates as [number, number];
      const props = c.properties as { cluster?: boolean; point_count?: number; cluster_id?: number; itemId?: string };
      if (props.cluster) {
        const el = buildClusterBadge(props.point_count ?? 0);
        el.addEventListener("click", () => {
          const z = Math.min(index.getClusterExpansionZoom(props.cluster_id!), 18);
          map.easeTo({ center: [lng, lat], zoom: z });
        });
        markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map));
      } else {
        const item = byId.get(props.itemId!);
        if (item) markersRef.current.push(makeMarker(map, item, getStyle(item), [lng, lat], null, handlers));
      }
    }
  }

  function buildClusterBadge(count: number): HTMLDivElement {
    const el = document.createElement("div");
    el.textContent = String(count);
    el.style.cssText =
      "width:34px;height:34px;border-radius:50%;background:#1e293b;color:#e2e8f0;" +
      "display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:700;" +
      "border:2px solid #60a5fa;box-shadow:0 1px 6px rgba(0,0,0,0.5);";
    return el;
  }

  function makeMarker(
    map: maplibregl.Map,
    item: Item,
    style: ItemStyle,
    lngLat: LngLat,
    waypointIndex: number | null,
    handlers: {
      onSelectItem: (id: string) => void;
      onMoveWaypoint: (item: Item, index: number, lng: number, lat: number) => void;
      onMovePoint: (item: Item, lng: number, lat: number) => void;
    },
  ): maplibregl.Marker {
    const el = buildBadge(style);
    const wp = waypointIndex !== null ? item.waypoints[waypointIndex] : null;
    const marker = new maplibregl.Marker({ element: el, draggable: dataRef.current.editMode })
      .setLngLat(lngLat)
      .setPopup(buildPopup(item, wp?.label))
      .addTo(map);

    let dragged = false;
    marker.on("dragstart", () => {
      dragged = false;
    });
    marker.on("drag", () => {
      dragged = true;
      // Live-update the route line as a waypoint is dragged.
      if (waypointIndex !== null) {
        const ll = marker.getLngLat();
        const coords: LngLat[] = item.waypoints.map((w, i) =>
          i === waypointIndex ? [ll.lng, ll.lat] : [w.lng, w.lat],
        );
        renderRoutes(map, { itemId: item.id, coords: buildRoutePath(item.kind, coords) });
      }
    });
    marker.on("dragend", () => {
      const ll = marker.getLngLat();
      if (waypointIndex !== null) handlers.onMoveWaypoint(item, waypointIndex, ll.lng, ll.lat);
      else handlers.onMovePoint(item, ll.lng, ll.lat);
    });
    el.addEventListener("click", () => {
      if (!dragged) handlers.onSelectItem(item.id);
    });
    return marker;
  }

  function buildPopup(item: Item, label?: string): maplibregl.Popup {
    const photo = item.photos[0];
    const html =
      (photo
        ? `<img src="${absoluteUrl(photo.url)}" style="width:100%;max-height:140px;object-fit:cover;border-radius:4px;margin-bottom:6px;" />`
        : "") +
      `<div class="title">${escapeHtml(item.title)}</div>` +
      (label ? `<div class="sub">${escapeHtml(label)}</div>` : "") +
      (item.occurredOn ? `<div class="sub">${escapeHtml(item.occurredOn)}</div>` : "") +
      (item.photos.length > 1 ? `<div class="sub">${item.photos.length} photos</div>` : "");
    return new maplibregl.Popup({ offset: 18, maxWidth: "260px" }).setHTML(html);
  }

  function buildBadge(style: ItemStyle): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "item-badge";
    el.style.cssText =
      `width:28px;height:28px;border-radius:50%;background:${style.color};` +
      "display:flex;align-items:center;justify-content:center;cursor:pointer;" +
      "box-shadow:0 1px 4px rgba(0,0,0,0.5);border:2px solid #fff;font-size:14px;";
    if (isImageIcon(style.icon)) {
      const img = document.createElement("img");
      img.src = absoluteUrl(style.icon);
      img.style.cssText = "width:18px;height:18px;object-fit:contain;";
      el.appendChild(img);
    } else {
      el.textContent = glyphFor(style.icon);
    }
    return el;
  }

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

function firstCoord(item: Item): LngLat | null {
  if (item.geometry?.type === "Point") {
    const c = item.geometry.coordinates as number[];
    return [c[0], c[1]];
  }
  if (item.waypoints.length) return [item.waypoints[0].lng, item.waypoints[0].lat];
  if (item.geometry?.type === "LineString") {
    const c = (item.geometry.coordinates as number[][])[0];
    return [c[0], c[1]];
  }
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
