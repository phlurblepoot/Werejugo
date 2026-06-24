import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/ui";

export function FirstRunWelcome() {
  const { data } = useQuery({ queryKey: ["first-run-stats"], queryFn: () => api.getStats("") });
  if (!data) return null;
  if (data.items > 0 || data.photos > 0 || data.trips > 0) return null;
  return (
    <div className="first-run">
      <EmptyState
        emoji="👋"
        title="Welcome to Werejugo"
        hint="Your family travel hub is empty. Start by adding people, creating a trip, or dropping in photos."
      />
      <div className="first-run-actions">
        <Link className="first-run-cta" to="/people">＋ Add people</Link>
        <Link className="first-run-cta" to="/planning">＋ Create a trip</Link>
        <Link className="first-run-cta" to="/photos">＋ Add photos</Link>
      </div>
    </div>
  );
}
