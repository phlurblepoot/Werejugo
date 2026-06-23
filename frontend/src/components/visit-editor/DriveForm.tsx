import type { Waypoint } from "../../api/client";
import { StopBuilder } from "../StopBuilder";

export function DriveForm({ stops, onChange }: { stops: Waypoint[]; onChange: (stops: Waypoint[]) => void }) {
  return <StopBuilder stops={stops} onChange={onChange} source="places" label="Stops along the drive (in order)" />;
}
