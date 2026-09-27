import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LogOut, Menu as MenuIcon, Search, Settings, Shield } from "lucide-react";
import { Avatar, Badge, Modal } from "../components/kit";
import { MODULES } from "./modules";
import type { AccountInfo } from "./AccountMenu";

/** Phone navigation: four main tabs plus "More" (the other modules, search, settings, sign out). */
export function BottomNav({
  onSignOut,
  onSearch,
  badges = {},
  account,
}: {
  onSignOut: () => void;
  onSearch: () => void;
  badges?: Record<string, number>;
  account?: AccountInfo | null;
}) {
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  const extras = MODULES.filter((m) => !m.tab);
  const moreActive = extras.some((m) => pathname.startsWith(m.path)) || pathname.startsWith("/settings") || pathname.startsWith("/admin");

  return (
    <nav className="tabbar" aria-label="Main">
      {MODULES.filter((m) => m.tab).map((m) => (
        <NavLink key={m.key} to={m.path} className={({ isActive }) => `tab-item${isActive ? " active" : ""}`}>
          <span className="tab-icon">
            <m.icon size={22} aria-hidden="true" />
            {badges[m.key] > 0 && <span className="tab-badge"><Badge>{badges[m.key]}</Badge></span>}
          </span>
          <span>{m.short}</span>
        </NavLink>
      ))}
      <button type="button" className={`tab-item${moreActive ? " active" : ""}`} aria-haspopup="dialog" onClick={() => setMore(true)}>
        <span className="tab-icon"><MenuIcon size={22} aria-hidden="true" /></span>
        <span>More</span>
      </button>

      <Modal open={more} onOpenChange={setMore} title="More">
        {account && (
          <div className="more-account">
            <Avatar name={account.displayName} color={account.color} size={40} />
            <div>
              <div className="account-name">{account.displayName}</div>
              <div className="account-email">{account.email}</div>
            </div>
          </div>
        )}
        <div className="more-list">
          {extras.map((m) => (
            <NavLink key={m.key} to={m.path} className="more-row" onClick={() => setMore(false)}>
              <m.icon size={20} aria-hidden="true" /> <span>{m.label}</span>
            </NavLink>
          ))}
          <button type="button" className="more-row" onClick={() => { setMore(false); onSearch(); }}>
            <Search size={20} aria-hidden="true" /> <span>Search</span>
          </button>
          <NavLink to="/settings" className="more-row" onClick={() => setMore(false)}>
            <Settings size={20} aria-hidden="true" /> <span>Settings</span>
          </NavLink>
          {account?.isAdmin && (
            <NavLink to="/admin" className="more-row" onClick={() => setMore(false)}>
              <Shield size={20} aria-hidden="true" /> <span>Admin</span>
            </NavLink>
          )}
          <button type="button" className="more-row is-danger" onClick={() => { setMore(false); onSignOut(); }}>
            <LogOut size={20} aria-hidden="true" /> <span>Sign out</span>
          </button>
        </div>
      </Modal>
    </nav>
  );
}
