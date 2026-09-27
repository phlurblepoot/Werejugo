import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crown, Download, KeyRound, LogOut, Monitor, Moon, MoreHorizontal, Pencil, Settings as SettingsIcon, Sun,
  UserMinus, UserPlus, User as UserIcon, X,
} from "lucide-react";
import { api, type FamilyMemberInfo, type IssuedLink } from "../api/client";
import { useAuth } from "../lib/auth";
import { useTheme, type ThemePreference } from "../lib/theme";
import { formatRelative } from "../lib/dates";
import { useToast } from "../components/Toast";
import { OneTimeLinkModal } from "../components/OneTimeLink";
import { startDownload } from "../lib/download";
import {
  AVATAR_COLORS, Avatar, Badge, Button, Card, ErrorState, Field, IconButton, Menu, Modal, PageHeader,
  SegmentedControl, Spinner, cx, useConfirm, type MenuEntry,
} from "../components/kit";
import { errorText } from "./AuthCard";
import { ImmichCard } from "../components/settings/ImmichCard";

export function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="page">
      <PageHeader icon={SettingsIcon} title="Settings" />
      <div className="page-body">
        <div className="settings-stack">
          <AccountCard />
          <FamilyCard />
          <ImmichCard />
          <AppearanceCard />
          {user?.isAdmin && (
            <Card title="Server" description="You're the server admin.">
              <p className="er-sub">
                Families, invites for new families, everyone's accounts, the Immich connection, backups and the audit log are in{" "}
                <Link to="/admin">Admin</Link>.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Account ----

function AccountCard() {
  const { user, refresh, adoptToken, logout } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(user?.displayName ?? "");
  const [color, setColor] = useState(user?.color ?? "");
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    setName(user?.displayName ?? "");
    setColor(user?.color ?? "");
  }, [user?.displayName, user?.color]);

  if (!user) return null;
  const dirty = name.trim() !== user.displayName || color !== user.color;

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateAccount({ displayName: name.trim(), color });
      await refresh();
      toast("Profile saved", "success");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwBusy(true);
    try {
      const { token } = await api.changePassword(current, next);
      await adoptToken(token);
      setCurrent("");
      setNext("");
      toast("Password changed. Your other devices were signed out.", "success");
    } catch (err) {
      setPwError(errorText(err));
    } finally {
      setPwBusy(false);
    }
  }

  async function signOutEverywhere() {
    const ok = await confirm({
      title: "Sign out everywhere?",
      message: "Every device signed in to your account — including this one — will need to sign in again.",
      confirmLabel: "Sign out everywhere",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.signOutEverywhere();
      logout();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  return (
    <Card title="Account">
      <div className="settings-account">
        <Avatar name={name || user.displayName} color={color} size={48} />
        <div>
          <div className="settings-name">{user.displayName}</div>
          <div className="er-sub">{user.email}</div>
        </div>
        <RoleBadges role={user.role} isAdmin={user.isAdmin} />
      </div>

      <form className="settings-form" onSubmit={saveProfile}>
        <Field label="Your name" htmlFor="acct-name">
          <input id="acct-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        <fieldset className="color-swatches">
          <legend>Colour</legend>
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={cx("color-swatch", c === color && "is-selected")}
              style={{ background: c }}
              aria-label={`Colour ${c}`}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
            />
          ))}
        </fieldset>
        <Button type="submit" variant="primary" loading={saving} disabled={!dirty || !name.trim()}>Save profile</Button>
      </form>

      <div className="settings-divider" />
      <h3 className="settings-subtitle">Password</h3>
      <form className="settings-form" onSubmit={changePassword}>
        <Field label="Current password" htmlFor="acct-current">
          <input id="acct-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" htmlFor="acct-new" hint="At least 8 characters. Your other devices will be signed out.">
          <input id="acct-new" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        {pwError && <div className="error-text" role="alert">{pwError}</div>}
        <Button type="submit" icon={KeyRound} loading={pwBusy}>Change password</Button>
      </form>

      <div className="settings-divider" />
      <div className="settings-row-split">
        <div>
          <h3 className="settings-subtitle">Sign out everywhere</h3>
          <p className="er-sub">Lost a phone, or signed in on someone else's computer? This ends every session.</p>
        </div>
        <Button variant="danger" icon={LogOut} onClick={() => void signOutEverywhere()}>Sign out everywhere</Button>
      </div>
    </Card>
  );
}

function RoleBadges({ role, isAdmin }: { role: "owner" | "member"; isAdmin: boolean }) {
  return (
    <span className="role-badges">
      <Badge tone={role === "owner" ? "accent" : "neutral"}>{role === "owner" ? "Owner" : "Member"}</Badge>
      {isAdmin && <Badge tone="neutral">Server admin</Badge>}
    </span>
  );
}

// ---- Family ----

function FamilyCard() {
  const { user, family, refresh } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const isOwner = user?.role === "owner";
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["family"], queryFn: api.getFamily });
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [issued, setIssued] = useState<{ link: IssuedLink; kind: "invite" | "reset"; who?: string } | null>(null);

  const reload = () => qc.invalidateQueries({ queryKey: ["family"] });

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.renameFamily(newName.trim());
      await Promise.all([refresh(), reload()]);
      setRenaming(false);
      toast("Family renamed", "success");
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      await reload();
      toast(done, "success");
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function removeMember(m: FamilyMemberInfo) {
    const ok = await confirm({
      title: `Remove ${m.displayName}?`,
      message: "Their account is deleted and they lose access straight away. Everything they added stays with the family.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) await run(() => api.removeMember(m.id), `${m.displayName} was removed`);
  }

  async function resetLink(m: FamilyMemberInfo) {
    try {
      const link = await api.memberResetLink(m.id);
      setIssued({ link, kind: "reset", who: m.displayName });
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function downloadOurData() {
    try {
      await startDownload("family-export");
      toast("Your family's data is downloading — with lots of photos this can take a while", "success");
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function revokeInvite(id: string) {
    const ok = await confirm({ title: "Cancel this invite?", message: "The link will stop working.", confirmLabel: "Cancel invite", danger: true });
    if (ok) await run(() => api.revokeMemberInvite(id), "Invite cancelled");
  }

  function memberMenu(m: FamilyMemberInfo): MenuEntry[] {
    const entries: MenuEntry[] = [
      m.role === "owner"
        ? { label: "Make member", icon: UserIcon, onSelect: () => void run(() => api.setMemberRole(m.id, "member"), `${m.displayName} is now a member`) }
        : { label: "Make owner", icon: Crown, onSelect: () => void run(() => api.setMemberRole(m.id, "owner"), `${m.displayName} is now an owner`) },
    ];
    // Only the server admin may reset or remove another admin's account.
    if (!m.isAdmin || user?.isAdmin) {
      entries.push(
        { label: "Create password reset link", icon: KeyRound, onSelect: () => void resetLink(m) },
        "separator",
        { label: "Remove from family", icon: UserMinus, danger: true, onSelect: () => void removeMember(m) },
      );
    }
    return entries;
  }

  return (
    <Card
      title="Family"
      description={isOwner ? "Invite people with a one-time link. Owners can manage members and invites." : undefined}
      actions={isOwner && <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setInviteOpen(true)}>Invite</Button>}
    >
      <div className="settings-row">
        <span className="settings-label">Name</span>
        {renaming ? (
          <form className="inline-form" onSubmit={rename}>
            <input aria-label="Family name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} required autoFocus />
            <Button size="sm" type="submit" variant="primary" disabled={!newName.trim()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
          </form>
        ) : (
          <>
            <span className="settings-value">{data?.family.name ?? family?.name}</span>
            {isOwner && (
              <IconButton size="sm" label="Rename family" icon={Pencil} onClick={() => { setNewName(data?.family.name ?? family?.name ?? ""); setRenaming(true); }} />
            )}
          </>
        )}
      </div>

      {isLoading && <Spinner label="Loading members…" />}
      {isError && <ErrorState title="Couldn't load the family" onRetry={() => void refetch()} />}
      {data && (
        <>
          <h3 className="settings-subtitle settings-gap">Members</h3>
          <ul className="member-list">
            {data.members.map((m) => (
              <li key={m.id} className="member-row">
                <Avatar name={m.displayName} color={m.color} size={36} />
                <div className="member-main">
                  <div className="member-name">
                    <span className="member-label">{m.displayName}{m.isYou && <span className="er-sub"> (you)</span>}</span>
                    <RoleBadges role={m.role} isAdmin={m.isAdmin} />
                  </div>
                  <div className="er-sub member-meta">
                    {m.email}
                    {" · "}
                    {m.lastLoginAt ? `last seen ${formatRelative(m.lastLoginAt)}` : "hasn't signed in yet"}
                  </div>
                </div>
                {isOwner && !m.isYou && (
                  <Menu
                    trigger={<IconButton size="sm" label={`Manage ${m.displayName}`} icon={MoreHorizontal} />}
                    items={memberMenu(m)}
                  />
                )}
              </li>
            ))}
          </ul>

          {isOwner && data.invites.length > 0 && (
            <>
              <h3 className="settings-subtitle settings-gap">Pending invites</h3>
              <ul className="member-list">
                {data.invites.map((i) => (
                  <li key={i.id} className="member-row">
                    <span className="invite-icon" aria-hidden="true"><UserPlus size={18} /></span>
                    <div className="member-main">
                      <div className="member-name"><span className="member-label">{i.note || (i.role === "owner" ? "Owner invite" : "Member invite")}</span></div>
                      <div className="er-sub member-meta">
                        {i.role === "owner" ? "As an owner" : "As a member"}
                        {i.createdByName && ` · from ${i.createdByName}`}
                        {` · expires ${formatRelative(i.expiresAt)}`}
                      </div>
                    </div>
                    <IconButton size="sm" label="Cancel invite" icon={X} onClick={() => void revokeInvite(i.id)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {isOwner && (
        <>
          <div className="settings-divider" />
          <div className="settings-row-split">
            <div>
              <h3 className="settings-subtitle">Download our data</h3>
              <p className="er-sub">Everything your family has added — trips, places, people, photos, videos and documents — as one archive.</p>
            </div>
            <Button icon={Download} onClick={() => void downloadOurData()}>Download</Button>
          </div>
        </>
      )}

      <InviteMemberModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onIssued={(link) => { setInviteOpen(false); setIssued({ link, kind: "invite" }); void reload(); }}
      />
      <OneTimeLinkModal
        link={issued?.link ?? null}
        title={issued?.kind === "reset" ? `Password reset link for ${issued.who}` : "Invite link ready"}
        description={issued?.kind === "reset"
          ? "Send this link to them. It lets them choose a new password and signs out their other devices."
          : "Send this link to the person you're inviting. They'll choose their own name, email and password."}
        onClose={() => setIssued(null)}
      />
    </Card>
  );
}

function InviteMemberModal({ open, onClose, onIssued }: { open: boolean; onClose: () => void; onIssued: (link: IssuedLink) => void }) {
  const [role, setRole] = useState<"member" | "owner">("member");
  const [note, setNote] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setRole("member"); setNote(""); setDays("7"); setError(null); }
  }, [open]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onIssued(await api.createMemberInvite({ role, note: note.trim(), expiresInDays: Number(days) }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Invite to your family"
      description="Creates a link that works once. Whoever opens it joins your family."
    >
      <form onSubmit={create}>
        <div className="kit-field">
          <SegmentedControl<"member" | "owner">
            label="Join as"
            value={role}
            onChange={setRole}
            options={[
              { value: "member", label: "Member", icon: UserIcon },
              { value: "owner", label: "Owner", icon: Crown },
            ]}
          />
          <p className="hint">Owners can also invite and manage members.</p>
        </div>
        <Field label="Who is it for? (optional)" htmlFor="invite-note" hint="Only you and other owners see this.">
          <input id="invite-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Grandma" />
        </Field>
        <Field label="Link expires after" htmlFor="invite-days">
          <select id="invite-days" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </Field>
        {error && <div className="error-text" role="alert">{error}</div>}
        <div className="kit-modal-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={UserPlus} loading={busy}>Create invite link</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---- Appearance ----

function AppearanceCard() {
  const { preference, setPreference } = useTheme();
  return (
    <Card title="Appearance" description="Applies to this device.">
      <SegmentedControl<ThemePreference>
        label="Theme"
        value={preference}
        onChange={setPreference}
        options={[
          { value: "system", label: "System", icon: Monitor },
          { value: "light", label: "Light", icon: Sun },
          { value: "dark", label: "Dark", icon: Moon },
        ]}
      />
    </Card>
  );
}
