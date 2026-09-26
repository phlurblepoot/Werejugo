import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, X } from "lucide-react";
import { api, type EntitySummary } from "../../api/client";
import { useToast } from "../Toast";
import { EntityPicker } from "../shared/EntityPicker";
import { Button, IconButton } from "../kit";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** "Our Grandma is your Grandma": the same person in a family we share a trip with. */
export function PersonLinks({ personId, personName }: { personId: string; personName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["person", personId], queryFn: () => api.getPerson(personId) });
  const links = data?.links ?? [];

  const reload = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["person", personId] }),
    qc.invalidateQueries({ queryKey: ["person-links"] }),
    qc.invalidateQueries({ queryKey: ["relations", `person:${personId}`] }),
  ]);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      await reload();
      toast(done, "success");
    } catch (e) {
      toast(errText(e), "error");
    }
  }

  function propose(picked: EntitySummary) {
    if (!picked.familyName) {
      toast("Pick someone from another family — people in your own family are already the same family", "error");
      return;
    }
    void run(() => api.proposePersonLink(personId, picked.id), `Asked ${picked.familyName} to confirm`);
  }

  return (
    <div className="person-links">
      <div className="section-title"><span>Same person in another family</span></div>
      {links.length === 0 && (
        <p className="er-sub">If {personName} is also in a family you share a trip with, link them to see what they've shared.</p>
      )}
      <ul className="member-list">
        {links.map((l) => (
          <li key={l.linkId} className="member-row">
            <Link2 size={16} aria-hidden="true" />
            <div className="member-main">
              <div className="member-name"><span className="member-label">{l.displayName} · {l.familyName}</span></div>
              <div className="er-sub member-meta">
                {l.status === "accepted" ? "Linked" : l.incoming ? `${l.familyName} say this is the same person` : `Waiting for ${l.familyName} to confirm`}
              </div>
            </div>
            {l.status === "pending" && l.incoming && (
              <Button size="sm" icon={Check} onClick={() => void run(() => api.acceptPersonLink(l.linkId), "Linked")}>Confirm</Button>
            )}
            <IconButton size="sm" label={l.status === "accepted" ? `Unlink ${l.displayName}` : "Decline"} icon={X}
              onClick={() => void run(() => api.removePersonLink(l.linkId), l.status === "accepted" ? "Unlinked" : "Removed")} />
          </li>
        ))}
      </ul>
      <EntityPicker type="person" placeholder="Find them in another family…" onPick={propose} />
    </div>
  );
}

/** Link requests from other families, shown at the top of People. */
export function PersonLinkRequests() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["person-links"], queryFn: api.personLinks });
  const incoming = data?.incoming ?? [];
  if (incoming.length === 0) return null;

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["person-links"] });
      await qc.invalidateQueries({ queryKey: ["person"] });
      toast(done, "success");
    } catch (e) {
      toast(errText(e), "error");
    }
  }

  return (
    <div className="link-requests" role="region" aria-label="Link requests">
      {incoming.map((r) => (
        <div key={r.id} className="link-request">
          <Link2 size={18} aria-hidden="true" />
          <span><strong>{r.other.familyName}</strong> say their <strong>{r.other.displayName}</strong> is your <strong>{r.person.displayName}</strong>.</span>
          <Button size="sm" variant="primary" icon={Check} onClick={() => void run(() => api.acceptPersonLink(r.id), "Linked")}>Same person</Button>
          <Button size="sm" variant="ghost" onClick={() => void run(() => api.removePersonLink(r.id), "Declined")}>Not them</Button>
        </div>
      ))}
    </div>
  );
}
