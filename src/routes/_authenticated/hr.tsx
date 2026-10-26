// HR & Salary — staff list, duty time, weekly off, daily attendance and a simple monthly salary sheet.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IdCard, Plus, Pencil, ChevronLeft, ChevronRight, Phone, Clock, CalendarOff, UserCheck, FileDown, Printer, Trash2, Banknote, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayDhaka } from "@/lib/sales-ledger";
import { exportToExcel } from "@/lib/export-excel";
import { cn } from "@/lib/utils";
import {
  STATUS_META, STATUS_ORDER, WEEKDAYS, WEEKDAYS_LONG, fmtTime, isLate, monthDays, monthSalary, weekday,
  type AttendanceRow, type AttendanceStatus, type Employee, type SalaryItem, type SalarySummary,
} from "@/lib/hr";

export const Route = createFileRoute("/_authenticated/hr")({
  head: () => ({ meta: [{ title: "HR & Salary — Pet Care Vet ERP" }] }),
  component: HRPage,
});

const db = supabase as any;
const money = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const num = (n: number) => Number(Number(n || 0).toFixed(2)).toLocaleString("en-BD");
const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
const shiftDate = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dateLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const nowTimeDhaka = () => `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Dhaka" }).format(new Date())}:00`;
const dutyText = (e: Pick<Employee, "duty_start" | "duty_end">) =>
  e.duty_start || e.duty_end ? `${fmtTime(e.duty_start) || "?"} – ${fmtTime(e.duty_end) || "?"}` : "No duty time set";
const offText = (e: Pick<Employee, "weekly_off">) =>
  (e.weekly_off ?? []).length ? [...e.weekly_off].sort().map((d) => WEEKDAYS[d]).join(", ") : "No weekly off";

/* ------------------------------------------------------------------ data */

function useEmployees() {
  return useQuery({
    queryKey: ["hr", "employees"],
    queryFn: async () => {
      const { data, error } = await db.from("hr_employees").select("*").order("full_name");
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
    retry: false,
  });
}

function useMonthData(month: string) {
  const days = monthDays(month);
  return useQuery({
    queryKey: ["hr", "month", month],
    queryFn: async () => {
      const [att, items, pays] = await Promise.all([
        db.from("hr_attendance").select("id,employee_id,work_date,status,check_in,note").gte("work_date", days[0]).lte("work_date", days[days.length - 1]),
        db.from("hr_salary_items").select("*").eq("month", `${month}-01`).order("created_at"),
        db.from("hr_salary_payments").select("*").eq("month", `${month}-01`),
      ]);
      for (const r of [att, items, pays]) if (r.error) throw r.error;
      return {
        attendance: (att.data ?? []) as AttendanceRow[],
        items: (items.data ?? []) as SalaryItem[],
        payments: (pays.data ?? []) as { id: string; employee_id: string; amount: number; paid_on: string }[],
      };
    },
  });
}

function useSetAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, date, status, checkIn }: { employeeId: string; date: string; status: AttendanceStatus | null; checkIn?: string | null }) => {
      if (!status) {
        const { error } = await db.from("hr_attendance").delete().eq("employee_id", employeeId).eq("work_date", date);
        if (error) throw error;
        return;
      }
      const { error } = await db.from("hr_attendance").upsert(
        { employee_id: employeeId, work_date: date, status, check_in: status === "present" || status === "half_day" ? checkIn ?? null : null },
        { onConflict: "employee_id,work_date" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr"] }),
    onError: (e: any) => toast.error(e?.message ?? "Could not save attendance"),
  });
}

/* ------------------------------------------------------------------ page */

function HRPage() {
  const today = todayDhaka();
  const [tab, setTab] = useState("attendance");
  const [editing, setEditing] = useState<Employee | null | "new">(null);
  const [profile, setProfile] = useState<Employee | null>(null);
  const { data: employees = [], error, isLoading } = useEmployees();
  const setupMissing = !!error && /hr_employees|does not exist|schema cache|PGRST205/i.test(`${(error as any)?.message} ${(error as any)?.code}`);

  return (
    <div className="space-y-4">
      <PageHeader
        title="HR & Salary"
        description="Staff, duty time, attendance and monthly salary"
        icon={IdCard}
        actions={!setupMissing && <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add staff</Button>}
      />

      {setupMissing ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          Run the HR SQL update in Supabase first, then reload this page.
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{(error as any).message}</div>
      ) : isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : employees.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No staff added yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add your staff with their salary, duty time and weekly off day.</p>
          <Button className="mt-4" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add staff</Button>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto">
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="salary">Salary</TabsTrigger>
          </TabsList>
          <TabsContent value="attendance"><AttendanceTab employees={employees} today={today} onOpen={setProfile} /></TabsContent>
          <TabsContent value="staff"><StaffTab employees={employees} today={today} onOpen={setProfile} onEdit={setEditing} /></TabsContent>
          <TabsContent value="salary"><SalaryTab employees={employees} today={today} onOpen={setProfile} /></TabsContent>
        </Tabs>
      )}

      {editing && <EmployeeDialog employee={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {profile && (
        <ProfileDialog
          employee={employees.find((e) => e.id === profile.id) ?? profile}
          today={today}
          onClose={() => setProfile(null)}
          onEdit={(e) => { setProfile(null); setEditing(e); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ attendance */

function AttendanceTab({ employees, today, onOpen }: { employees: Employee[]; today: string; onOpen: (e: Employee) => void }) {
  const [date, setDate] = useState(today);
  const month = date.slice(0, 7);
  const { data } = useMonthData(month);
  const setAtt = useSetAttendance();
  const active = employees.filter((e) => e.is_active && e.join_date <= date);
  const byEmp = new Map((data?.attendance ?? []).filter((a) => a.work_date === date).map((a) => [a.employee_id, a]));
  const wd = weekday(date);
  const counts = STATUS_ORDER.map((s) => [s, active.filter((e) => byEmp.get(e.id)?.status === s).length] as const);
  const unmarked = active.filter((e) => !byEmp.get(e.id) && !(e.weekly_off ?? []).includes(wd));

  const mark = (e: Employee, s: AttendanceStatus) => {
    const cur = byEmp.get(e.id);
    if (cur?.status === s) { setAtt.mutate({ employeeId: e.id, date, status: null }); return; } // click again = clear
    const checkIn = (s === "present" || s === "half_day") ? (cur?.check_in ?? (date === today ? nowTimeDhaka() : null)) : null;
    setAtt.mutate({ employeeId: e.id, date, status: s, checkIn });
  };
  const markAllPresent = async () => {
    const t = date === today ? nowTimeDhaka() : null;
    for (const e of unmarked) await setAtt.mutateAsync({ employeeId: e.id, date, status: "present", checkIn: t });
    toast.success(`${unmarked.length} marked present`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" className="h-9 w-40" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
          <Button variant="outline" size="icon" className="h-9 w-9" disabled={date >= today} onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day"><ChevronRight className="h-4 w-4" /></Button>
          {date !== today && <Button variant="ghost" size="sm" onClick={() => setDate(today)}>Today</Button>}
        </div>
        <span className="text-sm font-medium">{dateLabel(date)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
          {counts.filter(([, n]) => n > 0).map(([s, n]) => (
            <span key={s} className="rounded-full bg-muted px-2 py-0.5"><b>{n}</b> {STATUS_META[s].label}</span>
          ))}
          {unmarked.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"><b>{unmarked.length}</b> not marked</span>}
          {unmarked.length > 0 && (
            <Button size="sm" className="h-7" onClick={markAllPresent} disabled={setAtt.isPending}>
              <UserCheck className="h-3.5 w-3.5" /> Mark all present
            </Button>
          )}
        </div>
      </div>

      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {active.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No active staff on this date.</p>}
        {active.map((e) => {
          const a = byEmp.get(e.id);
          const isOff = (e.weekly_off ?? []).includes(wd);
          const late = a && isLate(a.check_in, e.duty_start);
          return (
            <div key={e.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4">
              <button type="button" onClick={() => onOpen(e)} className="min-w-0 text-left">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium hover:underline">{e.full_name}</span>
                  {isOff && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Weekly off</span>}
                  {late && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">Late</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[e.designation, dutyText(e), a?.check_in && `In ${fmtTime(a.check_in)}`].filter(Boolean).join("   ")}
                </span>
              </button>
              <StatusButtons value={a?.status ?? null} onPick={(s) => mark(e, s)} disabled={setAtt.isPending} />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">A working day left unmarked counts as absent (one day's pay cut) once the day is over. Tap a status to mark it, tap it again to clear. Present on today records the check-in time; checking in more than 10 minutes after duty start shows as Late (no salary cut).</p>
    </div>
  );
}

function StatusButtons({ value, onPick, disabled, compact }: { value: AttendanceStatus | null; onPick: (s: AttendanceStatus) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <div className={cn("grid grid-cols-5 gap-1", !compact && "sm:flex")} role="group" aria-label="Attendance">
      {STATUS_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          aria-pressed={value === s}
          onClick={() => onPick(s)}
          title={STATUS_META[s].label}
          className={cn(
            "h-8 rounded-md border px-2 text-xs font-medium transition-colors disabled:opacity-60",
            value === s ? cn(STATUS_META[s].tone, "border-transparent") : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {compact ? STATUS_META[s].short : <><span className="sm:hidden">{STATUS_META[s].short}</span><span className="hidden sm:inline">{STATUS_META[s].label}</span></>}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- staff */

function StaffTab({ employees, today, onOpen, onEdit }: { employees: Employee[]; today: string; onOpen: (e: Employee) => void; onEdit: (e: Employee) => void }) {
  const [showInactive, setShowInactive] = useState(false);
  const month = today.slice(0, 7);
  const { data } = useMonthData(month);
  const list = employees.filter((e) => showInactive || e.is_active);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={showInactive} onCheckedChange={setShowInactive} /> Show staff who left
      </label>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((e) => {
          const s = monthSalary(e, month, (data?.attendance ?? []).filter((a) => a.employee_id === e.id), [], today);
          return (
            <div key={e.id} className={cn("rounded-xl border bg-card p-4", !e.is_active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="min-w-0 text-left" onClick={() => onOpen(e)}>
                  <span className="block truncate font-semibold hover:underline">{e.full_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{e.designation || "Staff"}{!e.is_active && " · left"}</span>
                </button>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => onEdit(e)} aria-label={`Edit ${e.full_name}`}><Pencil className="h-4 w-4" /></Button>
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {dutyText(e)}</div>
                <div className="flex items-center gap-2 text-muted-foreground"><CalendarOff className="h-3.5 w-3.5" /> Off: {offText(e)}</div>
                {e.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" /> {e.phone}</div>}
                <div className="flex items-center gap-2 text-muted-foreground"><Banknote className="h-3.5 w-3.5" /> {money(e.monthly_salary)} / month</div>
              </dl>
              <div className="mt-3 flex gap-3 border-t pt-2 text-xs">
                <span><b className="text-emerald-600">{s.present + s.halfDays}</b> present</span>
                <span><b className="text-amber-600">{s.leave + s.paidLeave}</b> leave</span>
                <span><b className="text-red-600">{s.absent}</b> absent</span>
                <span className="ml-auto text-muted-foreground">this month</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmployeeDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    full_name: employee?.full_name ?? "",
    phone: employee?.phone ?? "",
    designation: employee?.designation ?? "",
    monthly_salary: employee ? String(employee.monthly_salary) : "",
    duty_start: employee?.duty_start?.slice(0, 5) ?? "09:00",
    duty_end: employee?.duty_end?.slice(0, 5) ?? "21:00",
    weekly_off: employee?.weekly_off ?? [5],
    join_date: employee?.join_date ?? todayDhaka(),
    attendance_from: employee?.attendance_from ?? todayDhaka(),
    is_active: employee?.is_active ?? true,
    notes: employee?.notes ?? "",
  });
  const save = useMutation({
    mutationFn: async () => {
      const name = f.full_name.trim();
      if (!name) throw new Error("Name is required");
      const salary = f.monthly_salary.trim() === "" ? 0 : Number(f.monthly_salary);
      if (!(salary >= 0)) throw new Error("Salary must be 0 or more");
      const payload = {
        full_name: name, phone: f.phone.trim() || null, designation: f.designation.trim() || null,
        monthly_salary: salary, duty_start: f.duty_start || null, duty_end: f.duty_end || null,
        weekly_off: f.weekly_off, join_date: f.join_date || todayDhaka(), attendance_from: f.attendance_from || todayDhaka(), is_active: f.is_active, notes: f.notes.trim() || null,
      };
      const { error } = employee
        ? await db.from("hr_employees").update(payload).eq("id", employee.id)
        : await db.from("hr_employees").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(employee ? "Staff updated" : "Staff added"); qc.invalidateQueries({ queryKey: ["hr"] }); onClose(); },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("hr_employees").delete().eq("id", employee!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Staff deleted"); qc.invalidateQueries({ queryKey: ["hr"] }); onClose(); },
    onError: (e: any) => toast.error(e?.message ?? "Could not delete"),
  });
  const toggleOff = (d: number) => setF((x) => ({ ...x, weekly_off: x.weekly_off.includes(d) ? x.weekly_off.filter((v) => v !== d) : [...x.weekly_off, d].sort() }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{employee ? "Edit staff" : "Add staff"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="hr-f-name">Name *</Label><Input id="hr-f-name" autoFocus value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="hr-f-designation">Designation</Label><Input id="hr-f-designation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} placeholder="Doctor, cashier, helper…" /></div>
          <div className="space-y-1.5"><Label htmlFor="hr-f-phone">Phone</Label><Input id="hr-f-phone" value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="01XXXXXXXXX" /></div>
          <div className="space-y-1.5"><Label htmlFor="hr-f-monthly-salary">Monthly salary ৳</Label><Input id="hr-f-monthly-salary" value={f.monthly_salary} inputMode="decimal" onChange={(e) => setF({ ...f, monthly_salary: e.target.value })} placeholder="0" /></div>
          <div className="space-y-1.5"><Label htmlFor="hr-f-joining-date">Joining date</Label><Input id="hr-f-joining-date" type="date" value={f.join_date} onChange={(e) => setF({ ...f, join_date: e.target.value })} /></div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="hr-f-att-from">Attendance counted from</Label>
            <Input id="hr-f-att-from" type="date" value={f.attendance_from} onChange={(e) => setF({ ...f, attendance_from: e.target.value })} />
            <p className="text-[11px] text-muted-foreground">From this date, a working day left unmarked counts as absent (one day&apos;s pay cut). Earlier unmarked days are not cut.</p>
          </div>
          <div className="space-y-1.5"><Label htmlFor="hr-f-duty-starts">Duty starts</Label><Input id="hr-f-duty-starts" type="time" value={f.duty_start} onChange={(e) => setF({ ...f, duty_start: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="hr-f-duty-ends">Duty ends</Label><Input id="hr-f-duty-ends" type="time" value={f.duty_end} onChange={(e) => setF({ ...f, duty_end: e.target.value })} /></div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label id="hr-f-off">Weekly off day</Label>
            <div className="grid grid-cols-7 gap-1" role="group" aria-labelledby="hr-f-off">
              {WEEKDAYS.map((d, i) => (
                <button key={d} type="button" aria-pressed={f.weekly_off.includes(i)} onClick={() => toggleOff(i)}
                  className={cn("h-9 rounded-md border text-xs font-medium", f.weekly_off.includes(i) ? "border-transparent bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted")}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="hr-f-notes">Notes</Label><Textarea id="hr-f-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          {employee && (
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm sm:col-span-2">
              <span>Still working here<span className="block text-xs text-muted-foreground">Turn off when the person leaves — their history stays.</span></span>
              <Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
            </label>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {employee ? (
            <Button variant="ghost" className="text-destructive" disabled={remove.isPending}
              onClick={() => confirm(`Delete ${employee.full_name} and all their attendance and salary records? To keep the history, turn off "Still working here" instead.`) && remove.mutate()}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !f.full_name.trim()}>{save.isPending ? "Saving…" : "Save"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------------- profile */

function ProfileDialog({ employee: e, today, onClose, onEdit }: { employee: Employee; today: string; onClose: () => void; onEdit: (e: Employee) => void }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const { data } = useMonthData(month);
  const setAtt = useSetAttendance();
  const att = (data?.attendance ?? []).filter((a) => a.employee_id === e.id);
  const items = (data?.items ?? []).filter((i) => i.employee_id === e.id);
  const byDate = new Map(att.map((a) => [a.work_date, a]));
  const s = monthSalary(e, month, att, items, today);
  const days = monthDays(month);
  const lead = weekday(days[0]);
  const leaves = att.filter((a) => a.status === "leave" || a.status === "paid_leave" || a.status === "absent").sort((a, b) => a.work_date.localeCompare(b.work_date));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            {e.full_name}
            {!e.is_active && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">Left</span>}
          </DialogTitle>
          <DialogDescription>{e.designation || "Staff"}{e.phone ? `   ${e.phone}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <Fact label="Duty time" value={dutyText(e)} />
          <Fact label="Weekly off" value={(e.weekly_off ?? []).length ? [...e.weekly_off].sort().map((d) => WEEKDAYS_LONG[d]).join(", ") : "None"} />
          <Fact label="Salary" value={`${money(e.monthly_salary)} / month`} />
          <Fact label="Joined" value={new Date(`${e.join_date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="w-36 text-center text-sm font-medium">{monthLabel(month)}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onEdit(e)}><Pencil className="h-4 w-4" /> Edit</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
              {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
              {days.map((d) => {
                const a = byDate.get(d);
                const off = (e.weekly_off ?? []).includes(weekday(d));
                const future = d > today || d < e.join_date;
                const late = a && isLate(a.check_in, e.duty_start);
                return (
                  <Popover key={d}>
                    <PopoverTrigger asChild disabled={future}>
                      <button type="button" disabled={future} title={a ? STATUS_META[a.status].label : off ? "Weekly off" : d < today && d >= (e.attendance_from ?? "") ? "Not marked — counted as absent" : "Not marked"}
                        className={cn("relative flex aspect-square flex-col items-center justify-center rounded-md border text-xs disabled:opacity-40",
                          a ? cn(STATUS_META[a.status].tone, "border-transparent") : off ? "bg-muted text-muted-foreground" : "bg-background hover:bg-muted")}>
                        <span className="font-semibold tabular-nums">{Number(d.slice(8))}</span>
                        <span className="text-[9px] leading-none opacity-90">{a ? STATUS_META[a.status].short : off ? "Off" : ""}</span>
                        {late && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-300 ring-1 ring-white" title="Late" />}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 space-y-2 p-3">
                      <p className="text-sm font-medium">{dateLabel(d)}{off ? " (weekly off)" : ""}</p>
                      <StatusButtons compact value={a?.status ?? null} disabled={setAtt.isPending}
                        onPick={(st) => setAtt.mutate({ employeeId: e.id, date: d, status: a?.status === st ? null : st, checkIn: a?.check_in ?? null })} />
                      <p className="text-[11px] text-muted-foreground">P present · ½ half day · PL paid leave · L leave · A absent. Tap again to clear.</p>
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Leave and absence this month</p>
              {leaves.length === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
                <ul className="flex flex-wrap gap-1.5">
                  {leaves.map((a) => (
                    <li key={a.work_date} className={cn("rounded-md px-2 py-0.5 text-xs", STATUS_META[a.status].tone)}>
                      {new Date(`${a.work_date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} · {STATUS_META[a.status].label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <SalaryBreakdown s={s} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}

function SalaryBreakdown({ s }: { s: SalarySummary }) {
  const row = (label: string, value: string, tone?: string) => (
    <div className="flex justify-between gap-2"><span className="text-muted-foreground">{label}</span><span className={cn("tabular-nums", tone)}>{value}</span></div>
  );
  return (
    <div className="space-y-1 rounded-xl border p-3 text-sm">
      <p className="mb-1 font-medium">Salary this month</p>
      {row("Monthly salary", money(s.salary))}
      {row("Working days", `${s.workingDays} (৳${num(s.perDay)}/day)`)}
      {row("Present", `${s.present}${s.halfDays ? ` + ${s.halfDays} half` : ""}`)}
      {s.paidLeave > 0 && row("Paid leave", String(s.paidLeave))}
      {(s.leave > 0 || s.absent > 0) && row("Leave / absent", `${s.leave} / ${s.absent}`)}
      {s.notMarked > 0 && row("Not marked (absent)", String(s.notMarked), "text-destructive")}
      {s.late > 0 && row("Late (no cut)", String(s.late))}
      {s.notJoinedDays > 0 && row("Before joining", `${s.notJoinedDays} days`)}
      {s.deduction > 0 && row(`Cut for ${num(s.deductDays)} day${s.deductDays === 1 ? "" : "s"}`, `− ${money(s.deduction)}`, "text-destructive")}
      {s.offDayExtra > 0 && row(`Worked ${num(s.offDayWorked)} off day`, `+ ${money(s.offDayExtra)}`, "text-emerald-600")}
      {s.bonus > 0 && row("Bonus", `+ ${money(s.bonus)}`, "text-emerald-600")}
      {s.manualDeduction > 0 && row("Other deduction", `− ${money(s.manualDeduction)}`, "text-destructive")}
      {s.advance > 0 && row("Advance taken", `− ${money(s.advance)}`, "text-destructive")}
      <div className="flex justify-between gap-2 border-t pt-1.5 font-semibold"><span>Net salary</span><span className="tabular-nums">{money(s.net)}</span></div>
      {s.notMarked > 0 && <p className="pt-1 text-[11px] text-amber-700 dark:text-amber-300">{s.notMarked} past working day{s.notMarked === 1 ? "" : "s"} not marked — counted as absent. Mark them if the person came.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- salary */

function SalaryTab({ employees, today, onOpen }: { employees: Employee[]; today: string; onOpen: (e: Employee) => void }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [detail, setDetail] = useState<Employee | null>(null);
  const { data } = useMonthData(month);
  const lastDay = monthDays(month).slice(-1)[0];
  const rows = useMemo(() => employees
    .filter((e) => e.join_date <= lastDay && (e.is_active || (data?.attendance ?? []).some((a) => a.employee_id === e.id)))
    .map((e) => ({
      e,
      s: monthSalary(e, month, (data?.attendance ?? []).filter((a) => a.employee_id === e.id), (data?.items ?? []).filter((i) => i.employee_id === e.id), today),
      paid: (data?.payments ?? []).find((p) => p.employee_id === e.id) ?? null,
    })), [employees, data, month, today, lastDay]);
  const total = rows.reduce((t, r) => t + r.s.net, 0);
  const paidTotal = rows.reduce((t, r) => t + (r.paid ? Number(r.paid.amount) : 0), 0);

  const exportRows = () => rows.map(({ e, s, paid }) => ({
    Name: e.full_name, Designation: e.designation ?? "", "Monthly salary": s.salary, "Working days": s.workingDays,
    Present: s.present, "Half day": s.halfDays, "Paid leave": s.paidLeave, Leave: s.leave, Absent: s.absent, Late: s.late,
    "Off days worked": s.offDayWorked, "Cut": s.deduction, "Off-day extra": s.offDayExtra, Bonus: s.bonus,
    "Other deduction": s.manualDeduction, Advance: s.advance, "Net salary": s.net, Paid: paid ? Number(paid.amount) : "",
  }));
  const print = () => {
    const w = window.open("", "_blank", "width=1100,height=800");
    if (!w) return;
    const r = exportRows();
    const head = Object.keys(r[0] ?? {});
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Salary ${monthLabel(month)}</title>
      <style>body{font:12px system-ui,sans-serif;margin:24px}h1{font-size:18px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:12px}
      th,td{border:1px solid #ddd;padding:4px 6px;text-align:right}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}th{background:#f5f5f5}
      tfoot td{font-weight:700}</style></head><body><h1>Salary sheet — ${monthLabel(month)}</h1>
      <table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
      ${r.map((x) => `<tr>${head.map((h) => `<td>${(x as any)[h]}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="${head.length - 2}">Total</td><td>${num(total)}</td><td>${num(paidTotal)}</td></tr></tfoot></table>
      <script>setTimeout(()=>window.print(),200)</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="w-36 text-center font-medium">{monthLabel(month)}</span>
        <Button variant="outline" size="icon" className="h-9 w-9" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => exportToExcel(exportRows(), `salary-${month}`, "Salary")}><FileDown className="h-4 w-4" /> Excel</Button>
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={print}><Printer className="h-4 w-4" /> Print</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Staff</th>
              <th className="px-2 py-2 text-right font-medium">Salary</th>
              <th className="px-2 py-2 text-right font-medium">Present</th>
              <th className="px-2 py-2 text-right font-medium">Leave / Absent</th>
              <th className="px-2 py-2 text-right font-medium">Cut</th>
              <th className="px-2 py-2 text-right font-medium">Extra / Bonus</th>
              <th className="px-2 py-2 text-right font-medium">Advance / Ded.</th>
              <th className="px-2 py-2 text-right font-medium">Net salary</th>
              <th className="px-3 py-2 text-right font-medium">Paid</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ e, s, paid }) => (
              <tr key={e.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setDetail(e)}>
                <td className="px-3 py-2">
                  <span className="block font-medium">{e.full_name}</span>
                  <span className="block text-xs text-muted-foreground">{e.designation || "Staff"}{s.notMarked ? `   ${s.notMarked} not marked = absent` : ""}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{money(s.salary)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{s.present}{s.halfDays ? ` +${s.halfDays}½` : ""}</td>
                <td className="px-2 py-2 text-right tabular-nums">{s.leave + s.paidLeave} / {s.absent + s.notMarked}</td>
                <td className="px-2 py-2 text-right tabular-nums text-destructive">{s.deduction ? `− ${money(s.deduction)}` : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-emerald-600">{s.offDayExtra + s.bonus ? `+ ${money(s.offDayExtra + s.bonus)}` : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-destructive">{s.advance + s.manualDeduction ? `− ${money(s.advance + s.manualDeduction)}` : "—"}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{money(s.net)}</td>
                <td className="px-3 py-2 text-right">
                  {paid ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {money(paid.amount)}</span>
                    : <span className="text-xs text-muted-foreground">Not paid</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              <td className="px-3 py-2" colSpan={7}>Total</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(total)}</td>
              <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-600">{money(paidTotal)} paid</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Per-day pay = salary ÷ working days (days that are not a weekly off). Absent and unpaid leave cut one day, half day cuts half; paid leave cuts nothing; working on an off day adds one day. A past working day that is not marked counts as absent (one day cut); today is not cut until it is over. Click a row to add a bonus, deduction or advance, or to mark the salary paid.
      </p>

      {detail && (() => {
        const r = rows.find((x) => x.e.id === detail.id);
        if (!r) return null;
        return <SalaryDetailDialog e={r.e} s={r.s} month={month} items={(data?.items ?? []).filter((i) => i.employee_id === r.e.id)} paid={r.paid}
          onClose={() => setDetail(null)} onProfile={() => { setDetail(null); onOpen(r.e); }} />;
      })()}
    </div>
  );
}

function SalaryDetailDialog({ e, s, month, items, paid, onClose, onProfile }: {
  e: Employee; s: SalarySummary; month: string; items: SalaryItem[]; paid: { id: string; amount: number; paid_on: string } | null;
  onClose: () => void; onProfile: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<SalaryItem["kind"]>("advance");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const done = () => qc.invalidateQueries({ queryKey: ["hr"] });
  const addItem = useMutation({
    mutationFn: async () => {
      const a = Number(amount);
      if (!(a > 0)) throw new Error("Enter an amount above 0");
      const { error } = await db.from("hr_salary_items").insert({ employee_id: e.id, month: `${month}-01`, kind, amount: a, note: note.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { setAmount(""); setNote(""); done(); },
    onError: (x: any) => toast.error(x?.message ?? "Could not add"),
  });
  const delItem = useMutation({
    mutationFn: async (id: string) => { const { error } = await db.from("hr_salary_items").delete().eq("id", id); if (error) throw error; },
    onSuccess: done,
    onError: (x: any) => toast.error(x?.message ?? "Could not delete"),
  });
  const markPaid = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = on
        ? await db.from("hr_salary_payments").upsert({ employee_id: e.id, month: `${month}-01`, amount: s.net, paid_on: todayDhaka() }, { onConflict: "employee_id,month" })
        : await db.from("hr_salary_payments").delete().eq("employee_id", e.id).eq("month", `${month}-01`);
      if (error) throw error;
    },
    onSuccess: (_, on) => { toast.success(on ? "Marked as paid" : "Paid mark removed"); done(); },
    onError: (x: any) => toast.error(x?.message ?? "Could not save"),
  });
  const KIND_LABEL = { bonus: "Bonus", deduction: "Deduction", advance: "Advance" } as const;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{e.full_name} — {monthLabel(month)}</DialogTitle>
          <DialogDescription><button type="button" className="underline-offset-2 hover:underline" onClick={onProfile}>Open profile and attendance</button></DialogDescription>
        </DialogHeader>
        <SalaryBreakdown s={s} />
        <div className="space-y-2">
          <p className="text-sm font-medium">Bonus, deduction or advance</p>
          {items.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className={cn("w-20 text-xs font-medium", i.kind === "bonus" ? "text-emerald-600" : "text-destructive")}>{KIND_LABEL[i.kind]}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{i.note}</span>
                  <span className="tabular-nums">{money(i.amount)}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => delItem.mutate(i.id)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1.3fr)_auto] gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as SalaryItem["kind"])}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="advance">Advance</SelectItem>
                <SelectItem value="bonus">Bonus</SelectItem>
                <SelectItem value="deduction">Deduction</SelectItem>
              </SelectContent>
            </Select>
            <Input className="h-9 text-right" inputMode="decimal" placeholder="৳ amount" value={amount} onChange={(x) => setAmount(x.target.value)}
              onKeyDown={(x) => { if (x.key === "Enter") addItem.mutate(); }} />
            <Input className="h-9" placeholder="Note (optional)" value={note} onChange={(x) => setNote(x.target.value)}
              onKeyDown={(x) => { if (x.key === "Enter") addItem.mutate(); }} />
            <Button className="h-9" onClick={() => addItem.mutate()} disabled={addItem.isPending}><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {paid ? (
            <>
              <span className="flex items-center gap-1.5 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Paid {money(paid.amount)} on {paid.paid_on}</span>
              <Button variant="outline" onClick={() => markPaid.mutate(false)} disabled={markPaid.isPending}>Remove paid mark</Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">A record only — no money moves in the app.</span>
              <Button onClick={() => markPaid.mutate(true)} disabled={markPaid.isPending}><CheckCircle2 className="h-4 w-4" /> Mark {money(s.net)} paid</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
