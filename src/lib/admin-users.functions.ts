import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };

async function assertAdmin(context: Ctx) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Admin only");
}

export type AppUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  roles: string[];
  permissions: string[];
};

export const listAppUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AppUser[]> => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);

    const [{ data: roles }, { data: perms }, { data: profiles }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id,role"),
      supabaseAdmin.from("user_permissions").select("user_id,permission"),
      supabaseAdmin.from("profiles").select("id,full_name"),
    ]);

    return list.users.map((u) => ({
      id: u.id,
      email: u.email ?? null,
      full_name:
        (profiles ?? []).find((p: any) => p.id === u.id)?.full_name ??
        ((u.user_metadata as any)?.full_name ?? null),
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      roles: (roles ?? []).filter((r: any) => r.user_id === u.id).map((r: any) => r.role as string),
      permissions: (perms ?? [])
        .filter((p: any) => p.user_id === u.id)
        .map((p: any) => p.permission as string),
    }));
  });

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    email: string;
    password: string;
    full_name: string;
    role: string;
    permissions: string[];
  }) => {
    if (!data?.email?.includes("@")) throw new Error("Valid email required");
    if (!data?.password || data.password.length < 6) throw new Error("Password must be 6+ characters");
    return data;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error) throw new Error(error.message);
    const uid = created.user!.id;

    await supabaseAdmin.from("profiles").upsert({ id: uid, full_name: data.full_name });
    await supabaseAdmin.from("user_roles").upsert(
      { user_id: uid, role: data.role as any },
      { onConflict: "user_id,role" },
    );
    if (data.permissions.length) {
      await supabaseAdmin.from("user_permissions").upsert(
        data.permissions.map((permission) => ({ user_id: uid, permission })),
        { onConflict: "user_id,permission" },
      );
    }
    return { id: uid };
  });

export const updateUserAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; role: string; permissions: string[] }) => {
    if (!data?.user_id) throw new Error("user_id required");
    return data;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role as any });

    await supabaseAdmin.from("user_permissions").delete().eq("user_id", data.user_id);
    if (data.permissions.length) {
      await supabaseAdmin
        .from("user_permissions")
        .insert(data.permissions.map((permission) => ({ user_id: data.user_id, permission })));
    }
    return { ok: true };
  });

export const setUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; password: string }) => {
    if (!data?.password || data.password.length < 6) throw new Error("Password must be 6+ characters");
    return data;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string }) => {
    if (!data?.user_id) throw new Error("user_id required");
    return data;
  })
  .handler(async ({ context, data }) => {
    const ctx = context as Ctx;
    await assertAdmin(ctx);
    if (data.user_id === ctx.userId) throw new Error("You cannot delete your own account");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
