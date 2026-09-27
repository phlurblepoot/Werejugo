import type { ReactNode } from "react";
import { MoreHorizontal, Search, type LucideIcon } from "lucide-react";
import { useShell } from "../../shell/ShellContext";
import { IconButton } from "./Button";
import { Menu, type MenuEntry } from "./Menu";

/**
 * The header every page shares: icon + title, an optional view switcher, the
 * page's actions and an overflow menu for secondary actions. On phones the
 * view switcher wraps onto its own row and a search button appears (the rail's
 * search isn't there).
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  views,
  actions,
  menu,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  views?: ReactNode;
  actions?: ReactNode;
  menu?: MenuEntry[];
}) {
  const { openSearch } = useShell();
  return (
    <header className="page-header">
      <div className="ph-title">
        {Icon && <Icon className="ph-icon" size={22} aria-hidden="true" />}
        <div className="ph-title-text">
          <h1>{title}</h1>
          {subtitle && <div className="ph-subtitle">{subtitle}</div>}
        </div>
      </div>
      {views && <div className="ph-views">{views}</div>}
      <div className="ph-actions">
        {actions}
        {menu && menu.length > 0 && (
          <Menu trigger={<IconButton label="More actions" icon={MoreHorizontal} />} items={menu} />
        )}
        {openSearch && <IconButton className="ph-search" label="Search" icon={Search} onClick={openSearch} />}
      </div>
    </header>
  );
}
