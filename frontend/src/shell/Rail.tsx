import { NavLink } from "react-router-dom";
import { MODULES } from "./modules";

export function Rail({
  onSignOut,
  onSearch = () => {},
  badges = {},
}: {
  onSignOut: () => void;
  onSearch?: () => void;
  badges?: Record<string, number>;
}) {
  return (
    <nav className="rail" aria-label="Modules">
      <button className="rail-item" onClick={onSearch} title="Search (Ctrl/Cmd-K)">
        <span className="rail-icon" aria-hidden="true">🔍</span>
        <span>Search</span>
      </button>
      {MODULES.map((m) =>
        m.enabled ? (
          <NavLink
            key={m.key}
            to={m.path}
            className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}
            title={m.label}
          >
            <span className="rail-icon" aria-hidden="true">{m.icon}</span>
            {badges[m.key] > 0 && <span className="rail-badge">{badges[m.key]}</span>}
            <span>{m.label}</span>
          </NavLink>
        ) : (
          <span key={m.key} className="rail-item disabled" title={`${m.label} — coming soon`}>
            <span className="rail-icon" aria-hidden="true">{m.icon}</span>
            <span>{m.label}</span>
          </span>
        ),
      )}
      <span className="rail-spacer" />
      <NavLink to="/settings" className={({ isActive }) => `rail-item${isActive ? " active" : ""}`} title="Settings">
        <span className="rail-icon" aria-hidden="true">⚙️</span>
        <span>Settings</span>
      </NavLink>
      <button className="rail-item" onClick={onSignOut} title="Sign out">
        <span className="rail-icon" aria-hidden="true">🚪</span>
        <span>Out</span>
      </button>
    </nav>
  );
}
