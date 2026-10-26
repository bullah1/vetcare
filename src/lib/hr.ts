// HR: attendance statuses and the monthly salary sheet. Pure functions — tested in hr.test.ts.
//
// Salary rule (kept simple on purpose):
//   per-day pay   = monthly salary ÷ working days in the month (days that are not a weekly off day)
//   − 1 day pay   for each Absent or (unpaid) Leave day
//   − ½ day pay   for each Half day
//   − 1 day pay   for each working day before the joining date
//   + 1 day pay   for each day worked on a weekly off day
//   + bonus − deduction − advance
// Paid leave costs nothing. A past working day with no mark counts as Absent (one day cut);
// today is not counted until the day is over, nor are days before `attendance_from`.

export type AttendanceStatus = "present" | "half_day" | "leave" | "paid_leave" | "absent";

export const STATUS_META: Record<AttendanceStatus, { label: string; short: string; tone: string }> = {
  present: { label: "Present", short: "P", tone: "bg-emerald-500 text-white" },
  half_day: { label: "Half day", short: "½", tone: "bg-sky-500 text-white" },
  paid_leave: { label: "Paid leave", short: "PL", tone: "bg-violet-500 text-white" },
  leave: { label: "Leave (unpaid)", short: "L", tone: "bg-amber-500 text-white" },
  absent: { label: "Absent", short: "A", tone: "bg-red-500 text-white" },
};
export const STATUS_ORDER: AttendanceStatus[] = ["present", "half_day", "paid_leave", "leave", "absent"];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type Employee = {
  id: string; full_name: string; phone: string | null; designation: string | null;
  monthly_salary: number; duty_start: string | null; duty_end: string | null;
  weekly_off: number[]; join_date: string; is_active: boolean; notes: string | null;
  /** Unmarked days before this date are not counted as absent. */
  attendance_from?: string | null;
};
export type AttendanceRow = { id?: string; employee_id: string; work_date: string; status: AttendanceStatus; check_in: string | null; note?: string | null };
export type SalaryItemKind = "bonus" | "deduction" | "advance";
export type SalaryItem = { id: string; employee_id: string; month: string; kind: SalaryItemKind; amount: number; note: string | null; item_date?: string | null };

export const ITEM_KIND_LABEL: Record<SalaryItemKind, string> = { deduction: "Fine / deduction", advance: "Advance", bonus: "Bonus" };

/** Ready-made reasons, picked with one tap (anything else can still be typed). */
export const PRESET_REASONS: Record<SalaryItemKind, string[]> = {
  deduction: [
    "দেরিতে আসা", "অনুমতি ছাড়া অনুপস্থিত", "আগে চলে যাওয়া", "জিনিস ভাঙা / নষ্ট", "ক্যাশে টাকা কম",
    "কাজে অবহেলা", "ডিউটিতে মোবাইল ব্যবহার", "ইউনিফর্ম না পরা", "গ্রাহকের সাথে খারাপ ব্যবহার",
  ],
  advance: ["অগ্রিম বেতন", "জরুরি প্রয়োজনে অগ্রিম"],
  bonus: ["ঈদ বোনাস", "উৎসব বোনাস", "ভালো কাজের জন্য", "অতিরিক্ত সময় কাজ (ওভারটাইম)"],
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "2026-10" → ["2026-10-01", …, "2026-10-31"] */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Day of week (0 = Sunday) for "YYYY-MM-DD", independent of the device time zone. */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "09:00:00" → "9:00 AM" */
export function fmtTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
}

const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
/** Late = checked in more than `graceMin` minutes after duty start. */
export function isLate(checkIn: string | null, dutyStart: string | null, graceMin = 10): boolean {
  if (!checkIn || !dutyStart) return false;
  return minutes(checkIn) > minutes(dutyStart) + graceMin;
}

export type SalarySummary = {
  salary: number; workingDays: number; perDay: number;
  present: number; halfDays: number; paidLeave: number; leave: number; absent: number;
  offDayWorked: number; late: number; notMarked: number; notJoinedDays: number;
  deductDays: number; deduction: number; offDayExtra: number;
  bonus: number; manualDeduction: number; advance: number;
  net: number;
};

/**
 * Salary sheet for one employee and one month ("YYYY-MM").
 * `today` ("YYYY-MM-DD"): working days before today with no mark count as absent; today and later are not cut.
 */
export function monthSalary(emp: Pick<Employee, "monthly_salary" | "weekly_off" | "join_date" | "duty_start" | "attendance_from">, month: string,
  attendance: Pick<AttendanceRow, "work_date" | "status" | "check_in">[], items: Pick<SalaryItem, "kind" | "amount">[], today: string): SalarySummary {
  const salary = Number(emp.monthly_salary) || 0;
  const off = new Set((emp.weekly_off ?? []).map(Number));
  const days = monthDays(month);
  const workingDays = days.filter((d) => !off.has(weekday(d))).length;
  const perDay = workingDays > 0 ? salary / workingDays : 0;
  const byDate = new Map(attendance.map((a) => [a.work_date, a]));

  const s = { present: 0, halfDays: 0, paidLeave: 0, leave: 0, absent: 0, offDayWorked: 0, late: 0, notMarked: 0, notJoinedDays: 0 };
  for (const d of days) {
    const isOff = off.has(weekday(d));
    const a = byDate.get(d);
    if (d < emp.join_date) { if (!isOff) s.notJoinedDays++; continue; }
    if (!a) { if (!isOff && d < today && d >= (emp.attendance_from ?? "")) s.notMarked++; continue; }
    if (a.status === "present" || a.status === "half_day") {
      if (isLate(a.check_in, emp.duty_start)) s.late++;
      if (isOff) { s.offDayWorked += a.status === "present" ? 1 : 0.5; continue; }
    }
    if (isOff) continue; // leave / absent on an off day changes nothing
    if (a.status === "present") s.present++;
    else if (a.status === "half_day") s.halfDays++;
    else if (a.status === "paid_leave") s.paidLeave++;
    else if (a.status === "leave") s.leave++;
    else if (a.status === "absent") s.absent++;
  }

  const sum = (k: string) => round2(items.filter((i) => i.kind === k).reduce((t, i) => t + Number(i.amount || 0), 0));
  const bonus = sum("bonus"), manualDeduction = sum("deduction"), advance = sum("advance");
  // Not marked on a past working day = did not come = absent.
  const deductDays = s.absent + s.notMarked + s.leave + s.halfDays * 0.5 + s.notJoinedDays;
  const deduction = round2(Math.min(salary, deductDays * perDay));
  const offDayExtra = round2(s.offDayWorked * perDay);
  const net = round2(Math.max(0, salary - deduction + offDayExtra + bonus - manualDeduction - advance));
  return { salary, workingDays, perDay: round2(perDay), ...s, deductDays, deduction, offDayExtra, bonus, manualDeduction, advance, net };
}
