import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Button } from "../components/kit";

/** Shown while a server admin is looking at (and acting in) another family. */
export function AdminViewBanner() {
  const { adminView, family, adoptToken } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!adminView) return null;

  async function goHome() {
    setBusy(true);
    try {
      const { token } = await api.adminReturn();
      await adoptToken(token);
      nav("/admin");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't switch back", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-banner" role="status">
      <Eye size={18} aria-hidden="true" />
      <span>
        You're viewing <strong>{family?.name}</strong> as the server admin. Changes here happen in their family and are logged.
      </span>
      <Button size="sm" loading={busy} onClick={() => void goHome()}>Return to {adminView.homeFamilyName}</Button>
    </div>
  );
}
