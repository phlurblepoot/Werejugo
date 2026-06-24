import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Item, type MapSet, type SharePayload, type SharedPhoto, type Theme } from "../api/client";
import { resolveItemStyle } from "../lib/style";
import { MapView } from "../components/MapView";
import { EmptyState, Spinner } from "../components/ui";

const NO_THEMES = new Map<string, Theme>();
const noop = () => {};

function PhotoWall({ photos }: { photos: SharedPhoto[] }) {
  if (photos.length === 0) return <EmptyState emoji="🖼️" title="No photos in this album" />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, padding: 16, overflow: "auto" }}>
      {photos.map((p) => (
        <figure key={p.id} style={{ margin: 0 }}>
          <img src={p.thumbUrl ?? p.url} alt={p.caption} style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 8 }} />
          {p.caption && <figcaption className="er-sub">{p.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

export function ShareView() {
  const { token = "" } = useParams<{ token: string }>();
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getShare(token).then(setData).catch(() => setError("This shared link is unavailable or was revoked."));
  }, [token]);

  if (error) return <EmptyState emoji="🔌" title="Unavailable" hint={error} />;
  if (!data) return <Spinner label="Loading…" />;

  const header = (
    <header className="app-header">
      <span className="brand">{data.targetType === "album" ? "🖼️" : "🗺️"} {data.trip.name}</span>
      <span className="who">shared {data.targetType} · read-only</span>
      <span className="spacer" />
    </header>
  );

  if (data.targetType === "album") {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
        {header}
        <div style={{ flex: 1, overflow: "auto" }}><PhotoWall photos={data.photos} /></div>
      </div>
    );
  }

  // trip share — render the visits on a map
  const mapSet: MapSet = {
    id: "shared", name: data.trip.name, description: data.trip.description, baseKind: "vector",
    styleUrl: null, overlayUrl: null, overlayBounds: null, defaultLng: 0, defaultLat: 20, defaultZoom: 2, createdAt: "",
  };
  const items: Item[] = data.visits.map((v) => ({
    id: v.id, mapSetId: "shared", kind: v.kind, title: v.title, notes: v.notes, themeId: null, tripId: data.trip.id,
    color: v.color, icon: v.icon, occurredOn: v.occurredOn, geometry: v.geometry, waypoints: [], photos: v.photos,
    createdBy: null, createdByName: null, createdAt: "",
  }));

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {header}
      <div style={{ position: "relative", flex: 1 }}>
        <MapView
          mapSet={mapSet}
          items={items}
          selectedItemId={null}
          getStyle={(item) => resolveItemStyle(item, NO_THEMES)}
          pickMode={false}
          editMode={false}
          onPick={noop}
          onSelectItem={noop}
          onMovePoint={noop}
          onMoveWaypoint={noop}
        />
      </div>
      {data.photos.length > 0 && (
        <div style={{ maxHeight: "32vh", overflow: "auto", borderTop: "1px solid #1e293b" }}>
          <PhotoWall photos={data.photos} />
        </div>
      )}
    </div>
  );
}
