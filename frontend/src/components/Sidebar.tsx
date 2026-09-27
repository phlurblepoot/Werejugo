import { Link } from "react-router-dom";
import type { FamilySettings, Item, ItemKind, Person, Theme, Trip } from "../api/client";
import { API_URL } from "../api/client";
import { glyphFor, isImageIcon } from "../lib/icons";
import { ITEM_KINDS, resolveItemStyle, KIND_LABELS } from "../lib/style";
import { formatDate } from "../lib/dates";
import { activeFilterCount, isMine, type MapFilters } from "../lib/mapFilters";
import { ByFamily } from "./shared/ByFamily";

interface Props {
  /** Places after filtering (what's listed and on the map). */
  items: Item[];
  /** How many places there are before filtering. */
  total: number;
  trips: Trip[];
  people: Person[];
  years: string[];
  /** Show the "added by" filter (some places come from other families). */
  hasShared: boolean;
  myFamilyId?: string;
  filters: MapFilters;
  onFilters: (change: Partial<MapFilters>) => void;
  themesById: Map<string, Theme>;
  settings?: FamilySettings;
  selectedItemId: string | null;
  onAddItem: () => void;
  onSelectItem: (id: string) => void;
  onEditItem: (item: Item) => void;
}

/** The map's side panel: filters (kept in the URL) and the places they match. */
export function Sidebar(props: Props) {
  const f = props.filters;
  const toggleKind = (k: ItemKind) =>
    props.onFilters({ kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] });
  const filtered = activeFilterCount(f) > 0;

  return (
    <div className="sidebar">
      <button className="primary" style={{ width: "100%" }} onClick={props.onAddItem}>+ Add to map</button>

      <div className="section-title">
        <span>Filter</span>
        {filtered && (
          <button className="ghost" onClick={() => props.onFilters({ q: "", kinds: [], trip: "", person: "", year: "", family: "" })}>
            Clear
          </button>
        )}
      </div>
      <input aria-label="Search places" placeholder="Search places…" value={f.q} onChange={(e) => props.onFilters({ q: e.target.value })} />
      <div className="chips">
        {ITEM_KINDS.map((k) => (
          <button key={k} className={`chip ${f.kinds.includes(k) ? "active" : ""}`} aria-pressed={f.kinds.includes(k)} onClick={() => toggleKind(k)}>
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="map-filter-grid">
        <select aria-label="Trip" value={f.trip} onChange={(e) => props.onFilters({ trip: e.target.value })}>
          <option value="">All trips</option>
          <option value="none">Not on a trip</option>
          {props.trips.map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.role && t.role !== "host" ? ` (${t.hostFamilyName})` : ""}</option>
          ))}
        </select>
        <select aria-label="Year" value={f.year} onChange={(e) => props.onFilters({ year: e.target.value })}>
          <option value="">Any year</option>
          {props.years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {props.people.length > 0 && (
          <select aria-label="Person" value={f.person} onChange={(e) => props.onFilters({ person: e.target.value })}>
            <option value="">Anyone</option>
            {props.people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        )}
        {props.hasShared && (
          <select aria-label="Added by" value={f.family} onChange={(e) => props.onFilters({ family: e.target.value as MapFilters["family"] })}>
            <option value="">Every family</option>
            <option value="mine">Our family</option>
            <option value="others">Other families</option>
          </select>
        )}
      </div>

      <div className="section-title">
        <span>Places ({props.items.length}{filtered ? ` of ${props.total}` : ""})</span>
      </div>
      {props.items.length === 0 && (
        <div className="empty">{props.total === 0 ? "No places yet — add your first one." : "Nothing matches. Clear the filters to see everything."}</div>
      )}

      {props.items.map((item) => {
        const style = resolveItemStyle(item, props.themesById, props.settings);
        const theirs = !isMine(item, props.myFamilyId);
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
                {item.occurredOn ? ` · ${formatDate(item.occurredOn)}` : ""}
                {item.waypoints.length ? <span className="tag">{item.waypoints.length} stops</span> : null}
                {item.photos.length ? <span className="tag">📷 {item.photos.length}</span> : null}
                {theirs && <> <ByFamily name={item.familyName} /></>}
              </div>
            </div>
            {item.canEdit !== false && (
              <button className="ghost" aria-label={`Edit ${item.title}`} onClick={(e) => { e.stopPropagation(); props.onEditItem(item); }}>✎</button>
            )}
          </div>
        );
      })}

      <p className="sidebar-links er-sub">
        Trips are planned in <Link to="/planning">Planning</Link>; every photo is in <Link to="/photos">Photos</Link>.
      </p>
    </div>
  );
}
