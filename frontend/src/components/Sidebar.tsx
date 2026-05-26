import type { FamilySettings, Item, ItemKind, MapSet, Theme, Trip } from "../api/client";
import { API_URL } from "../api/client";
import { glyphFor, isImageIcon } from "../lib/icons";
import { resolveItemStyle, KIND_LABELS } from "../lib/style";

const ALL_KINDS: ItemKind[] = ["place", "food", "flight", "cruise", "drive", "custom"];

interface Props {
  mapSets: MapSet[];
  currentMapSetId: string | null;
  items: Item[];
  trips: Trip[];
  themesById: Map<string, Theme>;
  settings?: FamilySettings;
  selectedItemId: string | null;
  search: string;
  kindFilter: ItemKind[];
  tripFilter: string;
  onSearch: (s: string) => void;
  onToggleKind: (k: ItemKind) => void;
  onTripFilter: (id: string) => void;
  onSelectMapSet: (id: string) => void;
  onNewMapSet: () => void;
  onEditMapSet: (m: MapSet) => void;
  onAddItem: () => void;
  onSelectItem: (id: string) => void;
  onEditItem: (item: Item) => void;
  onManage: () => void;
  onSettings: () => void;
  onTrips: () => void;
  onStats: () => void;
  onGallery: () => void;
}

export function Sidebar(props: Props) {
  const current = props.mapSets.find((m) => m.id === props.currentMapSetId) ?? null;

  return (
    <div className="sidebar">
      <div className="section-title">
        <span>Map set</span>
        <button className="ghost" onClick={props.onNewMapSet}>+ New</button>
      </div>
      <div className="map-set-select">
        <select value={props.currentMapSetId ?? ""} onChange={(e) => props.onSelectMapSet(e.target.value)}>
          {props.mapSets.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {current && <button onClick={() => props.onEditMapSet(current)}>⚙</button>}
      </div>

      <div className="toolbar">
        <button className="ghost" onClick={props.onTrips}>🧳 Trips</button>
        <button className="ghost" onClick={props.onGallery}>🖼 Photos</button>
        <button className="ghost" onClick={props.onStats}>📊 Stats</button>
        <button className="ghost" onClick={props.onManage}>🎨 Themes</button>
        <button className="ghost" onClick={props.onSettings}>⚙ Settings</button>
      </div>

      <button className="primary" style={{ width: "100%", marginTop: 8 }} onClick={props.onAddItem} disabled={!current}>
        + Add to map
      </button>

      <div className="section-title"><span>Filter</span></div>
      <input placeholder="Search items…" value={props.search} onChange={(e) => props.onSearch(e.target.value)} />
      <div className="chips">
        {ALL_KINDS.map((k) => (
          <button
            key={k}
            className={`chip ${props.kindFilter.includes(k) ? "active" : ""}`}
            onClick={() => props.onToggleKind(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      {props.trips.length > 0 && (
        <select style={{ marginTop: 8 }} value={props.tripFilter} onChange={(e) => props.onTripFilter(e.target.value)}>
          <option value="">All trips</option>
          <option value="none">— No trip —</option>
          {props.trips.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      )}

      <div className="section-title"><span>Items ({props.items.length})</span></div>
      {props.items.length === 0 && <div className="empty">Nothing matches. Add a pin or clear filters.</div>}

      {props.items.map((item) => {
        const style = resolveItemStyle(item, props.themesById, props.settings);
        return (
          <div
            key={item.id}
            className={`item-row ${item.id === props.selectedItemId ? "active" : ""}`}
            onClick={() => props.onSelectItem(item.id)}
          >
            <div className="badge" style={{ background: style.color }}>
              {isImageIcon(style.icon) ? <img src={`${API_URL}${style.icon}`} alt="" /> : glyphFor(style.icon)}
            </div>
            <div className="meta">
              <div className="title">{item.title}</div>
              <div className="sub">
                {KIND_LABELS[item.kind]}
                {item.occurredOn ? ` · ${item.occurredOn}` : ""}
                {item.waypoints.length ? <span className="tag">{item.waypoints.length} stops</span> : null}
                {item.photos.length ? <span className="tag">📷 {item.photos.length}</span> : null}
              </div>
            </div>
            <button className="ghost" onClick={(e) => { e.stopPropagation(); props.onEditItem(item); }}>✎</button>
          </div>
        );
      })}
    </div>
  );
}
