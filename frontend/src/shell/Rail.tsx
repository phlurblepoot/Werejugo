import { NavLink } from "react-router-dom";
import { Compass, Search, Settings, Shield } from "lucide-react";
import { Badge } from "../components/kit";
import { MODULES } from "./modules";
import { AccountMenu, type AccountInfo } from "./AccountMenu";

/** Desktop navigation: a slim rail of modules, search, settings and the account menu. */
export function Rail({
  onSignOut,
  onSearch = () => {},
  badges = {},
  account,
}: {
  onSignOut: () => void;
  onSearch?: () => void;
  badges?: Record<string, number>;
  account?: AccountInfo | null;
}) {
  return (
    <nav className="rail" aria-label="Main">
      <NavLink to="/map" className="rail-brand" aria-label="Werejugo home">
        <Compass size={26} aria-hidden="true" />
      </NavLink>
      <button type="button" className="rail-item" onClick={onSearch} title="Search (Ctrl/Cmd-K)">
        <Search size={21} aria-hidden="true" />
        <span>Search</span>
      </button>
      {MODULES.map((m) => (
        <NavLink key={m.key} to={m.path} className={({ isActive }) => `rail-item${isActive ? " active" : ""}`} title={m.label}>
          <m.icon size={21} aria-hidden="true" />
          {badges[m.key] > 0 && <span className="rail-badge"><Badge>{badges[m.key]}</Badge></span>}
          <span>{m.label}</span>
        </NavLink>
      ))}
      <span className="rail-spacer" />
      {account?.isAdmin && (
        <NavLink to="/admin" className={({ isActive }) => `rail-item${isActive ? " active" : ""}`} title="Admin">
          <Shield size={21} aria-hidden="true" />
          <span>Admin</span>
        </NavLink>
      )}
      <NavLink to="/settings" className={({ isActive }) => `rail-item${isActive ? " active" : ""}`} title="Settings">
        <Settings size={21} aria-hidden="true" />
        <span>Settings</span>
      </NavLink>
      <AccountMenu account={account} onSignOut={onSignOut} />
    </nav>
  );
}
