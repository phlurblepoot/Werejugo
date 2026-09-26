import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { IssuedLink } from "../api/client";
import { formatTimestamp } from "../lib/dates";
import { Button, Modal } from "./kit";

/** Full URL for a path the API hands back, e.g. "/invite/abc". */
export const absoluteLink = (path: string) => `${window.location.origin}${path}`;

/**
 * Shows a freshly issued one-time link (invite or password reset). The server
 * only stores a hash, so this is the one chance to copy it.
 */
export function OneTimeLinkModal({
  link,
  title,
  description,
  onClose,
}: {
  link: IssuedLink | null;
  title: string;
  description: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = link ? absoluteLink(link.path) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (e.g. plain http); the field stays selectable.
      document.getElementById("one-time-link")?.focus();
    }
  }

  return (
    <Modal
      open={link !== null}
      onOpenChange={(o) => { if (!o) { setCopied(false); onClose(); } }}
      title={title}
      description={description}
      footer={<Button variant="primary" onClick={() => { setCopied(false); onClose(); }}>Done</Button>}
    >
      <div className="link-copy">
        <input
          id="one-time-link"
          aria-label="Link"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button icon={copied ? Check : Copy} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>
      </div>
      {link && <p className="hint">Works once. Expires {formatTimestamp(link.expiresAt)}. You won't be able to see this link again.</p>}
    </Modal>
  );
}
