import type { Item, MapSet, Theme } from "../api/client";
import { API_URL } from "../api/client";
import { glyphFor, isImageIcon } from "../lib/icons";
import { resolveItemStyle, KIND_LABELS } from "../lib/style";

interface Props {
  mapSets: MapSet[];
  currentMapSetId: string | null;
  items: Item[];
  themesById: Map<string, Theme>;
  selectedItemId: string | null;
  onSelectMapSet: (id: string) => void;
  onNewMapSet: () => void;
  onEditMapSet: (m: MapSet) => void;
  onAddItem: () => void;
  onSelectItem: (id: string) => void;
  onEditItem: (item: Item) => void;
  onManage: () => void;
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
        <select
          value={props.currentMapSetId ?? ""}
          onChange={(e) => props.onSelectMapSet(e.target.value)}
        >
          {props.mapSets.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {current && <button onClick={() => props.onEditMapSet(current)}>⚙</button>}
      </div>
      {current?.description && (
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>{current.description}</p>
      )}

      <div className="section-title"><span>Add</span></div>
      <button className="primary" style={{ width: "100%" }} onClick={props.onAddItem} disabled={!current}>
        + Add to map
      </button>

      <div className="section-title">
        <span>Items ({props.items.length})</span>
        <button className="ghost" onClick={props.onManage}>Themes &amp; icons</button>
      </div>

      {props.items.length === 0 && <div className="empty">Nothing here yet. Add your first pin!</div>}

      {props.items.map((item) => {
        const style = resolveItemStyle(item, props.themesById);
        return (
          <div
            key={item.id}
            className={`item-row ${item.id === props.selectedItemId ? "active" : ""}`}
            onClick={() => props.onSelectItem(item.id)}
            onDoubleClick={() => props.onEditItem(item)}
          >
            <div className="badge" style={{ background: style.color }}>
              {isImageIcon(style.icon) ? (
                <img src={`${API_URL}${style.icon}`} alt="" />
              ) : (
                glyphFor(style.icon)
              )}
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
