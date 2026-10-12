// Printable clinic report (A4) for any period — e.g. the month-end appointment history.
import { toast } from "sonner";
import { getClinic } from "@/lib/clinic-settings";
import { escapeHtml } from "@/lib/invoice-print";
import { apptStatus } from "@/lib/clinic";
import { isCancelledSale, type computeClinicDashboard, type loadClinicDashboard } from "@/lib/clinic-dashboard";

type Data = Awaited<ReturnType<typeof loadClinicDashboard>>;
type View = ReturnType<typeof computeClinicDashboard>;

const n = (v: unknown) => Number(v || 0);
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function printClinicReport(data: Data, view: View, from: string, to: string) {
  const c = getClinic();
  const m = (v: number) => `${c.currency} ${n(v).toLocaleString("en-BD", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const k = view.k;
  const sales = new Map(data.sales.map((s) => [s.id, s]));
  const period = from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;

  const table = (head: string[], rows: string[][], numFrom = 1) =>
    `<table><thead><tr>${head.map((h, i) => `<th class="${i >= numFrom ? "r" : ""}">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.length
        ? rows.map((r) => `<tr>${r.map((v, i) => `<td class="${i >= numFrom ? "r" : ""}">${v}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${head.length}" class="muted">Nothing in this period</td></tr>`
    }</tbody></table>`;

  const visits = [...data.appts].sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1));
  const visitRows = visits.map((a, i) => {
    const s = a.sale_id ? sales.get(a.sale_id) : null;
    const st = apptStatus(a.status).label;
    return [
      String(i + 1),
      escapeHtml(when(a.scheduled_at)) + (a.serial_no ? ` <span class="muted">#${a.serial_no}</span>` : ""),
      `<b>${escapeHtml(a.pet?.name ?? a.guest_pet_name ?? "—")}</b>${a.pet?.species ? ` <span class="muted">${escapeHtml(a.pet.species)}</span>` : ""}`,
      `${escapeHtml(a.pet?.owner?.full_name ?? a.guest_name ?? "—")}<br><span class="muted">${escapeHtml(a.pet?.owner?.phone ?? a.guest_phone ?? "")}</span>`,
      escapeHtml(a.problem?.name ?? a.reason ?? "—"),
      escapeHtml(a.doctor?.full_name ?? "—"),
      escapeHtml(st),
      s ? `${m(n(s.total))}<br><span class="muted">${escapeHtml(s.invoice_no)}</span>` : a.sale_id ? `<span class="muted">other dates</span>` : "—",
      s && !isCancelledSale(s) ? m(n(s.paid)) : "—",
      s && !isCancelledSale(s) && n(s.due) > 0 ? `<b class="due">${m(n(s.due))}</b>` : "—",
    ];
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Clinic report ${escapeHtml(period)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font:11px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111}
  .sheet{padding:14mm 12mm}
  header{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:12px}
  h1{margin:0;font-size:18px;color:#0f766e}
  h2{font-size:13px;margin:16px 0 6px;color:#0f766e}
  .muted{color:#6b7280}
  .due{color:#b91c1c}
  .right{text-align:right}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .kpi{border:1px solid #e5e7eb;border-radius:6px;padding:6px 8px}
  .kpi .l{font-size:10px;color:#6b7280}
  .kpi .v{font-size:14px;font-weight:700}
  .money{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px}
  .money div{display:flex;justify-content:space-between}
  .money .b{font-weight:700;border-top:1px solid #e5e7eb;padding-top:3px}
  table{width:100%;border-collapse:collapse}
  th{background:#0f766e;color:#fff;text-align:left;font-size:10px;padding:4px 5px}
  td{border-bottom:1px solid #eef0f2;padding:4px 5px;vertical-align:top}
  .r{text-align:right}
  tr{page-break-inside:avoid}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  footer{margin-top:16px;font-size:9.5px;color:#6b7280;display:flex;justify-content:space-between}
  @page{size:A4;margin:0}
</style></head><body><div class="sheet">
<header>
  <div><h1>${escapeHtml(c.name)}</h1><div class="muted">${escapeHtml(c.address)} · ${escapeHtml(c.phone)}</div></div>
  <div class="right"><b style="font-size:13px">Clinic report</b><br>${escapeHtml(period)}</div>
</header>

<div class="grid">
  <div class="kpi"><div class="l">Appointments</div><div class="v">${k.appointments}</div></div>
  <div class="kpi"><div class="l">Completed</div><div class="v">${k.completed}</div></div>
  <div class="kpi"><div class="l">Cancelled / No-show</div><div class="v">${k.cancelled} / ${k.noShow}</div></div>
  <div class="kpi"><div class="l">Not billed</div><div class="v">${k.notBilled}</div></div>
</div>

<h2>Money</h2>
<div class="money">
  <div><span>Bills (sales)</span><span>${m(k.gross)}</span></div>
  <div><span>Collected</span><span>${m(k.collected)}</span></div>
  <div><span>Returns / cancelled</span><span>− ${m(k.reversals)}</span></div>
  <div><span>Due on these bills</span><span class="due">${m(k.due)}</span></div>
  <div class="b"><span>Net revenue</span><span>${m(k.net)}</span></div>
  <div><span>Consultation</span><span>${m(k.consultation)}</span></div>
  <div><span>Service cost</span><span>− ${m(k.serviceCost)}</span></div>
  <div><span>Services</span><span>${m(k.services)}</span></div>
  <div><span>Medicine / product cost</span><span>− ${m(k.productCost)}</span></div>
  <div><span>Medicines / products</span><span>${m(k.products)}</span></div>
  <div><span>Doctor share</span><span>− ${m(k.doctorFee)}</span></div>
  <div><span>Bills count</span><span>${k.bills}</span></div>
  <div class="b"><span>Profit</span><span>${m(k.profit)}</span></div>
</div>

<div class="two">
  <div>
    <h2>By doctor</h2>
    ${table(["Doctor", "Appts", "Bills", "Net sales", "Doctor share"], view.byDoctor.map((r) => [escapeHtml(r.label), String(r.count), String(r.extra ?? 0), m(r.revenue), m(r.doctorFee)]))}
  </div>
  <div>
    <h2>By problem</h2>
    ${table(["Problem", "Appts", "Completed", "Billed"], view.byProblem.map((r) => [escapeHtml(r.label), String(r.count), String(r.qty), m(r.revenue)]))}
  </div>
</div>

<h2>Services & items</h2>
${table(["Item", "Qty", "Sales", "Cost", "Doctor share", "Profit"], view.byItem.map((r) => [`${escapeHtml(r.label)} <span class="muted">${escapeHtml(r.sub ?? "")}</span>`, String(r.qty), m(r.revenue), m(r.cost), m(r.doctorFee), m(r.profit)]))}

<h2>Appointment history (${visits.length})</h2>
${table(["#", "Date", "Pet", "Owner", "Problem", "Doctor", "Status", "Bill", "Paid", "Due"], visitRows, 7)}

<footer><span>Printed ${escapeHtml(new Date().toLocaleString("en-GB"))}</span><span>${escapeHtml(c.name)}</span></footer>
</div><script>window.onload=()=>{setTimeout(()=>window.print(),300)}</script></body></html>`;

  const w = window.open("", "_blank", "width=1000,height=1100");
  if (!w) {
    toast.error("Pop-up blocked. Please allow pop-ups to print.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
