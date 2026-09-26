import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, LogOut, MoreHorizontal, PenLine, UserMinus, UserPlus, Users, X } from "lucide-react";
import { api, type IssuedLink, type TripRole } from "../../api/client";
import { useAuth } from "../../lib/auth";
import { formatRelative } from "../../lib/dates";
import { useToast } from "../Toast";
import { OneTimeLinkModal } from "../OneTimeLink";
import { Avatar, Badge, Button, Field, IconButton, Menu, Modal, SegmentedControl, Spinner, useConfirm } from "../kit";

export const ROLE_LABEL: Record<TripRole, string> = { host: "Host", coowner: "Co-owner", contributor: "Contributor" };
const ROLE_HINT: Record<"coowner" | "contributor", string> = {
  coowner: "Can add to the trip and change or remove anything on it.",
  contributor: "Can add to the trip and change what they added.",
};

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** The families on a trip: the host invites and manages; guest families can leave. */
export function TripFamilies({ tripId, tripName, onLeft }: { tripId: string; tripName: string; onLeft?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const key = ["trip-members", tripId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.tripMembers(tripId) });
  const [inviting, setInviting] = useState(false);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const isOwner = user?.role === "owner";
  const isHost = data?.myRole === "host";

  const reload = () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ["trips"] })]);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      await reload();
      toast(done, "success");
    } catch (e) {
      toast(errText(e), "error");
    }
  }

  async function remove(familyId: string, name: string) {
    const ok = await confirm({
      title: `Remove ${name} from this trip?`,
      message: "What they added is hidden from the trip. If you invite them again, it comes back.",
      confirmLabel: "Remove", danger: true,
    });
    if (ok) await run(() => api.removeTripMember(tripId, familyId), `${name} removed`);
  }

  async function leave() {
    if (!user) return;
    const ok = await confirm({
      title: `Leave ${tripName}?`,
      message: "Your family's places, plans and photos leave the trip with you. If you're invited again, they come back.",
      confirmLabel: "Leave trip", danger: true,
    });
    if (!ok) return;
    try {
      await api.removeTripMember(tripId, user.familyId);
      await qc.invalidateQueries({ queryKey: ["trips"] });
      toast(`You left ${tripName}`, "success");
      onLeft?.();
    } catch (e) {
      toast(errText(e), "error");
    }
  }

  if (isLoading || !data) return <Spinner label="Loading families…" />;

  return (
    <div className="trip-families">
      <ul className="member-list">
        <li className="member-row">
          <Avatar name={data.host.familyName} size={32} />
          <div className="member-main">
            <div className="member-name">
              <span className="member-label">{data.host.familyName}{data.host.familyId === user?.familyId && <span className="er-sub"> (you)</span>}</span>
              <Badge tone="accent">Host</Badge>
            </div>
          </div>
        </li>
        {data.members.map((m) => (
          <li key={m.familyId} className="member-row">
            <Avatar name={m.familyName} size={32} />
            <div className="member-main">
              <div className="member-name">
                <span className="member-label">{m.familyName}{m.isYou && <span className="er-sub"> (you)</span>}</span>
                <Badge tone="neutral">{ROLE_LABEL[m.role]}</Badge>
              </div>
              <div className="er-sub member-meta">Joined {formatRelative(m.joinedAt)}</div>
            </div>
            {isHost && isOwner && (
              <Menu
                trigger={<IconButton size="sm" label={`Manage ${m.familyName}`} icon={MoreHorizontal} />}
                items={[
                  m.role === "coowner"
                    ? { label: "Make contributor", icon: PenLine, onSelect: () => void run(() => api.setTripMemberRole(tripId, m.familyId, "contributor"), `${m.familyName} is now a contributor`) }
                    : { label: "Make co-owner", icon: Crown, onSelect: () => void run(() => api.setTripMemberRole(tripId, m.familyId, "coowner"), `${m.familyName} is now a co-owner`) },
                  "separator",
                  { label: "Remove from trip", icon: UserMinus, danger: true, onSelect: () => void remove(m.familyId, m.familyName) },
                ]}
              />
            )}
          </li>
        ))}
      </ul>

      {isHost && data.invites.length > 0 && (
        <ul className="member-list trip-invites">
          {data.invites.map((i) => (
            <li key={i.id} className="member-row">
              <span className="invite-icon" aria-hidden="true"><UserPlus size={16} /></span>
              <div className="member-main">
                <div className="member-name"><span className="member-label">{i.note || "Family invite"}</span><Badge tone="neutral">{ROLE_LABEL[i.role]}</Badge></div>
                <div className="er-sub member-meta">Waiting · expires {formatRelative(i.expiresAt)}</div>
              </div>
              {isOwner && <IconButton size="sm" label="Cancel invite" icon={X} onClick={() => void run(() => api.revokeTripInvite(tripId, i.id), "Invite cancelled")} />}
            </li>
          ))}
        </ul>
      )}

      <div className="trip-families-actions">
        {isHost && isOwner && <Button size="sm" icon={UserPlus} onClick={() => setInviting(true)}>Invite a family</Button>}
        {isHost && !isOwner && data.members.length === 0 && <span className="er-sub">Only just your family. Your family owner can invite another family.</span>}
        {!isHost && isOwner && <Button size="sm" variant="ghost" icon={LogOut} onClick={() => void leave()}>Leave this trip</Button>}
      </div>

      <InviteFamilyToTrip tripName={tripName} open={inviting} onClose={() => setInviting(false)}
        onCreate={async (data) => {
          const link = await api.createTripInvite(tripId, data);
          setInviting(false);
          setIssued(link);
          await reload();
        }} />
      <OneTimeLinkModal
        link={issued}
        title="Trip invite ready"
        description={`Send this to an owner of the other family. When they open it they can add their family to ${tripName}.`}
        onClose={() => setIssued(null)}
      />
    </div>
  );
}

function InviteFamilyToTrip({ tripName, open, onClose, onCreate }: {
  tripName: string; open: boolean; onClose: () => void;
  onCreate: (data: { role: "coowner" | "contributor"; note?: string; expiresInDays?: number }) => Promise<void>;
}) {
  const [role, setRole] = useState<"coowner" | "contributor">("contributor");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({ role, note: note.trim(), expiresInDays: 7 });
      setNote("");
      setRole("contributor");
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={`Share ${tripName} with another family`}
      description="Both families add places, plans and photos to the trip. Packing lists, bookings and documents stay private to each family.">
      <form onSubmit={submit}>
        <div className="kit-field">
          <SegmentedControl<"coowner" | "contributor">
            label="Their role"
            value={role}
            onChange={setRole}
            options={[{ value: "contributor", label: "Contributor", icon: PenLine }, { value: "coowner", label: "Co-owner", icon: Users }]}
          />
          <p className="hint">{ROLE_HINT[role]} Only your family changes the trip's name, dates and who's on it.</p>
        </div>
        <Field label="Which family? (optional)" htmlFor="trip-invite-note" hint="Just a reminder for you.">
          <input id="trip-invite-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. The Smiths" />
        </Field>
        {error && <div className="error-text" role="alert">{error}</div>}
        <div className="kit-modal-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={UserPlus} loading={busy}>Create invite link</Button>
        </div>
      </form>
    </Modal>
  );
}
