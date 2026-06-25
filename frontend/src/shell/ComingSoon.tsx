import { EmptyState } from "../components/ui";

export function ComingSoon({ label }: { label: string }) {
  return (
    <div className="page">
      <EmptyState emoji="🚧" title={`${label} is coming soon`} hint="This module isn't built yet — it's next on the roadmap." />
    </div>
  );
}
