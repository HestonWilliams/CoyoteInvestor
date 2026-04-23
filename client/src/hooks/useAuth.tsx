import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type MeResponse } from "../lib/api";

interface AuthState {
  loading: boolean;
  user: MeResponse | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MeResponse | null>(null);

  const refresh = async () => {
    try {
      const me = await api<MeResponse>("/api/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    await api("/api/auth/gp/login", { method: "POST", body: { email, password } });
    await refresh();
  };

  const logout = async () => {
    try {
      await api("/api/auth/gp/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ loading, user, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside <AuthProvider>");
  return ctx;
}
