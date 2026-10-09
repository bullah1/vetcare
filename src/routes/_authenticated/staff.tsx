import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ShieldCheck, UserPlus, KeyRound, Trash2, Save } from "lucide-react";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { MODULES, ROLE_PRESETS, PERMISSION_KEYS } from "@/lib/permissions";
import {
  listAppUsers,
  createAppUser,
  updateUserAccess,
  setUserPassword,
  deleteAppUser,
  type AppUser,
} from "@/lib/admin-users.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/staff")({
  head: () => ({
    meta: [
      { title: "Staff & Permissions — Pet Care Vet ERP" },
      { name: "description", content: "Create staff accounts and control which modules each user can access." },
    ],
  }),
  component: StaffPage,
});

const ROLE_OPTIONS: AppRole[] = ["admin", "doctor", "reception", "cashier", "pharmacy", "store_manager"];
const GROUPS = ["Overview", "Clinic", "Shop", "Business"];

function PermissionMatrix({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {GROUPS.map((g) => (
        <div key={g} className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{g}</p>
          <div className="space-y-2">
            {MODULES.filter((m) => m.group === g).map((m) => (
              <label key={m.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={value.includes(m.key)}
                  onCheckedChange={() => toggle(m.key)}
                  disabled={disabled}
                />
                {m.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StaffPage() {
  const { hasRole, user } = useAuth();
  const isAdmin = hasRole("admin");
  const qc = useQueryClient();

  const fetchUsers = useServerFn(listAppUsers);
  const createFn = useServerFn(createAppUser);
  const updateFn = useServerFn(updateUserAccess);
  const passwordFn = useServerFn(setUserPassword);
  const deleteFn = useServerFn(deleteAppUser);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["app-users"],
    queryFn: () => fetchUsers() as Promise<AppUser[]>,
    enabled: isAdmin,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "reception" as AppRole,
    permissions: ROLE_PRESETS.reception,
  });

  const [editing, setEditing] = useState<AppUser | null>(null);
  const [editRole, setEditRole] = useState<AppRole>("reception");
  const [editPerms, setEditPerms] = useState<string[]>([]);

  const [pwFor, setPwFor] = useState<AppUser | null>(null);
  const [newPw, setNewPw] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["app-users"] });

  const create = useMutation({
    mutationFn: () => createFn({ data: { ...form, role: form.role, permissions: form.permissions } }),
    onSuccess: () => {
      toast.success("User created");
      setCreateOpen(false);
      setForm({ email: "", password: "", full_name: "", role: "reception", permissions: ROLE_PRESETS.reception });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () =>
      updateFn({ data: { user_id: editing!.id, role: editRole, permissions: editPerms } }),
    onSuccess: () => {
      toast.success("Access updated");
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePw = useMutation({
    mutationFn: () => passwordFn({ data: { user_id: pwFor!.id, password: newPw } }),
    onSuccess: () => {
      toast.success("Password updated");
      setPwFor(null);
      setNewPw("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { user_id: id } }),
    onSuccess: () => {
      toast.success("User deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (u: AppUser) => {
    setEditing(u);
    setEditRole((u.roles[0] as AppRole) ?? "reception");
    setEditPerms(u.roles.includes("admin") ? PERMISSION_KEYS : u.permissions);
  };

  const sorted = useMemo(
    () => [...users].sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")),
    [users],
  );

  if (!isAdmin) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Only admins can manage staff accounts and permissions.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Staff &amp; Permissions</h1>
          <p className="text-sm text-muted-foreground">
            Create staff accounts and choose exactly which modules each user can open.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="mr-1 h-4 w-4" /> New user
        </Button>
      </div>

      <Card className="shadow-[var(--shadow-soft)]">
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
          <CardDescription>
            Self-registration is disabled — accounts exist only when an admin creates them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading users…</p>
          ) : sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <ul className="divide-y">
              {sorted.map((u) => {
                const admin = u.roles.includes("admin");
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-[200px] flex-1">
                      <p className="text-sm font-medium">{u.full_name || u.email}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {(u.roles.length ? u.roles : ["no role"]).map((r) => (
                        <Badge key={r} variant={admin ? "default" : "secondary"}>
                          {r.replace(/_/g, " ")}
                        </Badge>
                      ))}
                      <Badge variant="outline">
                        {admin ? "all modules" : `${u.permissions.length} modules`}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                        Permissions
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setPwFor(u)}>
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={u.id === user?.id || remove.isPending}
                        onClick={() => {
                          if (confirm(`Delete ${u.email}?`)) remove.mutate(u.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Create user */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New staff account</DialogTitle>
            <DialogDescription>
              The user can sign in immediately with this email and password.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="min 6 characters"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={form.role}
                onValueChange={(v) =>
                  setForm({ ...form, role: v as AppRole, permissions: ROLE_PRESETS[v] ?? [] })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-2">
            <Label className="mb-2 block">Module permissions</Label>
            <PermissionMatrix
              value={form.role === "admin" ? PERMISSION_KEYS : form.permissions}
              onChange={(permissions) => setForm({ ...form, permissions })}
              disabled={form.role === "admin"}
            />
            {form.role === "admin" && (
              <p className="mt-2 text-xs text-muted-foreground">Admins always have full access.</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              <UserPlus className="mr-1 h-4 w-4" /> Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit permissions */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Permissions — {editing?.email}</DialogTitle>
            <DialogDescription>Only checked modules will be visible to this user.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Role</Label>
            <Select
              value={editRole}
              onValueChange={(v) => {
                setEditRole(v as AppRole);
                setEditPerms(v === "admin" ? PERMISSION_KEYS : ROLE_PRESETS[v] ?? []);
              }}
            >
              <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-2">
            <Label className="mb-2 block">Module permissions</Label>
            <PermissionMatrix
              value={editRole === "admin" ? PERMISSION_KEYS : editPerms}
              onChange={setEditPerms}
              disabled={editRole === "admin"}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="mr-1 h-4 w-4" /> Save access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!pwFor} onOpenChange={(v) => !v && setPwFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set new password</DialogTitle>
            <DialogDescription>{pwFor?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New password</Label>
            <Input value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="min 6 characters" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwFor(null)}>Cancel</Button>
            <Button onClick={() => changePw.mutate()} disabled={changePw.isPending}>
              Update password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
