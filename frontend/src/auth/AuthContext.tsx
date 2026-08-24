import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, clearToken, getToken } from "@/src/api/client";

export type User = {
  id: string;
  email: string;
  name: string;
  initials: string;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (token: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        try {
          const data = await api.get("/auth/me");
          setUserState(data.user);
        } catch {
          await clearToken();
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (token: string, u: User) => {
    await setToken(token);
    setUserState(u);
  };

  const logout = async () => {
    await clearToken();
    setUserState(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, setUser: setUserState }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
