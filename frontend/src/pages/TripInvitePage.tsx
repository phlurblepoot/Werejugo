import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Users } from "lucide-react";
import { api } from "../api/client";
import { formatDateRange } from "../lib/dates";
import { useToast } from "../components/Toast";
import { Button, Card, EmptyState, PageHeader, Spinner } from "../components/kit";
import { ROLE_LABEL } from "../components/planning/TripFamilies";

const ROLE_MEANS = {
  coowner: "Your family can add places, plans and photos, and change or remove anything on the trip.",
  contributor: "Your family can add places, plans and photos, and change what it added.",
};

/** Accept an invitation for your family to join another family's trip. */
export function TripInvitePage() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const { data: inv, isLoading, isError } = useQuery({ queryKey: ["trip-invite", token], queryFn: () => api.tripInvitePreview(token), retry: false });

  async function accept() {
    setBusy(true);
    try {
      const { tripId } = await api.acceptTripInvite(token);
      await qc.invalidateQueries({ queryKey: ["trips"] });
      toast(`You joined ${inv?.tripName}`, "success");
      nav(`/planning?trip=${tripId}`, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't join the trip", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader icon={Users} title="Trip invitation" />
      <div className="page-body">
        <div className="settings-stack">
          {isLoading && <Spinner label="Checking the invitation…" />}
          {isError && (
            <EmptyState icon={Users} title="This invitation isn't valid"
              hint="It has expired, was already used, or was cancelled. Ask the other family for a new one." />
          )}
          {inv && (
            <Card title={inv.tripName} description={`${inv.hostFamilyName} invited your family${inv.invitedBy ? ` (sent by ${inv.invitedBy})` : ""}.`}>
              <div className="settings-row"><span className="settings-label">Dates</span>
                <span><CalendarDays size={14} aria-hidden="true" /> {inv.startDate ? formatDateRange(inv.startDate, inv.endDate) : "Not set yet"}</span>
              </div>
              <div className="settings-row"><span className="settings-label">Your role</span>
                <span><strong>{ROLE_LABEL[inv.role]}</strong> — {ROLE_MEANS[inv.role]}</span>
              </div>
              <p className="er-sub">Packing lists, bookings and documents stay private to each family. If your family leaves, what it added leaves with it.</p>
              {inv.alreadyOnTrip ? (
                <Button variant="primary" onClick={() => nav(`/planning?trip=${inv.tripId}`)}>Your family is already on this trip — open it</Button>
              ) : inv.canAccept ? (
                <Button variant="primary" icon={Users} loading={busy} onClick={() => void accept()}>Join this trip</Button>
              ) : (
                <p className="error-text">Only a family owner can accept a trip invitation. Ask your family owner to open this link.</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
