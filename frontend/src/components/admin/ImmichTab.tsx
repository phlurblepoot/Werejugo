import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Link2, MoreHorizontal, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { api, type ImmichAdmin, type ImmichFamilyState } from "../../api/client";
import { formatRelative } from "../../lib/dates";
import { useToast } from "../Toast";
import { Avatar, Badge, Button, Card, ErrorState, Field, IconButton, Menu, Modal, Spinner, useConfirm, type MenuEntry } from "../kit";
import { errorText } from "../../pages/AuthCard";

const GUIDE = "https://github.com/phlurblepoot/Werejugo/blob/main/docs/immich-on-unraid.md";
const KEY = ["admin", "immich"];

type Family = ImmichAdmin["families"][number];

const STATE: Record<ImmichFamilyState, { label: string; tone: "accent" | "neutral" | "danger" }> = {
  created: { label: "Connected", tone: "accent" },
  linked: { label: "Linked account", tone: "accent" },
  error: { label: "Needs attention", tone: "danger" },
  none: { label: "Not connected", tone: "neutral" },
};

/** Admin → Immich: where Immich is, the admin key, and every family's Immich account. */
export function ImmichTab() {
  const q = useQuery({ queryKey: KEY, queryFn: api.immichAdmin });
  if (q.isLoading) return <Spinner label="Loading Immich settings…" />;
  if (q.isError || !q.data) return <ErrorState title="Couldn't load the Immich settings" onRetry={() => void q.refetch()} />;
  return (
    <>
      <ServerCard data={q.data} />
      {q.data.configured && <FamiliesCard data={q.data} />}
    </>
  );
}

function ServerCard({ data }: { data: ImmichAdmin }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [url, setUrl] = useState(data.url ?? "");
  const [adminKey, setAdminKey] = useState("");
  const [busy, setBusy] = useState<null | "save" | "check">(null);
  useEffect(() => { setUrl(data.url ?? ""); }, [data.url]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    try {
      const next = await api.saveImmichServer(url, adminKey || undefined);
      qc.setQueryData(KEY, next);
      setAdminKey("");
      toast(`Connected to Immich ${next.check?.version ?? ""}`.trim(), "success");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy("check");
    try {
      qc.setQueryData(KEY, await api.checkImmich());
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  }

  const c = data.check;
  return (
    <Card
      title="Immich"
      description="Every family's photos and videos live in its own account on your Immich server. Werejugo reaches Immich over your home network; Immich never needs to be on the internet."
      actions={data.configured && (
        <Button size="sm" icon={RefreshCw} loading={busy === "check"} onClick={() => void check()}>Check again</Button>
      )}
    >
      {!data.encryptionReady && (
        <div className="immich-callout immich-callout-warn" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Set ENCRYPTION_KEY first.</strong> Werejugo locks away the Immich keys it stores with it.
            Add it to the werejugo-backend container and restart. <span className="er-sub">{data.encryptionProblem}</span>
          </div>
        </div>
      )}

      {data.configured && c && (
        <p className={`immich-status ${c.ok && c.supported ? "ok" : "bad"}`} aria-live="polite">
          {c.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
          {c.ok
            ? <>Connected to Immich {c.version}{c.supported ? "" : ` — not a supported version (Werejugo supports ${data.supportedRange})`}</>
            : <>Can't use Immich: {c.error}</>}
          <span className="er-sub"> · checked {formatRelative(c.at)}</span>
        </p>
      )}

      <form className="immich-form" onSubmit={(e) => void save(e)}>
        <Field label="Immich address" htmlFor="immich-url" hint="Your Unraid server's LAN address and Immich's port, e.g. http://192.168.1.10:2283">
          <input id="immich-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:2283" autoComplete="off" required />
        </Field>
        <Field
          label="Immich admin API key"
          htmlFor="immich-key"
          hint={data.adminKeySet
            ? "A key is saved. Leave this empty to keep it."
            : <>In Immich: your avatar → Account Settings → API Keys → New API Key, with all permissions. <a href={GUIDE} target="_blank" rel="noreferrer">Setup guide</a></>}
        >
          <input
            id="immich-key"
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder={data.adminKeySet ? "•••••••• (saved)" : "Paste the key"}
            autoComplete="off"
            required={!data.adminKeySet}
          />
        </Field>
        <Button type="submit" variant="primary" icon={PlugZap} loading={busy === "save"} disabled={!data.encryptionReady}>
          Test &amp; save
        </Button>
      </form>
    </Card>
  );
}

function FamiliesCard({ data }: { data: ImmichAdmin }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linking, setLinking] = useState<Family | null>(null);

  async function run(id: string, action: () => Promise<ImmichAdmin>, done: string | ((r: ImmichAdmin) => string)) {
    setBusyId(id);
    try {
      const next = await action();
      qc.setQueryData(KEY, next);
      toast(typeof done === "string" ? done : done(next), "success");
    } catch (err) {
      toast(errorText(err), "error");
      void qc.invalidateQueries({ queryKey: KEY });
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(f: Family) {
    const ok = await confirm({
      title: `Disconnect ${f.name} from Immich?`,
      message: "Werejugo stops using this Immich account and removes its key. The account and its photos stay in Immich; you can connect or link it again later.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (ok) await run(f.id, () => api.disconnectImmichFamily(f.id), `${f.name} disconnected`);
  }

  const waiting = data.families.filter((f) => f.state === "none" || f.state === "error").length;
  const connectAll = () => run("all", api.connectAllImmich, (r) => {
    const failed = r.results?.filter((x) => !x.ok).length ?? 0;
    return failed ? `${(r.results?.length ?? 0) - failed} connected, ${failed} need attention` : "Every family is connected";
  });

  function menu(f: Family): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (f.state !== "created") entries.push({ label: "Link an existing Immich account…", icon: Link2, onSelect: () => setLinking(f) });
    if (f.state !== "none") entries.push({ label: "Disconnect…", icon: Unplug, danger: true, onSelect: () => void disconnect(f) });
    return entries;
  }

  return (
    <Card
      title="Families in Immich"
      description="Werejugo creates an Immich account for each family (new families get one automatically). You can link an account that already exists instead."
      actions={waiting > 0 && (
        <Button size="sm" variant="primary" icon={PlugZap} loading={busyId === "all"} onClick={() => void connectAll()}>
          Connect all families
        </Button>
      )}
    >
      <ul className="member-list">
        {data.families.map((f) => {
          const s = STATE[f.state];
          const items = menu(f);
          return (
            <li key={f.id} className="member-row">
              <Avatar name={f.name} size={36} />
              <div className="member-main">
                <div className="member-name">
                  <span className="member-label">{f.name}</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
                <div className="er-sub member-meta">
                  {f.immichEmail && <span className="immich-email">{f.immichEmail}</span>}
                  {f.lastError && <span className="immich-error"> {f.lastError}</span>}
                  {!f.immichEmail && !f.lastError && "No Immich account yet"}
                </div>
              </div>
              {(f.state === "none" || f.state === "error") && (
                <Button size="sm" loading={busyId === f.id} onClick={() => void run(f.id, () => api.connectImmichFamily(f.id), `${f.name} connected`)}>
                  {f.state === "error" ? "Retry" : "Connect"}
                </Button>
              )}
              {items.length > 0 && <Menu trigger={<IconButton size="sm" label={`Immich options for ${f.name}`} icon={MoreHorizontal} />} items={items} />}
            </li>
          );
        })}
      </ul>
      <LinkModal
        family={linking}
        onClose={() => setLinking(null)}
        onLinked={(next) => { qc.setQueryData(KEY, next); toast(`${linking?.name} linked`, "success"); setLinking(null); }}
      />
    </Card>
  );
}

function LinkModal({ family, onClose, onLinked }: { family: Family | null; onClose: () => void; onLinked: (d: ImmichAdmin) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setKey(""); setError(""); }, [family]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!family) return;
    setBusy(true);
    setError("");
    try {
      onLinked(await api.linkImmichFamily(family.id, key));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!family}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Link ${family?.name ?? ""} to an existing Immich account`}
      description="Sign in to Immich as that account, make an API key with all permissions (avatar → Account Settings → API Keys) and paste it here. Werejugo will use that account's photos for this family."
    >
      <form onSubmit={(e) => void submit(e)}>
        <Field label="The account's API key" htmlFor="immich-link-key" error={error || undefined}>
          <input id="immich-link-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" required />
        </Field>
        <div className="kit-modal-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={Link2} loading={busy}>Link account</Button>
        </div>
      </form>
    </Modal>
  );
}
