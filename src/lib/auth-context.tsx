import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_ONLY_KEYS, IMPLIED_BY } from "@/lib/permissions";
import { syncClinicFromServer } from "@/lib/clinic-settings";

export type AppRole = "admin" | "doctor" | "reception" | "cashier" | "pharmacy" | "store_manager";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  permissions: string[];
  loading: boolean;
  hasRole: (r: AppRole) => boolean;
  can: (permission: string) => boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => loadAccess(s.user.id), 0);
      } else {
        setRoles([]);
        setPermissions([]);
      }
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        await loadAccess(data.session.user.id);
        // Pull the shared clinic/invoice settings so printed documents match on every device.
        void syncClinicFromServer();
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadAccess(uid: string) {
    const [{ data: roleRows }, { data: permRows }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("user_permissions").select("permission").eq("user_id", uid),
    ]);
    setRoles((roleRows ?? []).map((r) => r.role as AppRole));
    setPermissions((permRows ?? []).map((p) => p.permission as string));
  }

  const isAdmin = roles.includes("admin");

  return (
    <Ctx.Provider
      value={{
        user,
        session,
        roles,
        permissions,
        loading,
        hasRole: (r) => roles.includes(r),
        can: (permission) => {
          if (isAdmin) return true;
          if (ADMIN_ONLY_KEYS.includes(permission)) return false;
          return permissions.includes(permission) || (!!IMPLIED_BY[permission] && permissions.includes(IMPLIED_BY[permission]));
        },
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
