import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Item, type ItemKind, type MapSet, type Photo, type Theme } from "../api/client";
import { useAuth } from "../lib/auth";
import { resolveItemStyle } from "../lib/style";
import { buildRoutePath, type LngLat } from "../lib/geo";
import { loadCountries, visitedCountryIds, type CountryCollection } from "../lib/countries";
import { MapView } from "../components/MapView";
import { Sidebar } from "../components/Sidebar";
import { ItemEditor } from "../components/ItemEditor";
import { ItemDetail } from "../components/ItemDetail";
import { MapSetEditor } from "../components/MapSetEditor";
import { ManagePanel } from "../components/ManagePanel";
import { TripsPanel } from "../components/TripsPanel";
import { StatsPanel } from "../components/StatsPanel";
import { GalleryPanel } from "../components/GalleryPanel";
import { Lightbox } from "../components/Lightbox";
import { TimelineBar } from "../components/TimelineBar";
import { Legend } from "../components/Legend";

export function MapPage() {
  const { user, family, logout } = useAuth();
  const qc = useQueryClient();

  const mapSetsQuery = useQuery({ queryKey: ["mapSets"], queryFn: api.listMapSets });
  const themesQuery = useQuery({ queryKey: ["themes"], queryFn: api.listThemes });
  const iconsQuery = useQuery({ queryKey: ["icons"], queryFn: api.listIcons });

  const [currentMapSetId, setCurrentMapSetId] = useState<string | null>(null);
  useEffect(() => {
    if (!currentMapSetId && mapSetsQuery.data?.length) {
      setCurrentMapSetId(mapSetsQuery.data[0].id);
    }
  }, [mapSetsQuery.data, currentMapSetId]);

  const itemsQuery = useQuery({
    queryKey: ["items", currentMapSetId],
    queryFn: () => api.listItems(currentMapSetId!),
    enabled: Boolean(currentMapSetId),
  });
  const tripsQuery = useQuery({
    queryKey: ["trips", currentMapSetId],
    queryFn: () => api.listTrips(currentMapSetId!),
    enabled: Boolean(currentMapSetId),
  });

  const themes = themesQuery.data ?? [];
  const themesById = useMemo(() => new Map<string, Theme>(themes.map((t) => [t.id, t])), [themes]);
  const customIcons = iconsQuery.data?.custom ?? [];
  const items = itemsQuery.data ?? [];
  const trips = tripsQuery.data ?? [];
  const mapSets = mapSetsQuery.data ?? [];
  const currentMapSet = mapSets.find((m) => m.id === currentMapSetId) ?? null;

  // Filters
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<ItemKind[]>([]);
  const [tripFilter, setTripFilter] = useState("");
  const [timelineOn, setTimelineOn] = useState(false);
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null);
  const toggleKind = (k: ItemKind) =>
    setKindFilter((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (q && !(`${i.title} ${i.notes}`.toLowerCase().includes(q))) return false;
      if (kindFilter.length && !kindFilter.includes(i.kind)) return false;
      if (tripFilter === "none" && i.tripId) return false;
      if (tripFilter && tripFilter !== "none" && i.tripId !== tripFilter) return false;
      if (timelineOn && timelineCursor && !(i.occurredOn && i.occurredOn <= timelineCursor)) return false;
      return true;
    });
  }, [items, search, kindFilter, tripFilter, timelineOn, timelineCursor]);

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
    if (passportOn) computeVisited();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, passportOn]);

  // Selection / modals
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const detailItem = items.find((i) => i.id === detailItemId) ?? null;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorItem, setEditorItem] = useState<Item | null>(null);
  const [mapSetEditor, setMapSetEditor] = useState<{ open: boolean; mapSet: MapSet | null }>({ open: false, mapSet: null });
  const [showManage, setShowManage] = useState(false);
  const [showTrips, setShowTrips] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Pick-on-map coordination
  const [pickActive, setPickActive] = useState(false);
  const pickResolver = useRef<((c: [number, number]) => void) | null>(null);
  function requestPick(): Promise<[number, number]> {
    setPickActive(true);
    return new Promise((resolve) => {
      pickResolver.current = resolve;
    });
  }
  function handlePick(lng: number, lat: number) {
    if (pickResolver.current) {
      pickResolver.current([lng, lat]);
      pickResolver.current = null;
    }
    setPickActive(false);
  }

  const refreshItems = () => qc.invalidateQueries({ queryKey: ["items", currentMapSetId] });
  const refreshTrips = () => qc.invalidateQueries({ queryKey: ["trips", currentMapSetId] });

  function selectItem(id: string) {
    setSelectedItemId(id);
    setDetailItemId(id);
  }

  async function moveItemPoint(item: Item, lng: number, lat: number) {
    await api.updateItem(item.id, { geometry: { type: "Point", coordinates: [lng, lat] } });
    refreshItems();
  }
  async function moveItemWaypoint(item: Item, index: number, lng: number, lat: number) {
    const waypoints = item.waypoints.map((w, i) => (i === index ? { ...w, lng, lat } : w));
    const coords = waypoints.map((w) => [w.lng, w.lat] as LngLat);
    const path = buildRoutePath(item.kind, coords);
    await api.updateItem(item.id, { waypoints, geometry: { type: "LineString", coordinates: path } });
    refreshItems();
  }

  async function deleteItem(id: string) {
    try {
      await api.deleteItem(id);
      setDetailItemId(null);
      refreshItems();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete item");
    }
  }

  async function exportData() {
    const data = await api.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `werejugo-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">🗺️ Werejugo</span>
        <span className="who">{family?.name}</span>
        <span className="spacer" />
        {family && (
          <span className="who" title="Share this code so family members can join">
            Invite: <strong>{family.inviteCode}</strong>
          </span>
        )}
        <span className="who">{user?.displayName}</span>
        <button onClick={exportData} title="Download a JSON backup of your family's data">⬇ Export</button>
        <button onClick={logout}>Sign out</button>
      </header>

      <Sidebar
        mapSets={mapSets}
        currentMapSetId={currentMapSetId}
        items={filteredItems}
        trips={trips}
        themesById={themesById}
        selectedItemId={selectedItemId}
        search={search}
        kindFilter={kindFilter}
        tripFilter={tripFilter}
        onSearch={setSearch}
        onToggleKind={toggleKind}
        onTripFilter={setTripFilter}
        onSelectMapSet={setCurrentMapSetId}
        onNewMapSet={() => setMapSetEditor({ open: true, mapSet: null })}
        onEditMapSet={(m) => setMapSetEditor({ open: true, mapSet: m })}
        onAddItem={() => { setEditorItem(null); setEditorOpen(true); }}
        onSelectItem={selectItem}
        onEditItem={(item) => { setEditorItem(item); setEditorOpen(true); }}
        onManage={() => setShowManage(true)}
        onTrips={() => setShowTrips(true)}
        onStats={() => setShowStats(true)}
        onGallery={() => setShowGallery(true)}
      />

      <div className="map-area">
        {currentMapSet ? (
          <>
            <MapView
              mapSet={currentMapSet}
              items={filteredItems}
              selectedItemId={selectedItemId}
              getStyle={(item) => resolveItemStyle(item, themesById)}
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
            <Legend items={items} kindFilter={kindFilter} onToggleKind={toggleKind} />
            {timelineOn && (
              <TimelineBar
                items={items}
                cursor={timelineCursor}
                onCursor={setTimelineCursor}
                onClose={() => setTimelineOn(false)}
              />
            )}
          </>
        ) : (
          <div className="centered">Create a map set to get started.</div>
        )}
      </div>

      {editorOpen && currentMapSet && (
        <ItemEditor
          mapSet={currentMapSet}
          item={editorItem}
          themes={themes}
          trips={trips}
          customIcons={customIcons}
          onRequestPick={requestPick}
          onClose={() => setEditorOpen(false)}
          onSaved={() => { setEditorOpen(false); refreshItems(); }}
          onIconsChanged={() => qc.invalidateQueries({ queryKey: ["icons"] })}
        />
      )}

      {detailItem && !editorOpen && user && (
        <ItemDetail
          item={detailItem}
          trips={trips}
          user={user}
          onEdit={() => { setEditorItem(detailItem); setEditorOpen(true); }}
          onDelete={() => deleteItem(detailItem.id)}
          onClose={() => setDetailItemId(null)}
          onOpenLightbox={(index) => setLightbox({ photos: detailItem.photos, index })}
        />
      )}

      {mapSetEditor.open && (
        <MapSetEditor
          mapSet={mapSetEditor.mapSet}
          onClose={() => setMapSetEditor({ open: false, mapSet: null })}
          onSaved={(m) => { setMapSetEditor({ open: false, mapSet: null }); setCurrentMapSetId(m.id); qc.invalidateQueries({ queryKey: ["mapSets"] }); }}
          onDeleted={(id) => { setMapSetEditor({ open: false, mapSet: null }); if (currentMapSetId === id) setCurrentMapSetId(null); qc.invalidateQueries({ queryKey: ["mapSets"] }); }}
          onImported={() => { if (mapSetEditor.mapSet) qc.invalidateQueries({ queryKey: ["items", mapSetEditor.mapSet.id] }); }}
        />
      )}

      {showManage && (
        <ManagePanel
          themes={themes}
          customIcons={customIcons}
          onClose={() => setShowManage(false)}
          onChanged={() => { qc.invalidateQueries({ queryKey: ["themes"] }); qc.invalidateQueries({ queryKey: ["icons"] }); }}
        />
      )}

      {showTrips && currentMapSetId && (
        <TripsPanel
          mapSetId={currentMapSetId}
          trips={trips}
          onClose={() => setShowTrips(false)}
          onChanged={refreshTrips}
        />
      )}

      {showStats && currentMapSetId && (
        <StatsPanel mapSetId={currentMapSetId} onClose={() => setShowStats(false)} />
      )}

      {showGallery && (
        <GalleryPanel
          items={filteredItems}
          onClose={() => setShowGallery(false)}
          onOpen={(photos, index) => setLightbox({ photos, index })}
        />
      )}

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
