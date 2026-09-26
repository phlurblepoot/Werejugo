import { useQuery } from "@tanstack/react-query";
import { api, type ActivityEntry } from "../../api/client";
import { formatRelative } from "../../lib/dates";

const VERB: Record<string, string> = {
  "visit.added": "added a place",
  "itinerary.added": "added to the plan",
  "photo.added": "added photos",
  "comment.added": "commented on",
  "member.joined": "joined the trip",
  "member.left": "left the trip",
  "member.removed": "were removed from the trip",
  "member.role_changed": "became",
};
const ROLE: Record<string, string> = { coowner: "co-owner", contributor: "contributor" };

export function describeActivity(e: ActivityEntry): string {
  const who = e.userName ?? e.familyName ?? "Someone";
  const verb = VERB[e.kind] ?? e.kind;
  if (e.kind === "member.joined" || e.kind === "member.left" || e.kind === "member.removed") return `${e.familyName ?? who} ${verb}`;
  if (e.kind === "member.role_changed") return `${e.familyName ?? who} ${verb} ${ROLE[e.summary] ?? e.summary}`;
  const what = e.summary ? `: ${e.summary}` : "";
  return `${who}${e.familyName && e.userName ? ` (${e.familyName})` : ""} ${verb}${what}`;
}

/** What's happened on a trip lately — most useful when it's shared. */
export function TripActivity({ tripId }: { tripId: string }) {
  const { data = [], isLoading } = useQuery({ queryKey: ["trip-activity", tripId], queryFn: () => api.tripActivity(tripId) });
  if (isLoading) return null;
  if (data.length === 0) return <div className="er-sub">Nothing yet.</div>;
  return (
    <ul className="activity-list">
      {data.slice(0, 12).map((e) => (
        <li key={e.id}>
          <span>{describeActivity(e)}</span>
          <time className="er-sub" dateTime={e.at}>{formatRelative(e.at)}</time>
        </li>
      ))}
    </ul>
  );
}
