import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Item, type MapSet, type Theme } from "../api/client";
import { useAuth } from "../lib/auth";
import { resolveItemStyle } from "../lib/style";
import { MapView } from "../components/MapView";
import { Sidebar } from "../components/Sidebar";
import { ItemEditor } from "../components/ItemEditor";
import { MapSetEditor } from "../components/MapSetEditor";
import { ManagePanel } from "../components/ManagePanel";

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

  const themes = themesQuery.data ?? [];
  const themesById = useMemo(() => new Map<string, Theme>(themes.map((t) => [t.id, t])), [themes]);
  const customIcons = iconsQuery.data?.custom ?? [];
  const items = itemsQuery.data ?? [];
  const mapSets = mapSetsQuery.data ?? [];
  const currentMapSet = mapSets.find((m) => m.id === currentMapSetId) ?? null;

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorItem, setEditorItem] = useState<Item | null>(null);
  const [mapSetEditor, setMapSetEditor] = useState<{ open: boolean; mapSet: MapSet | null }>({
    open: false,
    mapSet: null,
  });
  const [showManage, setShowManage] = useState(false);

  // Map "pick a location" coordination.
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
        <button onClick={logout}>Sign out</button>
      </header>

      <Sidebar
        mapSets={mapSets}
        currentMapSetId={currentMapSetId}
        items={items}
        themesById={themesById}
        selectedItemId={selectedItemId}
        onSelectMapSet={setCurrentMapSetId}
        onNewMapSet={() => setMapSetEditor({ open: true, mapSet: null })}
        onEditMapSet={(m) => setMapSetEditor({ open: true, mapSet: m })}
        onAddItem={() => {
          setEditorItem(null);
          setEditorOpen(true);
        }}
        onSelectItem={setSelectedItemId}
        onEditItem={(item) => {
          setEditorItem(item);
          setEditorOpen(true);
        }}
        onManage={() => setShowManage(true)}
      />

      <div className="map-area">
        {currentMapSet ? (
          <MapView
            mapSet={currentMapSet}
            items={items}
            selectedItemId={selectedItemId}
            getStyle={(item) => resolveItemStyle(item, themesById)}
            pickMode={pickActive}
            onPick={handlePick}
            onSelectItem={setSelectedItemId}
          />
        ) : (
          <div className="centered">Create a map set to get started.</div>
        )}
      </div>

      {editorOpen && currentMapSet && (
        <ItemEditor
          mapSet={currentMapSet}
          item={editorItem}
          themes={themes}
          customIcons={customIcons}
          onRequestPick={requestPick}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            refreshItems();
          }}
        />
      )}

      {mapSetEditor.open && (
        <MapSetEditor
          mapSet={mapSetEditor.mapSet}
          onClose={() => setMapSetEditor({ open: false, mapSet: null })}
          onSaved={(m) => {
            setMapSetEditor({ open: false, mapSet: null });
            setCurrentMapSetId(m.id);
            qc.invalidateQueries({ queryKey: ["mapSets"] });
          }}
          onDeleted={(id) => {
            setMapSetEditor({ open: false, mapSet: null });
            if (currentMapSetId === id) setCurrentMapSetId(null);
            qc.invalidateQueries({ queryKey: ["mapSets"] });
          }}
        />
      )}

      {showManage && (
        <ManagePanel
          themes={themes}
          customIcons={customIcons}
          onClose={() => setShowManage(false)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["themes"] });
            qc.invalidateQueries({ queryKey: ["icons"] });
          }}
        />
      )}
    </div>
  );
}
