import { NavLink } from "react-router-dom";
import { MODULES } from "./modules";

export function Rail({ onSignOut }: { onSignOut: () => void }) {
  return (
    <nav className="rail" aria-label="Modules">
      {MODULES.map((m) =>
        m.enabled ? (
          <NavLink
            key={m.key}
            to={m.path}
            className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}
            title={m.label}
          >
            <span className="rail-icon" aria-hidden="true">{m.icon}</span>
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
      <button className="rail-item" onClick={onSignOut} title="Sign out">
        <span className="rail-icon" aria-hidden="true">🚪</span>
        <span>Out</span>
      </button>
    </nav>
  );
}
