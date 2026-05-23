import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore, type Family, type User } from "../api/client";

interface AuthState {
  user: User | null;
  family: Family | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: Record<string, unknown>) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(({ user, family }) => {
        setUser(user);
        setFamily(family);
      })
      .catch(() => {
        tokenStore.clear();
      })
      .finally(() => setLoading(false));
  }, []);

  async function applyAuth(token: string, u: User) {
    tokenStore.set(token);
    setUser(u);
    const me = await api.me();
    setFamily(me.family);
  }

  const value: AuthState = {
    user,
    family,
    loading,
    login: async (email, password) => {
      const { token, user } = await api.login({ email, password });
      await applyAuth(token, user);
    },
    register: async (data) => {
      const { token, user } = await api.register(data);
      await applyAuth(token, user);
    },
    logout: () => {
      tokenStore.clear();
      setUser(null);
      setFamily(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
