import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { Item, MapSet } from "../api/client";
import { API_URL } from "../api/client";
import { MAP_STYLE_URL } from "../lib/config";
import { glyphFor, isImageIcon } from "../lib/icons";

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
  onPick: (lng: number, lat: number) => void;
  onSelectItem: (id: string) => void;
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

export function MapView({ mapSet, items, selectedItemId, getStyle, pickMode, onPick, onSelectItem }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const pickRef = useRef(pickMode);
  pickRef.current = pickMode;

  // Latest data, read inside event handlers without re-binding.
  const dataRef = useRef({ items, getStyle, selectedItemId, onSelectItem });
  dataRef.current = { items, getStyle, selectedItemId, onSelectItem };

  // Initialise the map once.
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
      if (pickRef.current) onPick(e.lngLat.lng, e.lngLat.lat);
    });
    map.on("load", () => renderAll());

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply the base style when the map set's base changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(styleFor(mapSet));
    map.once("styledata", () => renderAll());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSet.id, mapSet.baseKind, mapSet.overlayUrl, mapSet.styleUrl, JSON.stringify(mapSet.overlayBounds)]);

  // Cursor feedback for pick mode.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  // Re-render features when items or selection change.
  useEffect(() => {
    renderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedItemId]);

  function renderAll() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    renderRoutes(map);
    renderMarkers(map);
  }

  function renderRoutes(map: maplibregl.Map) {
    const { items, getStyle } = dataRef.current;
    const features = items
      .filter((it) => it.geometry?.type === "LineString")
      .map((it) => ({
        type: "Feature" as const,
        properties: { color: getStyle(it).lineColor, width: getStyle(it).lineWidth },
        geometry: it.geometry!,
      }));
    const data = { type: "FeatureCollection" as const, features };

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
    const { items, getStyle, onSelectItem } = dataRef.current;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const item of items) {
      const style = getStyle(item);
      const points: Array<{ lng: number; lat: number; label?: string }> = [];

      if (item.geometry?.type === "Point") {
        const c = item.geometry.coordinates as number[];
        points.push({ lng: c[0], lat: c[1] });
      }
      for (const wp of item.waypoints) {
        points.push({ lng: wp.lng, lat: wp.lat, label: wp.label });
      }
      // A point item with no geometry/waypoints can't be placed.
      for (const p of points) {
        const el = buildBadge(style);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 18 }).setHTML(
              `<div class="title">${escapeHtml(item.title)}</div>` +
                (p.label ? `<div class="sub">${escapeHtml(p.label)}</div>` : "") +
                (item.occurredOn ? `<div class="sub">${escapeHtml(item.occurredOn)}</div>` : ""),
            ),
          )
          .addTo(map);
        el.addEventListener("click", () => onSelectItem(item.id));
        markersRef.current.push(marker);
      }
    }
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
