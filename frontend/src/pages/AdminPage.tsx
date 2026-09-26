import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban, CheckCircle2, Crown, DatabaseBackup, Download, Eye, History, House, KeyRound, MoreHorizontal, Pencil,
  Search as SearchIcon, Shield, ShieldOff, Trash2, Upload, User as UserIcon, UserPlus, Users, X,
} from "lucide-react";
import { api, type AdminFamily, type AdminUser, type AuditEntry, type IssuedLink } from "../api/client";
import { useAuth } from "../lib/auth";
import { formatDate, formatRelative, formatTimestamp } from "../lib/dates";
import { useToast } from "../components/Toast";
import { OneTimeLinkModal } from "../components/OneTimeLink";
import {
  Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Menu, Modal, PageHeader,
  SegmentedControl, Spinner, useConfirm, type MenuEntry,
} from "../components/kit";
import { errorText } from "./AuthCard";

type Tab = "families" | "people" | "backup" | "audit";
const TABS: Tab[] = ["families", "people", "backup", "audit"];

/** Server administration (admins only): families, people, backups, audit log. */
export function AdminPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "families";
  const { data: overview } = useQuery({ queryKey: ["admin", "overview"], queryFn: api.adminOverview, enabled: !!user?.isAdmin });

  if (!user?.isAdmin) {
    return (
      <div className="page">
        <PageHeader icon={Shield} title="Admin" />
        <div className="page-body">
          <EmptyState icon={Shield} title="Only the server admin can open this page" />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        icon={Shield}
        title="Admin"
        subtitle={overview && `${overview.families.length} ${overview.families.length === 1 ? "family" : "families"} · ${overview.userCount} ${overview.userCount === 1 ? "person" : "people"}`}
        views={
          <SegmentedControl<Tab>
            label="Admin section"
            value={tab}
            onChange={(t) => setParams(t === "families" ? {} : { tab: t }, { replace: true })}
            options={[
              { value: "families", label: "Families", icon: House },
              { value: "people", label: "People", icon: Users },
              { value: "backup", label: "Backup", icon: DatabaseBackup },
              { value: "audit", label: "Audit", icon: History },
            ]}
          />
        }
      />
      <div className="page-body">
        <div className="settings-stack admin-stack">
          {tab === "families" && <FamiliesTab />}
          {tab === "people" && <PeopleTab />}
          {tab === "backup" && <BackupTab />}
          {tab === "audit" && <AuditTab />}
        </div>
      </div>
    </div>
  );
}

// ---- Families ----

function FamiliesTab() {
  const { user, adminView, adoptToken } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: api.adminOverview });
  const invites = useQuery({ queryKey: ["admin", "family-invites"], queryFn: api.adminFamilyInvites });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [renaming, setRenaming] = useState<AdminFamily | null>(null);
  const [deleting, setDeleting] = useState<AdminFamily | null>(null);
  const homeFamilyId = adminView?.homeFamilyId ?? user?.familyId;

  const reload = () => qc.invalidateQueries({ queryKey: ["admin"] });

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      await reload();
      toast(done, "success");
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function viewAs(f: AdminFamily) {
    try {
      const { token } = f.id === homeFamilyId ? await api.adminReturn() : await api.adminViewFamily(f.id);
      await adoptToken(token);
      nav("/map");
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function toggleDisabled(f: AdminFamily) {
    if (!f.disabled) {
      const ok = await confirm({
        title: `Disable ${f.name}?`,
        message: "Nobody in this family can sign in until you enable it again. Nothing is deleted.",
        confirmLabel: "Disable family",
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => api.adminUpdateFamily(f.id, { disabled: !f.disabled }), f.disabled ? `${f.name} enabled` : `${f.name} disabled`);
  }

  async function revoke(id: string) {
    const ok = await confirm({ title: "Cancel this invite?", message: "The link will stop working.", confirmLabel: "Cancel invite", danger: true });
    if (ok) await run(() => api.revokeFamilyInvite(id), "Invite cancelled");
  }

  function familyMenu(f: AdminFamily): MenuEntry[] {
    const mine = f.id === homeFamilyId;
    const entries: MenuEntry[] = [
      { label: mine ? "Open my family" : "View as this family", icon: Eye, onSelect: () => void viewAs(f) },
      { label: "Rename", icon: Pencil, onSelect: () => setRenaming(f) },
    ];
    if (!mine) {
      entries.push(
        f.disabled
          ? { label: "Enable", icon: CheckCircle2, onSelect: () => void toggleDisabled(f) }
          : { label: "Disable", icon: Ban, onSelect: () => void toggleDisabled(f) },
        "separator",
        { label: "Delete family…", icon: Trash2, danger: true, onSelect: () => setDeleting(f) },
      );
    }
    return entries;
  }

  return (
    <>
      <Card
        title="Families"
        description="New families join only through a one-time invite link from you."
        actions={<Button size="sm" variant="primary" icon={UserPlus} onClick={() => setInviteOpen(true)}>Invite a family</Button>}
      >
        {overview.isLoading && <Spinner label="Loading families…" />}
        {overview.isError && <ErrorState title="Couldn't load families" onRetry={() => void overview.refetch()} />}
        {overview.data && (
          <ul className="member-list">
            {overview.data.families.map((f) => (
              <li key={f.id} className="member-row">
                <Avatar name={f.name} size={36} />
                <div className="member-main">
                  <div className="member-name">
                    <span className="member-label">{f.name}{f.id === homeFamilyId && <span className="er-sub"> (your family)</span>}</span>
                    {f.disabled && <Badge tone="danger">Disabled</Badge>}
                  </div>
                  <div className="er-sub member-meta">
                    {f.memberCount} {f.memberCount === 1 ? "person" : "people"}
                    {f.owners.length > 0 && ` · owner${f.owners.length > 1 ? "s" : ""}: ${f.owners.join(", ")}`}
                    {` · since ${formatDate(f.createdAt.slice(0, 10))}`}
                  </div>
                </div>
                <Menu trigger={<IconButton size="sm" label={`Manage ${f.name}`} icon={MoreHorizontal} />} items={familyMenu(f)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {invites.data && invites.data.length > 0 && (
        <Card title="Pending family invites">
          <ul className="member-list">
            {invites.data.map((i) => (
              <li key={i.id} className="member-row">
                <span className="invite-icon" aria-hidden="true"><UserPlus size={18} /></span>
                <div className="member-main">
                  <div className="member-name"><span className="member-label">{i.note || "New family invite"}</span></div>
                  <div className="er-sub member-meta">Created {formatRelative(i.createdAt)} · expires {formatRelative(i.expiresAt)}</div>
                </div>
                <IconButton size="sm" label="Cancel invite" icon={X} onClick={() => void revoke(i.id)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <InviteFamilyModal open={inviteOpen} onClose={() => setInviteOpen(false)} onIssued={(l) => { setInviteOpen(false); setIssued(l); void reload(); }} />
      <OneTimeLinkModal
        link={issued}
        title="Family invite link ready"
        description="Send this to the person who will own the new family. They'll name the family and create their account, and they'll be told that you, as server admin, can see all data on this server."
        onClose={() => setIssued(null)}
      />
      <RenameFamilyModal family={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); void reload(); }} />
      <DeleteFamilyModal family={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); void reload(); }} />
    </>
  );
}

function InviteFamilyModal({ open, onClose, onIssued }: { open: boolean; onClose: () => void; onIssued: (link: IssuedLink) => void }) {
  const [note, setNote] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setNote(""); setDays("7"); setError(null); } }, [open]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onIssued(await api.createFamilyInvite({ note: note.trim(), expiresInDays: Number(days) }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} title="Invite a new family" description="Creates a link that works once. Whoever opens it creates a new family and becomes its owner.">
      <form onSubmit={create}>
        <Field label="Who is it for? (optional)" htmlFor="fam-invite-note" hint="Only admins see this.">
          <input id="fam-invite-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. The Garcias" />
        </Field>
        <Field label="Link expires after" htmlFor="fam-invite-days">
          <select id="fam-invite-days" value={days} onChange={(e) => setDays(e.target.value)}>
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

function RenameFamilyModal({ family, onClose, onDone }: { family: AdminFamily | null; onClose: () => void; onDone: () => void }) {
  const { refresh } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  useEffect(() => { setName(family?.name ?? ""); }, [family]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!family) return;
    try {
      await api.adminUpdateFamily(family.id, { name: name.trim() });
      await refresh();
      toast("Family renamed", "success");
      onDone();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  return (
    <Modal open={family !== null} onOpenChange={(o) => { if (!o) onClose(); }} title="Rename family" size="sm">
      <form onSubmit={save}>
        <Field label="Family name" htmlFor="admin-fam-name">
          <input id="admin-fam-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </Field>
        <div className="kit-modal-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteFamilyModal({ family, onClose, onDone }: { family: AdminFamily | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTyped(""); }, [family]);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (!family) return;
    setBusy(true);
    try {
      await api.adminDeleteFamily(family.id, typed);
      toast(`${family.name} was deleted`, "success");
      onDone();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={family !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Delete ${family?.name ?? "family"}?`}
      description="This permanently deletes the family, every account in it, and all of its trips, places, photos and documents. It can't be undone."
    >
      <form onSubmit={remove}>
        <Field label={<>Type <strong>{family?.name}</strong> to confirm</>} htmlFor="delete-fam-confirm">
          <input id="delete-fam-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        <div className="kit-modal-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" icon={Trash2} loading={busy} disabled={typed.trim() !== family?.name}>Delete family</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---- People ----

function PeopleTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [issued, setIssued] = useState<{ link: IssuedLink; who: string } | null>(null);
  const users = useQuery({ queryKey: ["admin", "users", search], queryFn: () => api.adminUsers(search) });

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  async function update(u: AdminUser, data: Parameters<typeof api.adminUpdateUser>[1], done: string) {
    try {
      await api.adminUpdateUser(u.id, data);
      await qc.invalidateQueries({ queryKey: ["admin"] });
      toast(done, "success");
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function toggleAdmin(u: AdminUser) {
    const ok = await confirm(u.isAdmin
      ? { title: `Remove ${u.displayName} as server admin?`, message: "They keep their account and family.", confirmLabel: "Remove admin", danger: true }
      : { title: `Make ${u.displayName} a server admin?`, message: "Admins can see and change everything on this server, in every family.", confirmLabel: "Make admin" });
    if (ok) await update(u, { isAdmin: !u.isAdmin }, u.isAdmin ? `${u.displayName} is no longer an admin` : `${u.displayName} is now an admin`);
  }

  async function toggleDisabled(u: AdminUser) {
    if (!u.disabled) {
      const ok = await confirm({ title: `Disable ${u.displayName}?`, message: "They're signed out everywhere and can't sign in until you enable them again.", confirmLabel: "Disable", danger: true });
      if (!ok) return;
    }
    await update(u, { disabled: !u.disabled }, u.disabled ? `${u.displayName} enabled` : `${u.displayName} disabled`);
  }

  async function resetLink(u: AdminUser) {
    try {
      setIssued({ link: await api.adminResetLink(u.id), who: u.displayName });
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  function userMenu(u: AdminUser): MenuEntry[] {
    const entries: MenuEntry[] = [
      { label: "Create password reset link", icon: KeyRound, onSelect: () => void resetLink(u) },
      u.role === "owner"
        ? { label: "Make member of their family", icon: UserIcon, onSelect: () => void update(u, { role: "member" }, `${u.displayName} is now a member`) }
        : { label: "Make owner of their family", icon: Crown, onSelect: () => void update(u, { role: "owner" }, `${u.displayName} is now an owner`) },
      u.isAdmin
        ? { label: "Remove server admin", icon: ShieldOff, onSelect: () => void toggleAdmin(u) }
        : { label: "Make server admin", icon: Shield, onSelect: () => void toggleAdmin(u) },
    ];
    if (!u.isYou) {
      entries.push("separator", u.disabled
        ? { label: "Enable account", icon: CheckCircle2, onSelect: () => void toggleDisabled(u) }
        : { label: "Disable account", icon: Ban, danger: true, onSelect: () => void toggleDisabled(u) });
    }
    return entries;
  }

  return (
    <Card title="People" description="Everyone with an account on this server.">
      <div className="admin-search">
        <SearchIcon size={16} aria-hidden="true" />
        <input type="search" aria-label="Search people" placeholder="Search by name, email or family" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {users.isLoading && <Spinner label="Loading people…" />}
      {users.isError && <ErrorState title="Couldn't load people" onRetry={() => void users.refetch()} />}
      {users.data && users.data.length === 0 && <p className="er-sub">No one matches “{search}”.</p>}
      {users.data && users.data.length > 0 && (
        <ul className="member-list">
          {users.data.map((u) => (
            <li key={u.id} className="member-row">
              <Avatar name={u.displayName} size={36} />
              <div className="member-main">
                <div className="member-name">
                  <span className="member-label">{u.displayName}{u.isYou && <span className="er-sub"> (you)</span>}</span>
                  <span className="role-badges">
                    <Badge tone={u.role === "owner" ? "accent" : "neutral"}>{u.role === "owner" ? "Owner" : "Member"}</Badge>
                    {u.isAdmin && <Badge tone="neutral">Admin</Badge>}
                    {u.disabled && <Badge tone="danger">Disabled</Badge>}
                  </span>
                </div>
                <div className="er-sub member-meta">
                  {u.email} · {u.familyName} · {u.lastLoginAt ? `last seen ${formatRelative(u.lastLoginAt)}` : "never signed in"}
                </div>
              </div>
              <Menu trigger={<IconButton size="sm" label={`Manage ${u.displayName}`} icon={MoreHorizontal} />} items={userMenu(u)} />
            </li>
          ))}
        </ul>
      )}
      <OneTimeLinkModal
        link={issued?.link ?? null}
        title={`Password reset link for ${issued?.who ?? ""}`}
        description="Send this link to them. It lets them choose a new password and signs out their other devices."
        onClose={() => setIssued(null)}
      />
    </Card>
  );
}

// ---- Backup ----

function BackupTab() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<File | null>(null);

  async function download() {
    setBusy(true);
    try {
      const blob = await api.downloadBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `werejugo-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Backup downloaded", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Backup failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!fileRef.current) return;
    setBusy(true);
    try {
      const { counts } = await api.restoreBackup(fileRef.current);
      const n = Object.values(counts).reduce((a, b) => a + b, 0);
      toast(`Restored ${n} rows — signing you out so you can sign in to the restored data`, "success");
      // Accounts were replaced too, so the current session may no longer exist.
      setTimeout(() => { logout(); window.location.assign("/"); }, 1500);
      setConfirmText("");
      setFileName("");
      fileRef.current = null;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Restore failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Backup & restore" description="The whole server — every family, account, photo, document, pin icon and map overlay — as one archive.">
      <Button variant="primary" icon={Download} disabled={busy} onClick={() => void download()}>Download backup</Button>

      <div className="settings-divider" />
      <h3 className="settings-subtitle">Restore</h3>
      <p className="er-sub">Replaces <strong>all</strong> data on this server, for every family, with the uploaded archive. This can't be undone.</p>
      <Field label="Restore archive (.tar.gz)" htmlFor="restore-file">
        <input
          id="restore-file"
          type="file"
          accept=".gz,.tgz,application/gzip"
          onChange={(e) => { fileRef.current = e.target.files?.[0] ?? null; setFileName(e.target.files?.[0]?.name ?? ""); }}
        />
      </Field>
      {fileName && (
        <div className="restore-confirm">
          <Field label={<>Type <code>restore</code> to confirm</>} htmlFor="restore-confirm">
            <input id="restore-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="restore" />
          </Field>
          <Button variant="danger" icon={Upload} disabled={busy || confirmText !== "restore"} onClick={() => void restore()}>
            Restore &amp; replace
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---- Audit log ----

const ACTIONS: Record<string, string> = {
  "server.setup": "set up the server",
  "invite.family_created_link": "created a family invite",
  "invite.family_created": "created a family from an invite",
  "invite.member_created": "created a member invite",
  "invite.member_joined": "joined from an invite",
  "invite.revoked": "cancelled an invite",
  "family.renamed": "renamed the family",
  "family.updated": "changed a family",
  "family.deleted": "deleted a family",
  "member.role_changed": "changed a member's role",
  "member.removed": "removed a member",
  "user.updated": "changed an account",
  "password.changed": "changed their password",
  "password.reset_link_created": "created a password reset link",
  "password.reset_used": "reset their password",
  "admin.view_family": "viewed a family as admin",
  "admin.return": "returned to their own family",
  "backup.downloaded": "downloaded a backup",
  "backup.restored": "restored a backup",
};

export const describeAction = (action: string) => ACTIONS[action] ?? action;

/** What the entry is about: its target, or the note on a family invite. */
function auditTarget(e: AuditEntry): string {
  if (e.target) return e.target;
  const note = (e.details as { note?: unknown }).note;
  return typeof note === "string" ? note : "";
}

function AuditTab() {
  const log = useInfiniteQuery({
    queryKey: ["admin", "audit"],
    queryFn: ({ pageParam }) => api.auditLog(pageParam),
    initialPageParam: undefined as string | undefined,
    // A full page (100) means there may be more.
    getNextPageParam: (last: AuditEntry[]) => (last.length >= 100 ? last[last.length - 1].id : undefined),
  });
  const entries = log.data?.pages.flat() ?? [];

  return (
    <Card title="Audit log" description="Sign-ups, invites, role changes, password resets, admin actions and backups — newest first.">
      {log.isLoading && <Spinner label="Loading…" />}
      {log.isError && <ErrorState title="Couldn't load the audit log" onRetry={() => void log.refetch()} />}
      {log.data && entries.length === 0 && <p className="er-sub">Nothing has happened yet.</p>}
      {entries.length > 0 && (
        <ul className="audit-list">
          {entries.map((e) => (
            <li key={e.id} className="audit-row">
              <time dateTime={e.at} className="audit-when">{formatTimestamp(e.at)}</time>
              <div>
                <strong>{e.actorName || "Someone"}</strong> {describeAction(e.action)}
                {auditTarget(e) && <> — <span className="audit-target">{auditTarget(e)}</span></>}
                {e.familyName && e.familyName !== auditTarget(e) && <span className="er-sub"> · {e.familyName}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {log.hasNextPage && (
        <Button className="audit-more" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>Load older entries</Button>
      )}
    </Card>
  );
}
