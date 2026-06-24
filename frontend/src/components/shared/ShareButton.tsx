import { useEffect, useState } from "react";
import { api, type ShareLink, type ShareTargetType } from "../../api/client";

export function ShareButton({
  targetType,
  targetId,
  label,
}: {
  targetType: ShareTargetType;
  targetId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (open) api.listShares(targetType, targetId).then(setShares).catch(() => {});
  }, [open, targetType, targetId]);

  const urlFor = (token: string) => `${window.location.origin}/s/${token}`;

  async function create() {
    const link = await api.createShare(targetType, targetId);
    setShares((prev) => [link, ...prev]);
  }
  async function revoke(id: string) {
    await api.deleteShare(id);
    setShares((prev) => prev.filter((s) => s.id !== id));
  }
  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* manual copy fallback */ }
  }

  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)}>🔗 {label}</button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Share — read-only link</h2>
            {shares.length === 0 && <div className="er-sub">No share links yet.</div>}
            {shares.map((s) => (
              <div key={s.id} className="item-row">
                <div className="sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{urlFor(s.token)}</div>
                <button className="ghost" onClick={() => copy(s.token)}>{copied === s.token ? "✓" : "Copy"}</button>
                <button className="ghost" onClick={() => revoke(s.id)}>Revoke</button>
              </div>
            ))}
            <button onClick={create} style={{ marginTop: 6 }}>+ Create link</button>
            <div className="modal-actions"><button className="primary" onClick={() => setOpen(false)}>Done</button></div>
          </div>
        </div>
      )}
    </>
  );
}
