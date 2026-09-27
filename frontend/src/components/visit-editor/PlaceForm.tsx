import { useCallback, useState } from "react";
import { api } from "../../api/client";
import { PlaceSearch } from "../PlaceSearch";
import { mapCentre } from "../../lib/mapCentre";

interface Props {
  point: [number, number] | null;
  onSelect: (lng: number, lat: number, label: string) => void;
  onPick: () => void;
  onPhotoLocation: (lat: number, lng: number, date: string | null) => void;
}

export function PlaceForm({ point, onSelect, onPick, onPhotoLocation }: Props) {
  const [exifMsg, setExifMsg] = useState<string | null>(null);
  // Places near this one (or where the map is looking) first.
  const [lng, lat] = point ?? mapCentre() ?? [null, null];
  const search = useCallback(
    (q: string) => api.searchPlaces(q, lng != null && lat != null ? [lng, lat] : null),
    [lng, lat],
  );

  async function fromPhoto(file: File) {
    setExifMsg("Reading photo…");
    try {
      const { lat, lng, date } = await api.readExif(file);
      if (lat != null && lng != null) { onPhotoLocation(lat, lng, date); setExifMsg("Placed from photo GPS ✓"); }
      else setExifMsg("No GPS found in that photo.");
    } catch {
      setExifMsg("Could not read that photo.");
    }
  }

  return (
    <div className="field">
      <label>Location</label>
      <PlaceSearch placeholder="Search a place or address…" search={search} onSelect={(s) => onSelect(s.lng, s.lat, s.label)} />
      <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
        <button type="button" onClick={onPick}>📍 Pick on map</button>
        <label className="filebtn" style={{ margin: 0 }}>
          📷 From photo
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && fromPhoto(e.target.files[0])} />
        </label>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
        {exifMsg ?? (point ? `${point[1].toFixed(4)}, ${point[0].toFixed(4)}` : "No location set")}
      </div>
    </div>
  );
}
