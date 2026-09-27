import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/** A small group of mutually exclusive toggle buttons (e.g. Grid / Map). */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("kit-segmented", className)}>
      {options.map(({ value: v, label: l, icon: Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          className={cx("kit-segment", v === value && "is-active")}
          onClick={() => onChange(v)}
        >
          {Icon && <Icon size={16} aria-hidden="true" />}
          <span>{l}</span>
        </button>
      ))}
    </div>
  );
}
