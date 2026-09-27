import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, FileUp, Map as MapIcon, Palette, SlidersHorizontal } from "lucide-react";
import { api, type Item, type Photo, type Theme } from "../api/client";
import { useAuth } from "../lib/auth";
import { resolveItemStyle } from "../lib/style";
import type { LngLat } from "../lib/geo";
import { computeRoute } from "../lib/routing";
import { loadCountries, visitedCountryIds, type CountryCollection } from "../lib/countries";
import { applyFilters, isMine, readFilters, writeFilters, yearsOf, type MapFilters } from "../lib/mapFilters";
import { MapView } from "../components/MapView";
import { Sidebar } from "../components/Sidebar";
import { VisitEditor } from "../components/visit-editor/VisitEditor";
import { ItemDetail } from "../components/ItemDetail";
import { ManagePanel } from "../components/ManagePanel";
import { StatsPanel } from "../components/StatsPanel";
import { Lightbox } from "../components/Lightbox";
import { TimelineBar } from "../components/TimelineBar";
import { Legend } from "../components/Legend";
import { SettingsPanel } from "../components/SettingsPanel";
import { useToast } from "../components/Toast";
import { Button, Field, Modal, PageHeader } from "../components/kit";

/**
 * The one map: every place the family may see — its own, and those on trips
 * shared with it — filtered by what's in the URL (?trip=&person=&year=&kind=
 * &family=&q=), with ?visit=<id> opening a place.
 */
export function MapPage() {
  const { user, family } = useAuth();
  const qc = useQueryClient();
  const { toast, celebrate } = useToast();
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const setFilters = (change: Partial<MapFilters>) => setParams(writeFilters(params, change), { replace: true });
  const visitParam = params.get("visit");

  const visitsQuery = useQuery({ queryKey: ["visits"], queryFn: api.listVisits });
  const tripsQuery = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips() });
  const peopleQuery = useQuery({ queryKey: ["people"], queryFn: api.listPeople });
  const themesQuery = useQuery({ queryKey: ["themes"], queryFn: api.listThemes });
  const iconsQuery = useQuery({ queryKey: ["icons"], queryFn: api.listIcons });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });

  const themes = themesQuery.data ?? [];
  const themesById = useMemo(() => new Map<string, Theme>(themes.map((t) => [t.id, t])), [themes]);
  const customIcons = iconsQuery.data?.custom ?? [];
  const settings = settingsQuery.data;
  const items = useMemo(() => visitsQuery.data ?? [], [visitsQuery.data]);
  const trips = tripsQuery.data ?? [];
  const people = peopleQuery.data ?? [];
  const myFamilyId = user?.familyId;
  const hasShared = items.some((i) => !isMine(i, myFamilyId));

  const [timelineOn, setTimelineOn] = useState(false);
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null);
  const filterKey = params.toString();
  const filteredItems = useMemo(() => {
    const matching = applyFilters(items, filters, myFamilyId);
    if (!timelineOn || !timelineCursor) return matching;
    return matching.filter((i) => i.occurredOn && i.occurredOn <= timelineCursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filterKey, myFamilyId, timelineOn, timelineCursor]);
  // The legend counts what every other filter leaves, so a hidden kind can be switched back on.
  const legendItems = useMemo(
    () => applyFilters(items, { ...filters, kinds: [] }, myFamilyId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filterKey, myFamilyId],
  );

  function toggleTimeline() {
    if (!timelineOn) {
      const dated = items.map((i) => i.occurredOn).filter(Boolean).sort() as string[];
      setTimelineCursor(dated.length ? dated[dated.length - 1] : null);
      setTimelineOn(true);
    } else {
      setTimelineOn(false);
    }
  }

  // Passport: visited-countries highlight (lazy-loads bundled country polygons).
  const [passportOn, setPassportOn] = useState(false);
  const [visitedGeo, setVisitedGeo] = useState<{ type: "FeatureCollection"; features: unknown[] } | null>(null);
  const [visitedCount, setVisitedCount] = useState(0);
  const countriesRef = useRef<CountryCollection | null>(null);
  async function computeVisited() {
    if (!countriesRef.current) countriesRef.current = await loadCountries();
    const ids = visitedCountryIds(items, countriesRef.current);
    const features = countriesRef.current.features.filter((f) => ids.has(f.id ?? f.properties.name));
    setVisitedGeo({ type: "FeatureCollection", features });
    setVisitedCount(ids.size);
  }
  async function togglePassport() {
    if (passportOn) {
      setPassportOn(false);
      setVisitedGeo(null);
      return;
    }
    setPassportOn(true);
    await computeVisited();
  }
  useEffect(() => {
    if (passportOn) void computeVisited();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, passportOn]);

  // Selection: the open place lives in the URL (?visit=), so it can be linked to.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(visitParam);
  const detailItem = items.find((i) => i.id === visitParam) ?? null;
  useEffect(() => {
    if (visitParam) setSelectedItemId(visitParam);
  }, [visitParam]);
  function selectItem(id: string) {
    setSelectedItemId(id);
    const next = new URLSearchParams(params);
    next.set("visit", id);
    setParams(next, { replace: true });
  }
  function closeDetail() {
    const next = new URLSearchParams(params);
    next.delete("visit");
    setParams(next, { replace: true });
  }

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorItem, setEditorItem] = useState<Item | null>(null);
  const [panel, setPanel] = useState<null | "styles" | "appearance" | "stats" | "import">(null);
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Pick-on-map coordination
  const [pickActive, setPickActive] = useState(false);
  const pickResolver = useRef<((c: [number, number] | null) => void) | null>(null);
  function requestPick(): Promise<[number, number] | null> {
    setPickActive(true);
    return new Promise((resolve) => {
      pickResolver.current = resolve;
    });
  }
  function endPick(at: [number, number] | null) {
    pickResolver.current?.(at);
    pickResolver.current = null;
    setPickActive(false);
  }
  const handlePick = (lng: number, lat: number) => endPick([lng, lat]);
  // Escape (or the banner's Cancel) ends picking without a spot.
  useEffect(() => {
    if (!pickActive) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") endPick(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickActive]);

  const refreshItems = () => qc.invalidateQueries({ queryKey: ["visits"] });

  async function moveItemPoint(item: Item, lng: number, lat: number) {
    await api.updateItem(item.id, { geometry: { type: "Point", coordinates: [lng, lat] } });
    refreshItems();
  }
  async function moveItemWaypoint(item: Item, index: number, lng: number, lat: number) {
    const waypoints = item.waypoints.map((w, i) => (i === index ? { ...w, lng, lat } : w));
    const coords = waypoints.map((w) => [w.lng, w.lat] as LngLat);
    // Along roads for a drive, across water for a cruise (a moved port ends a CruiseMapper track).
    const { path, route, note } = await computeRoute(item.kind, coords);
    await api.updateItem(item.id, {
      waypoints, geometry: { type: "LineString", coordinates: path }, properties: { ...item.properties, route },
    });
    if (note) toast(note, "info");
    refreshItems();
  }

  async function deleteItem(id: string) {
    try {
      await api.deleteItem(id);
      closeDetail();
      refreshItems();
      toast("Place deleted", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete the place", "error");
    }
  }

  // Saved from the editor: celebrate the very first place, otherwise confirm the save.
  function handleItemSaved() {
    const wasFirstPin = editorItem === null && items.length === 0;
    setEditorOpen(false);
    refreshItems();
    if (wasFirstPin) {
      celebrate();
      toast("🎉 Your first memory is on the map!", "success");
    } else {
      toast(editorItem === null ? "Place added" : "Changes saved", "success");
    }
  }

  const toggleKind = (k: MapFilters["kinds"][number]) =>
    setFilters({ kinds: filters.kinds.includes(k) ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k] });

  return (
    <div className="app">
      <PageHeader
        icon={MapIcon}
        title="Map"
        subtitle={family?.name}
        menu={[
          { label: "Import places (GPX, KML, GeoJSON)", icon: FileUp, onSelect: () => setPanel("import") },
          { label: "Pin styles & icons", icon: Palette, onSelect: () => setPanel("styles") },
          { label: "Map appearance", icon: SlidersHorizontal, onSelect: () => setPanel("appearance") },
          { label: "Travel stats", icon: BarChart3, onSelect: () => setPanel("stats") },
        ]}
      />

      <Sidebar
        items={filteredItems}
        total={items.length}
        trips={trips}
        people={people}
        years={yearsOf(items)}
        hasShared={hasShared}
        myFamilyId={myFamilyId}
        filters={filters}
        onFilters={setFilters}
        themesById={themesById}
        settings={settings}
        selectedItemId={selectedItemId}
        onAddItem={() => { setEditorItem(null); setEditorOpen(true); }}
        onSelectItem={selectItem}
        onEditItem={(item) => { setEditorItem(item); setEditorOpen(true); }}
      />

      <div className="map-area">
        <MapView
          styleUrl={settings?.map?.styleUrl}
          items={filteredItems}
          selectedItemId={selectedItemId}
          getStyle={(item) => resolveItemStyle(item, themesById, settings)}
          pickMode={pickActive}
          editMode={editMode}
          visitedGeo={visitedGeo}
          onPick={handlePick}
          onSelectItem={selectItem}
          onMovePoint={moveItemPoint}
          onMoveWaypoint={moveItemWaypoint}
        />
        {!pickActive && (
          <div className="map-tools">
            <button className={editMode ? "primary" : ""} onClick={() => setEditMode((v) => !v)}>
              {editMode ? "✓ Done moving" : "✋ Move pins"}
            </button>
            <button className={timelineOn ? "primary" : ""} onClick={toggleTimeline}>🕐 Timeline</button>
            <button className={passportOn ? "primary" : ""} onClick={togglePassport}>
              🌍 Passport{passportOn ? ` (${visitedCount})` : ""}
            </button>
          </div>
        )}
        {editMode && <div className="map-edit-banner">Drag any pin to reposition — changes save automatically.</div>}
        {!visitsQuery.isLoading && items.length === 0 && !pickActive && (
          <div className="map-empty-hint">
            <span className="map-empty-hint-emoji" aria-hidden="true">📍</span>
            <span>No places yet — hit <strong>+ Add to map</strong> to drop your first memory.</span>
          </div>
        )}
        <Legend items={legendItems} kindFilter={filters.kinds} onToggleKind={toggleKind} />
        {timelineOn && (
          <TimelineBar items={items} cursor={timelineCursor} onCursor={setTimelineCursor} onClose={() => setTimelineOn(false)} />
        )}
      </div>

      {editorOpen && (
        <VisitEditor
          item={editorItem}
          themes={themes}
          trips={trips}
          customIcons={customIcons}
          onRequestPick={requestPick}
          onCancelPick={() => endPick(null)}
          onPhotosChanged={refreshItems}
          onClose={() => setEditorOpen(false)}
          onSaved={handleItemSaved}
          onIconsChanged={() => qc.invalidateQueries({ queryKey: ["icons"] })}
          pinSettings={settings?.pin}
          pathSettings={settings?.path}
        />
      )}

      {detailItem && !editorOpen && user && (
        <ItemDetail
          item={detailItem}
          trips={trips}
          user={user}
          onEdit={() => { setEditorItem(detailItem); setEditorOpen(true); }}
          onDelete={() => deleteItem(detailItem.id)}
          onClose={closeDetail}
          onOpenLightbox={(index) => setLightbox({ photos: detailItem.photos, index })}
        />
      )}

      {panel === "appearance" && (
        <SettingsPanel
          settings={settings ?? {}}
          customIcons={customIcons}
          onClose={() => setPanel(null)}
          onSaved={() => { setPanel(null); qc.invalidateQueries({ queryKey: ["settings"] }); }}
        />
      )}
      {panel === "styles" && (
        <ManagePanel
          themes={themes}
          customIcons={customIcons}
          onClose={() => setPanel(null)}
          onChanged={() => { qc.invalidateQueries({ queryKey: ["themes"] }); qc.invalidateQueries({ queryKey: ["icons"] }); }}
        />
      )}
      {panel === "stats" && <StatsPanel onClose={() => setPanel(null)} />}
      <ImportPlaces
        open={panel === "import"}
        trips={trips.map((t) => ({ id: t.id, name: t.name }))}
        onClose={() => setPanel(null)}
        onImported={(n) => { setPanel(null); refreshItems(); toast(`Imported ${n} place${n === 1 ? "" : "s"}`, "success"); }}
      />

      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onIndex={(index) => setLightbox((lb) => (lb ? { ...lb, index } : lb))}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

/** GPX tracks, KML placemarks or GeoJSON features onto the map (optionally onto a trip). */
function ImportPlaces({ open, trips, onClose, onImported }: {
  open: boolean; trips: Array<{ id: string; name: string }>; onClose: () => void; onImported: (count: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [tripId, setTripId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.importFile(file, tripId || null);
      setFile(null);
      onImported(r.imported);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} title="Import places"
      description="Tracks become drives; points become places. Anything that can't be read is skipped.">
      <form onSubmit={submit}>
        <Field label="File (.gpx, .kml or .geojson)" htmlFor="import-file">
          <input id="import-file" type="file" accept=".gpx,.kml,.geojson,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Put them on a trip (optional)" htmlFor="import-trip">
          <select id="import-trip" value={tripId} onChange={(e) => setTripId(e.target.value)}>
            <option value="">No trip</option>
            {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        {error && <div className="error-text" role="alert">{error}</div>}
        <div className="kit-modal-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={FileUp} loading={busy} disabled={!file}>Import</Button>
        </div>
      </form>
    </Modal>
  );
}
