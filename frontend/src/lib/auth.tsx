import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, tokenStore, UNAUTHORIZED_EVENT, type AdminView, type Family, type User } from "../api/client";

interface AuthState {
  user: User | null;
  family: Family | null;
  /** Set while a server admin is viewing another family. */
  adminView: AdminView | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  setup: (data: { displayName: string; email: string; password: string; familyName: string }) => Promise<void>;
  acceptInvite: (token: string, data: { displayName: string; email: string; password: string; familyName?: string }) => Promise<void>;
  /** Adopt a new token (after a password change or an admin switching family) and reload the session. */
  adoptToken: (token: string) => Promise<void>;
  /** Re-read the session (e.g. after renaming yourself or the family). */
  refresh: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [adminView, setAdminView] = useState<AdminView | null>(null);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setFamily(null);
    setAdminView(null);
    // Never show one account's (or family's) cached data to the next.
    qc.clear();
  }, [qc]);

  const loadSession = useCallback(async () => {
    const s = await api.me();
    setUser(s.user);
    setFamily(s.family);
    setAdminView(s.adminView);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    loadSession()
      .catch(() => clearSession())
      .finally(() => setLoading(false));
  }, [loadSession, clearSession]);

  // Any request that comes back 401 means this session is over.
  useEffect(() => {
    const onUnauthorized = () => clearSession();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [clearSession]);

  const adoptToken = useCallback(async (token: string) => {
    tokenStore.set(token);
    qc.clear();
    await loadSession();
  }, [qc, loadSession]);

  const value: AuthState = {
    user,
    family,
    adminView,
    loading,
    login: async (email, password) => {
      const { token } = await api.login({ email, password });
      await adoptToken(token);
    },
    setup: async (data) => {
      const { token } = await api.setup(data);
      await adoptToken(token);
    },
    acceptInvite: async (inviteToken, data) => {
      const { token } = await api.acceptInvite(inviteToken, data);
      await adoptToken(token);
    },
    adoptToken,
    refresh: loadSession,
    logout: clearSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
