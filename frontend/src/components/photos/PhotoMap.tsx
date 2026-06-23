import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { type MediaItem } from "../../api/client";

export interface PhotoFC {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { id: string } }>;
}

/** Geotagged photos → GeoJSON points (drops photos without coordinates). */
export function toFeatureCollection(items: MediaItem[]): PhotoFC {
  return {
    type: "FeatureCollection",
    features: items
      .filter((m) => m.lng != null && m.lat != null)
      .map((m) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [m.lng as number, m.lat as number] },
        properties: { id: m.id },
      })),
  };
}

const STYLE_URL =
  (import.meta as { env?: Record<string, string> }).env?.VITE_MAP_STYLE_URL ??
  "https://tiles.openfreemap.org/styles/liberty";

export function PhotoMap({ items, onOpen }: { items: MediaItem[]; onOpen: (item: MediaItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({ container: ref.current, style: STYLE_URL, center: [0, 20], zoom: 1.4 });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("photos", { type: "geojson", data: toFeatureCollection(items), cluster: true, clusterRadius: 50 });
      map.addLayer({ id: "clusters", type: "circle", source: "photos", filter: ["has", "point_count"],
        paint: { "circle-color": "#2563eb", "circle-radius": ["step", ["get", "point_count"], 14, 10, 20, 50, 28], "circle-opacity": 0.85 } });
      map.addLayer({ id: "cluster-count", type: "symbol", source: "photos", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#fff" } });
      map.addLayer({ id: "photo-pt", type: "circle", source: "photos", filter: ["!", ["has", "point_count"]],
        paint: { "circle-color": "#f59e0b", "circle-radius": 6, "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
      map.on("click", "photo-pt", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const item = id ? items.find((m) => m.id === id) : undefined;
        if (item) onOpen(item);
      });
    });
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource("photos") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(toFeatureCollection(items) as never);
  }, [items]);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
