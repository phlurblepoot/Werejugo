import { useNavigate } from "react-router-dom";
import { LogOut, Settings } from "lucide-react";
import { Avatar, Menu } from "../components/kit";

export interface AccountInfo {
  displayName: string;
  email: string;
  color?: string | null;
  /** Server admins also get the Admin page. */
  isAdmin?: boolean;
}

/** Avatar button → account header, Settings, Sign out. */
export function AccountMenu({ account, onSignOut }: { account?: AccountInfo | null; onSignOut: () => void }) {
  const nav = useNavigate();
  const name = account?.displayName ?? "Account";
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" className="rail-item rail-account" aria-label={`Account: ${name}`}>
          <Avatar name={name} color={account?.color} size={30} />
        </button>
      }
      header={
        account ? (
          <div className="account-head">
            <div className="account-name">{account.displayName}</div>
            <div className="account-email">{account.email}</div>
          </div>
        ) : undefined
      }
      items={[
        { label: "Settings", icon: Settings, onSelect: () => nav("/settings") },
        "separator",
        { label: "Sign out", icon: LogOut, onSelect: onSignOut },
      ]}
    />
  );
}
