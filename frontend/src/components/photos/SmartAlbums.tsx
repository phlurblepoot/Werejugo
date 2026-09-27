import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Bookmark, Pencil, Trash2, X } from "lucide-react";
import { api, type MediaFilters, type SmartAlbum, type SmartAlbumFilters } from "../../api/client";
import { useToast } from "../Toast";
import { Button, Field, IconButton, Menu, Modal, useConfirm, type MenuEntry } from "../kit";
import { ShareButton } from "../shared/ShareButton";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const KEYS = ["person", "trip", "visit", "from", "to", "kind", "noTrip", "q"] as const;

/** What a smart album keeps from the page: its filters and search, empty ones dropped. */
export function albumFilters(filters: MediaFilters, q: string): SmartAlbumFilters {
  const all: Record<string, unknown> = { ...filters, q: q.trim() };
  return Object.fromEntries(KEYS.filter((k) => all[k] !== undefined && all[k] !== "").map((k) => [k, all[k]])) as SmartAlbumFilters;
}
export const sameFilters = (a: SmartAlbumFilters, b: SmartAlbumFilters) =>
  KEYS.every((k) => (a[k] ?? "") === (b[k] ?? ""));

/** The Photos page's smart albums: open one, or save the current search and filters as one. */
export function SmartAlbumMenu({ albums, current, onOpen, onSave }: {
  albums: SmartAlbum[];
  current: SmartAlbumFilters;
  onOpen: (a: SmartAlbum) => void;
  onSave: () => void;
}) {
  const items: MenuEntry[] = [
    ...albums.map((a) => ({ label: a.name, icon: Bookmark, onSelect: () => onOpen(a) })),
    ...(albums.length ? ["separator" as const] : []),
    { label: "Save as smart album…", icon: BookmarkPlus, onSelect: onSave, disabled: !Object.keys(current).length },
  ];
  return (
    <Menu
      header={albums.length ? "Smart albums" : "Smart albums keep a search and filters, and fill themselves as photos arrive."}
      items={items}
      trigger={<IconButton icon={Bookmark} label="Smart albums" />}
    />
  );
}

export function SaveAlbumDialog({ filters, onClose, onSaved }: {
  filters: SmartAlbumFilters;
  onClose: () => void;
  onSaved: (a: SmartAlbum) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(filters.q ? filters.q[0].toUpperCase() + filters.q.slice(1) : "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const a = await api.createSmartAlbum(name.trim(), filters);
      await qc.invalidateQueries({ queryKey: ["smart-albums"] });
      toast(`Saved “${a.name}”`, "success");
      onSaved(a);
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open onOpenChange={(o) => !o && onClose()} title="Save as smart album" size="sm"
      description="It keeps this search and these filters, and fills itself as new photos arrive."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>Save</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(); }}>
        <Field label="Name" htmlFor="album-name">
          <input id="album-name" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/** The open smart album: its name, and rename, update, share, delete and close. */
export function AlbumBar({ album, current, onClose, onChanged }: {
  album: SmartAlbum;
  current: SmartAlbumFilters;
  onClose: () => void;
  onChanged: (a: SmartAlbum | null) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState<string | null>(null);
  const changed = !sameFilters(album.filters, current) && Object.keys(current).length > 0;

  async function run(action: () => Promise<SmartAlbum | null>, done: string) {
    try {
      const a = await action();
      await qc.invalidateQueries({ queryKey: ["smart-albums"] });
      toast(done, "success");
      onChanged(a);
    } catch (e) {
      toast(errText(e), "error");
    }
  }
  async function remove() {
    const ok = await confirm({ title: `Delete “${album.name}”?`, message: "Only the smart album goes; its photos stay. Links you shared stop working.", confirmLabel: "Delete", danger: true });
    if (ok) await run(async () => { await api.deleteSmartAlbum(album.id); return null; }, `Deleted “${album.name}”`);
  }

  return (
    <div className="album-bar" role="region" aria-label="Smart album">
      <Bookmark size={16} aria-hidden="true" />
      {renaming !== null ? (
        <form className="album-rename" onSubmit={(e) => {
          e.preventDefault();
          const name = renaming.trim();
          if (name) void run(() => api.updateSmartAlbum(album.id, { name }), `Renamed to “${name}”`).then(() => setRenaming(null));
        }}>
          <input aria-label="Album name" autoFocus value={renaming} maxLength={120} onChange={(e) => setRenaming(e.target.value)} />
          <Button size="sm" type="submit" variant="primary">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
        </form>
      ) : (
        <strong className="album-name">{album.name}</strong>
      )}
      {changed && <Button size="sm" onClick={() => void run(() => api.updateSmartAlbum(album.id, { filters: current }), "Album updated to this search")}>Update album</Button>}
      <span className="spacer" />
      <IconButton size="sm" icon={Pencil} label="Rename album" onClick={() => setRenaming(album.name)} />
      <ShareButton targetType="smart_album" targetId={album.id} label="Share album" />
      <IconButton size="sm" icon={Trash2} label="Delete album" onClick={() => void remove()} />
      <IconButton size="sm" icon={X} label="Close album" onClick={onClose} />
    </div>
  );
}
