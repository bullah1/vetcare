// Printable salary slip (A4, one staff member per page). The browser's print
// window can save it as PDF. Shows who, the month, attendance (with a small
// calendar), every addition / cut with its date and reason, and the net pay.
import { getClinic } from "@/lib/clinic-settings";
import {
  ITEM_KIND_LABEL, STATUS_META, WEEKDAYS, WEEKDAYS_LONG, fmtTime, isLate, monthDays, weekday,
  type AttendanceRow, type Employee, type SalaryItem, type SalarySummary,
} from "@/lib/hr";

export type SlipData = {
  e: Employee;
  s: SalarySummary;
  items: SalaryItem[];
  attendance: AttendanceRow[];
  paid: { amount: number; paid_on: string } | null;
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const tk = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dShort = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const STATUS_COLOR: Record<string, string> = { present: "#16a34a", half_day: "#0284c7", paid_leave: "#7c3aed", leave: "#d97706", absent: "#dc2626" };

function slipHtml({ e, s, items, attendance, paid }: SlipData, month: string, today: string): string {
  const C = getClinic();
  const byDate = new Map(attendance.map((a) => [a.work_date, a]));
  const days = monthDays(month);
  const off = new Set((e.weekly_off ?? []).map(Number));
  const itemsByDate = new Map<string, SalaryItem[]>();
  for (const i of items) if (i.item_date) itemsByDate.set(i.item_date, [...(itemsByDate.get(i.item_date) ?? []), i]);

  // Mini calendar
  const lead = weekday(days[0]);
  const cells: string[] = [];
  for (let i = 0; i < lead; i++) cells.push(`<td class="blank"></td>`);
  for (const d of days) {
    const a = byDate.get(d);
    const isOff = off.has(weekday(d));
    let code = "", color = "#9ca3af";
    if (a) { code = STATUS_META[a.status].short; color = STATUS_COLOR[a.status]; }
    else if (isOff) code = "Off";
    else if (d < e.join_date) code = "";
    else if (d < today && d >= (e.attendance_from ?? "")) { code = "A*"; color = "#dc2626"; }
    const late = a && isLate(a.check_in, e.duty_start) ? `<span class="late">late</span>` : "";
    const fine = itemsByDate.has(d) ? `<span class="fine">৳</span>` : "";
    cells.push(`<td class="${isOff ? "off" : ""}"><b>${Number(d.slice(8))}</b><span style="color:${color}">${code}</span>${late}${fine}</td>`);
  }
  while (cells.length % 7) cells.push(`<td class="blank"></td>`);
  const weeks: string[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(`<tr>${cells.slice(i, i + 7).join("")}</tr>`);

  // Earnings / deductions with reasons
  const line = (label: string, amount: number, sub = "") =>
    `<tr><td>${label}${sub ? `<div class="sub">${sub}</div>` : ""}</td><td class="amt">${tk(amount)}</td></tr>`;
  const sorted = [...items].sort((a, b) => String(a.item_date ?? "").localeCompare(String(b.item_date ?? "")));
  const itemLine = (i: SalaryItem) =>
    line(`${ITEM_KIND_LABEL[i.kind]}${i.item_date ? ` — ${dShort(i.item_date)}` : ""}`, Number(i.amount), esc(i.note || "No reason written"));

  const earn: string[] = [line("Monthly salary", s.salary, `${s.workingDays} working days × ${tk(s.perDay)} per day`)];
  if (s.offDayExtra > 0) earn.push(line("Worked on weekly off day", s.offDayExtra, `${s.offDayWorked} day × ${tk(s.perDay)}`));
  for (const i of sorted.filter((x) => x.kind === "bonus")) earn.push(itemLine(i));
  const totalEarn = r2(s.salary + s.offDayExtra + s.bonus);

  const ded: string[] = [];
  const dayLine = (label: string, n: number, why: string) => { if (n > 0) ded.push(line(label, r2(n * s.perDay), `${n} day${n === 1 ? "" : "s"} × ${tk(s.perDay)} — ${why}`)); };
  dayLine("Absent", s.absent, "marked absent");
  dayLine("Leave (unpaid)", s.leave, "leave without pay");
  dayLine("Not marked (counted absent)", s.notMarked, "no attendance on a working day");
  if (s.halfDays > 0) ded.push(line("Half day", r2(s.halfDays * 0.5 * s.perDay), `${s.halfDays} × half of ${tk(s.perDay)}`));
  dayLine("Before joining", s.notJoinedDays, `joined ${dShort(e.join_date)}`);
  const dayCutsListed = r2([s.absent, s.leave, s.notMarked, s.notJoinedDays].reduce((t, n) => t + r2(n * s.perDay), 0) + r2(s.halfDays * 0.5 * s.perDay));
  if (s.deduction > 0 && Math.abs(dayCutsListed - s.deduction) >= 0.01) {
    ded.push(line("Adjustment", r2(s.deduction - dayCutsListed), "attendance cut is limited to the monthly salary"));
  }
  for (const i of sorted.filter((x) => x.kind === "deduction")) ded.push(itemLine(i));
  for (const i of sorted.filter((x) => x.kind === "advance")) ded.push(itemLine(i));
  const totalDed = r2(s.deduction + s.manualDeduction + s.advance);
  const netRaw = r2(totalEarn - totalDed);

  const leaveDates = attendance
    .filter((a) => a.status !== "present")
    .sort((a, b) => a.work_date.localeCompare(b.work_date))
    .map((a) => `${dShort(a.work_date)} (${STATUS_META[a.status].label})`);

  const box = (label: string, v: string | number, tone = "") => `<div class="box ${tone}"><span>${label}</span><b>${v}</b></div>`;

  return `
  <section class="slip">
    <header>
      <div>
        <h1>${esc(C.name)}</h1>
        <p>${esc(C.address)}${C.phone ? ` &nbsp;|&nbsp; ${esc(C.phone)}` : ""}</p>
      </div>
      <div class="right">
        <h2>Salary Slip</h2>
        <p><b>${monthLabel(month)}</b></p>
        <p class="muted">No. SAL-${month.replace("-", "")}-${e.id.slice(0, 4).toUpperCase()}</p>
      </div>
    </header>

    <table class="info">
      <tr><th>Name</th><td><b>${esc(e.full_name)}</b></td><th>Designation</th><td>${esc(e.designation || "Staff")}</td></tr>
      <tr><th>Phone</th><td>${esc(e.phone || "—")}</td><th>Joined</th><td>${dShort(e.join_date)}</td></tr>
      <tr><th>Duty time</th><td>${e.duty_start || e.duty_end ? `${fmtTime(e.duty_start)} – ${fmtTime(e.duty_end)}` : "—"}</td>
          <th>Weekly off</th><td>${(e.weekly_off ?? []).length ? [...e.weekly_off].sort().map((d) => WEEKDAYS_LONG[d]).join(", ") : "None"}</td></tr>
    </table>

    <h3>Attendance</h3>
    <div class="boxes">
      ${box("Working days", s.workingDays)}${box("Present", s.present)}${box("Half day", s.halfDays)}${box("Paid leave", s.paidLeave)}
      ${box("Leave", s.leave, s.leave ? "warn" : "")}${box("Absent", s.absent, s.absent ? "bad" : "")}${box("Not marked", s.notMarked, s.notMarked ? "bad" : "")}
      ${box("Late", s.late, s.late ? "warn" : "")}${box("Off-day worked", s.offDayWorked)}
    </div>
    <div class="cal-wrap">
      <table class="cal"><thead><tr>${WEEKDAYS.map((d) => `<th>${d}</th>`).join("")}</tr></thead><tbody>${weeks.join("")}</tbody></table>
      <div class="legend">
        <p><b>P</b> present &nbsp; <b>½</b> half day &nbsp; <b>PL</b> paid leave &nbsp; <b>L</b> leave &nbsp; <b>A</b> absent &nbsp; <b>A*</b> not marked (counted absent) &nbsp; <b>Off</b> weekly off &nbsp; <b class="fine">৳</b> fine / advance / bonus that day</p>
        ${leaveDates.length ? `<p><b>Leave / absence dates:</b> ${leaveDates.join(", ")}</p>` : ""}
      </div>
    </div>

    <div class="money">
      <table class="ledger"><thead><tr><th>Earnings</th><th class="amt">Amount</th></tr></thead>
        <tbody>${earn.join("")}</tbody>
        <tfoot><tr><td>Total earnings</td><td class="amt">${tk(totalEarn)}</td></tr></tfoot></table>
      <table class="ledger"><thead><tr><th>Deductions (with reason)</th><th class="amt">Amount</th></tr></thead>
        <tbody>${ded.length ? ded.join("") : `<tr><td colspan="2" class="muted">No deductions</td></tr>`}</tbody>
        <tfoot><tr><td>Total deductions</td><td class="amt">${tk(totalDed)}</td></tr></tfoot></table>
    </div>

    <div class="net">
      <div><span>Net salary payable</span><b>${tk(s.net)}</b>${netRaw < 0 ? `<small>Deductions were more than earnings (${tk(netRaw)}); net is shown as 0.</small>` : ""}</div>
      <div class="paid">${paid ? `Paid ${tk(paid.amount)} on ${dShort(paid.paid_on)}${
        Math.abs(r2(s.net - Number(paid.amount))) >= 0.01
          ? `<small>${s.net > Number(paid.amount) ? `${tk(r2(s.net - Number(paid.amount)))} still due` : `${tk(r2(Number(paid.amount) - s.net))} paid extra`}</small>` : ""}` : "Not paid yet"}</div>
    </div>

    <p class="rule">Per-day pay = monthly salary ÷ working days (days that are not a weekly off). Absent, unpaid leave and an unmarked working day cut one day; half day cuts half; paid leave cuts nothing; working on a weekly off day adds one day.</p>

    <div class="sign">
      <div><span></span>Employee signature</div>
      <div><span></span>Authorized signature</div>
    </div>
    <p class="printed">Printed ${dShort(today)}</p>
  </section>`;
}

/** Opens the print window with one slip per staff member. Pass a pre-opened window from the click to avoid pop-up blocking. */
export function printSalarySlips(slips: SlipData[], month: string, today: string, target?: Window | null) {
  const w = target ?? window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  const title = slips.length === 1 ? `Salary slip ${slips[0].e.full_name} ${monthLabel(month)}` : `Salary slips ${monthLabel(month)}`;
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.45 "Noto Sans Bengali", "Nirmala UI", "Segoe UI", system-ui, sans-serif; color: #111; }
  .toolbar { position: sticky; top: 0; background: #f5f5f5; border-bottom: 1px solid #ddd; padding: 8px 16px; display: flex; gap: 8px; align-items: center; }
  .toolbar button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid #f55504; background: #f55504; color: #fff; cursor: pointer; }
  .toolbar span { color: #555; }
  .slip { max-width: 186mm; margin: 0 auto; padding: 16px 0; page-break-after: always; }
  .slip:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #f55504; padding-bottom: 8px; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 18px; margin: 0; color: #f55504; } h3 { font-size: 13px; margin: 14px 0 6px; }
  header p { margin: 2px 0 0; } .right { text-align: right; } .muted { color: #6b7280; }
  .info { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .info th { text-align: left; color: #6b7280; font-weight: 500; width: 16%; padding: 4px 6px; background: #fafafa; border: 1px solid #eee; }
  .info td { padding: 4px 6px; border: 1px solid #eee; }
  .boxes { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; }
  .box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px; text-align: center; }
  .box span { display: block; font-size: 9px; color: #6b7280; } .box b { font-size: 15px; }
  .box.bad b { color: #dc2626; } .box.warn b { color: #d97706; }
  .cal-wrap { display: grid; grid-template-columns: 62mm 1fr; gap: 10px; margin-top: 8px; align-items: start; }
  .cal { border-collapse: collapse; width: 100%; table-layout: fixed; }
  .cal th { font-size: 9px; color: #6b7280; font-weight: 500; }
  .cal td { border: 1px solid #e5e7eb; height: 22px; text-align: center; font-size: 8px; position: relative; padding: 1px; }
  .cal td b { display: block; font-size: 9px; } .cal td.off { background: #f3f4f6; } .cal td.blank { border: none; }
  .cal .late { position: absolute; left: 1px; top: 0; font-size: 6px; color: #d97706; }
  .fine { color: #dc2626; font-weight: 700; } .cal .fine { position: absolute; right: 2px; top: 0; font-size: 8px; }
  .legend p { margin: 0 0 4px; font-size: 10px; color: #374151; }
  .money { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
  .ledger { width: 100%; border-collapse: collapse; }
  .ledger th { text-align: left; background: #fafafa; border-bottom: 2px solid #e5e7eb; padding: 5px 6px; font-size: 11px; }
  .ledger td { border-bottom: 1px solid #f0f0f0; padding: 5px 6px; vertical-align: top; }
  .ledger .amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ledger .sub { color: #4b5563; font-size: 11.5px; }
  .ledger tfoot td { font-weight: 700; border-top: 2px solid #e5e7eb; border-bottom: none; }
  .net { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding: 10px 14px; border: 2px solid #111; border-radius: 8px; }
  .net span { display: block; color: #6b7280; } .net b { font-size: 22px; } .net small { display: block; color: #dc2626; }
  .net .paid { font-weight: 600; text-align: right; } .net .paid small { display: block; font-weight: 600; }
  .rule { font-size: 9.5px; color: #6b7280; margin: 8px 0 0; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
  .sign div { text-align: center; color: #374151; } .sign span { display: block; border-top: 1px solid #111; margin-bottom: 4px; }
  .printed { text-align: right; font-size: 9px; color: #9ca3af; margin-top: 10px; }
  @media print { .toolbar { display: none; } .slip { padding: 0; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button><span>${slips.length} slip${slips.length === 1 ? "" : "s"} — choose "Save as PDF" as the printer to get a PDF file.</span></div>
${slips.map((x) => slipHtml(x, month, today)).join("")}
<script>(document.fonts ? document.fonts.ready : Promise.resolve()).then(function(){ setTimeout(function(){ window.print(); }, 300); });</script>
</body></html>`);
  w.document.close();
}
