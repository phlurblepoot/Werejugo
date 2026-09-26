import type { ReactNode } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

export type MenuEntry =
  | { label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | "separator";

/** A dropdown menu opened by `trigger` (usually an IconButton or Button). */
export function Menu({
  trigger,
  items,
  header,
  align = "end",
}: {
  trigger: ReactNode;
  items: MenuEntry[];
  header?: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="kit-menu" align={align} sideOffset={6} collisionPadding={8}>
          {header && <div className="kit-menu-header">{header}</div>}
          {items.map((item, i) =>
            item === "separator" ? (
              <Dropdown.Separator key={`sep-${i}`} className="kit-menu-sep" />
            ) : (
              <Dropdown.Item
                key={item.label}
                className={cx("kit-menu-item", item.danger && "is-danger")}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                {item.icon && <item.icon size={16} aria-hidden="true" />}
                <span>{item.label}</span>
              </Dropdown.Item>
            ),
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
