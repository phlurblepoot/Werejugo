import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { api, API_URL, type MediaFilters, type MediaType } from "../../api/client";
import { MAP_STYLE_URL } from "../../lib/config";

export interface PhotoFC {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { id: string; kind: MediaType } }>;
}

/** The map's compact points ([id, lng, lat, kind]) → GeoJSON. */
export function toFeatureCollection(points: Array<[string, number, number, MediaType]>): PhotoFC {
  return {
    type: "FeatureCollection",
    features: points.map(([id, lng, lat, kind]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { id, kind } })),
  };
}

/** Thumbnails shown at once, at most. */
export const MAX_THUMBS = 80;

/** When the map's own style can't load (offline tiles), photos still show on a plain background. */
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8e4dc" } }],
};

interface Spot { key: string; lngLat: [number, number]; clusterId?: number; count?: number; id?: string }

/**
 * Every geotagged photo that matches the library's filters, clustered. The
 * clusters and photos on screen show a thumbnail (one of their photos) with
 * the count; a click zooms into a cluster or opens the photo.
 */
export function PhotoMap({ filters, onOpen }: { filters: MediaFilters; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geo = useQuery({ queryKey: ["media", "geo", filters], queryFn: () => api.mediaGeo(filters) });
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const dataRef = useRef<PhotoFC | null>(null);
  const fitted = useRef(false);
  /** Set once the map exists: fit to the photos (first time) and redo the thumbnails. */
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({ container: ref.current, style: MAP_STYLE_URL, center: [0, 20], zoom: 1.4 });
    mapRef.current = map;
    let styleOk = false;
    map.on("error", () => { if (!styleOk) { styleOk = true; map.setStyle(BLANK_STYLE); } });

    const markers = new Map<string, maplibregl.Marker>();
    const thumbs = new Map<string, string | null>();
    let refreshing = 0;

    function addLayers() {
      styleOk = true;
      if (map.getSource("photos")) return;
      map.addSource("photos", { type: "geojson", data: dataRef.current ?? toFeatureCollection([]), cluster: true, clusterRadius: 80, clusterMaxZoom: 16 });
      map.addLayer({ id: "clusters", type: "circle", source: "photos", filter: ["has", "point_count"],
        paint: { "circle-color": "#0f766e", "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 100, 28], "circle-opacity": 0.8 } });
      map.addLayer({ id: "photo-pt", type: "circle", source: "photos", filter: ["!", ["has", "point_count"]],
        paint: { "circle-color": "#0f766e", "circle-radius": 6, "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
      fit();
      void refresh();
    }

    function fit() {
      const d = dataRef.current;
      if (fitted.current || !d?.features.length) return;
      fitted.current = true;
      const b = new maplibregl.LngLatBounds();
      for (const f of d.features) b.extend(f.geometry.coordinates);
      map.fitBounds(b, { padding: 60, maxZoom: 12, duration: 0 });
    }

    async function refresh() {
      const run = ++refreshing;
      const src = map.getSource("photos") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const bounds = map.getBounds();
      const spots = new Map<string, Spot>();
      for (const f of map.querySourceFeatures("photos")) {
        const p = f.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; id?: string };
        const lngLat = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        if (!bounds.contains(lngLat)) continue;
        const key = p.cluster ? `c${p.cluster_id}` : `p${p.id}`;
        if (!spots.has(key)) spots.set(key, { key, lngLat, clusterId: p.cluster ? p.cluster_id : undefined, count: p.point_count, id: p.id });
      }
      // The biggest clusters get their thumbnails first.
      for (const s of [...spots.values()].sort((a, b) => (b.count ?? 1) - (a.count ?? 1)).slice(MAX_THUMBS)) spots.delete(s.key);
      // A cluster shows one of its photos.
      await Promise.all([...spots.values()].filter((s) => s.clusterId !== undefined).map(async (s) => {
        const leaves = await src.getClusterLeaves(s.clusterId!, 1, 0).catch(() => []);
        s.id = (leaves[0]?.properties as { id?: string } | undefined)?.id;
      }));
      const missing = [...spots.values()].map((s) => s.id).filter((id): id is string => !!id && !thumbs.has(id));
      if (missing.length) {
        const links = await api.mediaLinks(missing).catch(() => ({} as Record<string, { thumbUrl: string | null }>));
        for (const id of missing) thumbs.set(id, links[id]?.thumbUrl ?? null);
      }
      if (run !== refreshing) return;

      for (const [key, m] of markers) if (!spots.has(key)) { m.remove(); markers.delete(key); }
      for (const s of spots.values()) {
        const thumb = s.id ? thumbs.get(s.id) : null;
        if (!thumb || markers.has(s.key)) continue;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-thumb";
        el.setAttribute("aria-label", s.count ? `${s.count} photos here` : "Open photo");
        const img = document.createElement("img");
        img.src = `${API_URL}${thumb}`;
        img.alt = "";
        // Not ready in Immich (or gone): a plain tile with the count is enough.
        img.addEventListener("error", () => img.remove(), { once: true });
        el.appendChild(img);
        if (s.count) {
          const c = document.createElement("span");
          c.className = "map-thumb-count";
          c.textContent = s.count > 999 ? `${Math.round(s.count / 1000)}k` : String(s.count);
          el.appendChild(c);
        }
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          if (s.clusterId !== undefined) {
            void src.getClusterExpansionZoom(s.clusterId).then((z) => map.easeTo({ center: s.lngLat, zoom: z }));
          } else if (s.id) {
            onOpenRef.current(s.id);
          }
        });
        markers.set(s.key, new maplibregl.Marker({ element: el }).setLngLat(s.lngLat).addTo(map));
      }
    }

    map.on("style.load", addLayers);
    map.on("moveend", () => void refresh());
    map.on("sourcedata", (e) => { if (e.sourceId === "photos" && e.isSourceLoaded) void refresh(); });
    map.on("click", "photo-pt", (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) onOpenRef.current(id);
    });
    redraw.current = () => { fit(); void refresh(); };
    return () => { for (const m of markers.values()) m.remove(); map.remove(); };
  }, []);

  useEffect(() => {
    if (!geo.data) return;
    dataRef.current = toFeatureCollection(geo.data.points);
    const map = mapRef.current;
    const src = map?.getSource("photos") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(dataRef.current as never);
      redraw.current();
    }
  }, [geo.data]);

  return (
    <div className="photo-map">
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      {geo.data && geo.data.points.length === 0 && <div className="photo-map-empty">No photos with a place match these filters.</div>}
    </div>
  );
}
