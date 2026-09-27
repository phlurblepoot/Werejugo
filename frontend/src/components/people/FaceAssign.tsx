import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Search, Unlink, UserPlus } from "lucide-react";
import { api, type EntitySummary, type Face } from "../../api/client";
import { useToast } from "../Toast";
import { Button, Modal } from "../kit";
import { EntityThumb } from "../shared/EntityThumb";
import { ByFamily } from "../shared/ByFamily";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const photos = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

/** Someone a face can be: one of ours, or another family's person we share a trip with. */
interface Candidate { id: string; name: string; thumbUrl: string | null; familyName: string | null }

/** Refresh everything a face decision changes: the faces, the badge, people and their photos. */
export function invalidateFaces(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["faces"] }),
    qc.invalidateQueries({ queryKey: ["faces-count"] }),
    qc.invalidateQueries({ queryKey: ["people"] }),
    qc.invalidateQueries({ queryKey: ["person-faces"] }),
    qc.invalidateQueries({ queryKey: ["media"] }),
    qc.invalidateQueries({ queryKey: ["relations"] }),
  ]);
}

/**
 * "Who is this?" for one face: someone already in Werejugo (ours first, then
 * other families' we can see), a new person, or nobody we keep.
 */
export function FaceAssign({ face, onClose }: { face: Face; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState(face.person ? "" : face.name);
  const [busy, setBusy] = useState(false);
  const { data: people = [] } = useQuery({ queryKey: ["people"], queryFn: api.listPeople });

  // Other families' people only come from a search (there's no list of them).
  const [theirs, setTheirs] = useState<EntitySummary[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setTheirs([]); return; }
    let live = true;
    const t = setTimeout(() => {
      api.searchEntities("person", term).then((r) => live && setTheirs(r.filter((e) => e.familyName)), () => live && setTheirs([]));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const candidates: Candidate[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const mine = people
      .filter((p) => !term || p.displayName.toLowerCase().includes(term))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((p) => ({ id: p.id, name: p.displayName, thumbUrl: p.avatarUrl, familyName: null }));
    const other = theirs.map((e) => ({ id: e.id, name: e.label.replace(/ \([^)]*\)$/, ""), thumbUrl: e.thumbUrl, familyName: e.familyName ?? null }));
    return [...mine, ...other].filter((c) => c.id !== face.person?.id);
  }, [people, theirs, q, face.person?.id]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      const done = await action();
      await invalidateFaces(qc);
      toast(done, "success");
      onClose();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const choose = (c: Candidate) => run(async () => {
    const r = await api.updateFace(face.id, { personId: c.id });
    return `${c.name}: tagged in ${photos(r.tagged)}`;
  });
  const newName = q.trim() || face.name;
  const create = () => run(async () => {
    const r = await api.personFromFace(face.id, newName);
    return `Added ${newName}, tagged in ${photos(r.tagged)}`;
  });
  const ignore = () => run(async () => {
    await api.updateFace(face.id, { ignored: true });
    return "We won't ask about this face again";
  });
  const unmatch = () => run(async () => {
    const r = await api.updateFace(face.id, { personId: null });
    return `Unmatched: ${photos(r.untagged)} untagged`;
  });

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Who is this?" size="md">
      <div className="face-assign">
        <div className="face-assign-head">
          <img className="face-thumb face-thumb-lg" src={face.thumbUrl} alt="" />
          <div>
            {face.name && <div className="face-name">Named “{face.name}” in Immich</div>}
            <div className="er-sub">In {photos(face.photoCount ?? 0)}</div>
            {face.person && (
              <div className="face-now">
                Matched to <strong>{face.person.displayName}</strong> <ByFamily name={face.person.familyName} prefix="· " />
              </div>
            )}
          </div>
        </div>

        <label className="face-search">
          <Search size={16} aria-hidden="true" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
          />
        </label>

        <ul className="face-candidates" aria-label="People">
          {candidates.map((c) => (
            <li key={c.id}>
              <button type="button" className="entity-row" disabled={busy} onClick={() => choose(c)}>
                <EntityThumb thumbUrl={c.thumbUrl} label={c.name} size={32} />
                <span className="er-main">
                  <span className="er-title">{c.name}</span> <ByFamily name={c.familyName} />
                </span>
              </button>
            </li>
          ))}
          {candidates.length === 0 && <li className="er-sub face-none">No one called “{q.trim()}” yet.</li>}
        </ul>

        <div className="face-actions">
          <Button icon={UserPlus} disabled={busy || !newName} onClick={create}>
            {newName ? `New person “${newName}”` : "New person"}
          </Button>
          {face.person ? (
            <Button variant="ghost" icon={Unlink} disabled={busy} onClick={unmatch}>Unmatch</Button>
          ) : !face.ignored ? (
            <Button variant="ghost" icon={EyeOff} disabled={busy} onClick={ignore}>Not someone we keep</Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
