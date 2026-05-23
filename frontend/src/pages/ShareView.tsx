import { useEffect, useState } from "react";
import { api, type Item, type MapSet, type SharePayload, type Theme } from "../api/client";
import { resolveItemStyle } from "../lib/style";
import { MapView } from "../components/MapView";

const NO_THEMES = new Map<string, Theme>();
const noop = () => {};

export function ShareView({ token }: { token: string }) {
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getShare(token).then(setData).catch(() => setError("This shared map is unavailable or the link was revoked."));
  }, [token]);

  if (error) return <div className="centered">{error}</div>;
  if (!data) return <div className="centered">Loading shared map…</div>;

  const mapSet: MapSet = { id: "shared", createdAt: "", ...data.mapSet };
  const items: Item[] = data.items.map((i) => ({
    id: i.id,
    mapSetId: "shared",
    kind: i.kind,
    title: i.title,
    notes: i.notes,
    themeId: null,
    tripId: i.tripId,
    color: i.color,
    icon: i.icon,
    occurredOn: i.occurredOn,
    geometry: i.geometry,
    waypoints: i.waypoints,
    photos: i.photos,
    createdBy: null,
    createdByName: null,
    createdAt: "",
  }));

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <header className="app-header">
        <span className="brand">🗺️ {data.mapSet.name}</span>
        <span className="who">shared map · read-only</span>
        <span className="spacer" />
        <span className="who">{items.length} pins</span>
      </header>
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
    </div>
  );
}
