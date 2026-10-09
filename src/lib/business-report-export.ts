// Excel workbook and printable (PDF) Monthly Business Report. Both read the
// same computed numbers as the screen, so the three always match.
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { getClinic } from "@/lib/clinic-settings";
import { escapeHtml } from "@/lib/invoice-print";
import { METHOD_LABEL, changePct, type Computed, computeSnapshot } from "@/lib/business-report";

type Snap = ReturnType<typeof computeSnapshot>;
const r = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const money = (v: number) => `৳ ${Number(v || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The profit statement lines, shared by screen, Excel and PDF. */
export function profitLines(c: Computed) {
  return [
    { label: "Sales before discount", value: c.sales.beforeDiscount },
    { label: "− Discounts", value: -c.sales.discounts },
    { label: "Invoice sales", value: c.sales.invoiceSales, strong: true },
    { label: "− Returns, refunds & cancellations", value: -c.sales.reversals },
    { label: "Net sales", value: c.sales.netSales, strong: true },
    { label: "− Cost of goods sold (COGS)", value: -c.cogs },
    { label: "Gross profit", value: c.grossProfit, strong: true },
    { label: "+ Delivery charge income", value: c.delivery.income },
    { label: "− Actual delivery cost", value: -c.delivery.cost },
    { label: "− Operating expenses", value: -c.opex },
    { label: "− Stock written off (damaged / expired / lost)", value: -c.stockAdj.loss },
    { label: "+ Stock found", value: c.stockAdj.found },
    { label: "Net profit", value: c.netProfit, strong: true },
  ];
}

export const PROFIT_NOTES = [
  "Purchases are not expenses: bought goods become stock; only goods sold (COGS, at cost when sold) are charged.",
  "Clinic consultation fees are invoices, so they are already inside Sales — shown separately, never added twice.",
  "Stock is valued at the latest purchase cost of each product (not the selling price). Negative stock counts as zero.",
  "Delivery charge income counts only delivered parcels; delivery cost uses rider fees and courier deductions entered in Delivery Report.",
  "Tax / VAT and depreciation are not included.",
];

function summaryRows(c: Computed, p: Computed | null, s: Snap | null) {
  const row = (k: string, cur: number, prev?: number) => {
    const ch = prev == null ? null : changePct(cur, prev);
    return { Item: k, "This period": r(cur), "Previous period": prev == null ? "" : r(prev), "Change %": ch == null ? "" : r(ch) } as Record<string, string | number>;
  };
  const rows = [
    row("Invoice sales", c.sales.invoiceSales, p?.sales.invoiceSales),
    row("Net sales", c.sales.netSales, p?.sales.netSales),
    row("Shop net sales", c.sales.shopNet, p?.sales.shopNet),
    row("Clinic net revenue", c.sales.clinicNet, p?.sales.clinicNet),
    row("Discounts", c.sales.discounts, p?.sales.discounts),
    row("Returns, refunds & cancellations", c.sales.reversals, p?.sales.reversals),
    row("Cost of goods sold", c.cogs, p?.cogs),
    row("Gross profit", c.grossProfit, p?.grossProfit),
    row("Operating expenses", c.opex, p?.opex),
    row("Net delivery income", c.delivery.net, p?.delivery.net),
    row("Net profit", c.netProfit, p?.netProfit),
    row("Total purchases", c.purchases.total, p?.purchases.total),
    row("Supplier payments", c.purchases.supplierPaid, p?.purchases.supplierPaid),
    row("Delivery charges collected", c.delivery.income, p?.delivery.income),
    row("Actual delivery cost", c.delivery.cost, p?.delivery.cost),
    row("Cancelled invoices (count)", c.sales.cancelledInvoices, p?.sales.cancelledInvoices),
    row("Returns (count)", c.returns.count, p?.returns.count),
  ];
  if (s) {
    rows.push(
      { Item: "Current stock value (at cost)", "This period": r(s.stockValue), "Previous period": "", "Change %": "" } as Record<string, string | number>,
      { Item: "Customer due (receivable)", "This period": r(s.receivable), "Previous period": "", "Change %": "" },
      { Item: "Supplier payable", "This period": r(s.payable), "Previous period": "", "Change %": "" },
    );
    for (const [m, v] of Object.entries(s.balances)) rows.push({ Item: `Balance — ${METHOD_LABEL[m] ?? m}`, "This period": r(v), "Previous period": "", "Change %": "" });
  }
  return rows;
}

export function exportBusinessExcel(c: Computed, p: Computed | null, s: Snap | null) {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, unknown>[]) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No data" }]);
    const headers = rows.length ? Object.keys(rows[0]) : ["Note"];
    ws["!cols"] = headers.map((h) => ({ wch: Math.min(42, Math.max(h.length + 2, ...rows.map((x) => String(x[h] ?? "").length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };
  add("Summary", summaryRows(c, p, s));
  add("Profit & Loss", profitLines(c).map((l) => ({ Line: l.label, Amount: r(l.value) })));
  add("Daily", c.daily.map((d) => ({ Date: d.day, "Invoice sales": r(d.sales), Reversals: r(d.reversals), "Net sales": r(d.net), COGS: r(d.cogs), "Gross profit": r(d.profit), Clinic: r(d.clinic) })));
  add("Products", [...c.products].sort((a, b) => b.revenue - a.revenue).map((x) => ({ Product: x.name.trim(), Category: x.category, "Qty sold": r(x.qty), Revenue: r(x.revenue), Cost: r(x.cost), "Gross profit": r(x.profit), "Margin %": r(x.margin) })));
  add("Categories", c.categories.map((x) => ({ Category: x.category, "Qty sold": r(x.qty), Revenue: r(x.revenue), Cost: r(x.cost), "Gross profit": r(x.profit), "Margin %": r(x.margin) })));
  add("Collections", Object.entries(c.collected).map(([m, v]) => ({ Method: METHOD_LABEL[m] ?? m, Collected: r(v) })));
  add("Purchases by supplier", c.purchases.bySupplier.map((x) => ({ Supplier: x.supplier, Invoices: x.invoices, Total: r(x.total), Paid: r(x.paid), Due: r(x.due) })));
  add("Expenses", c.opexRows.map((e: any) => ({ Date: e.expense_date, Category: e.category, "Paid to": e.paid_to ?? "", Method: METHOD_LABEL[e.method] ?? e.method, Amount: r(e.amount), Notes: e.notes ?? "" })));
  add("Returns", c.returns.rows.map((x) => ({ Date: x.date?.slice(0, 10), "Return no": x.returnNo, Invoice: x.invoiceNo, Type: x.type, Value: r(x.value), "Refund paid": r(x.refundPaid), "Due reduced": r(x.dueReduction), Method: x.method ?? "", Restocked: x.restock ? "Yes" : "No", Reason: x.reason ?? "" })));
  add("Delivery partners", c.delivery.agents.map((a: any) => ({ Name: a.name, Type: a.kind === "courier" ? "Courier" : "Local rider", Assigned: a.assigned, Delivered: a.delivered, Cancelled: a.cancelled, "In progress": a.progress, "Charge income": r(a.income), "Actual cost": r(a.cost), Net: r(a.net), "Fee unpaid": r(a.feeUnpaid), "Cash with rider": r(a.cashPending), "COD pending": r(a.codPending) })));
  add("Parcels", c.raw.shipments.map((x) => ({ Date: x.at.slice(0, 10), Invoice: x.invoiceNo, Type: x.kind === "courier" ? "Courier" : "Local", Customer: x.customer, Phone: x.phone ?? "", "Rider / Courier": x.agent, Tracking: x.tracking ?? "", Status: x.statusLabel, "Delivery charge": r(x.charge), "COD charge": r(x.codCharge), "Actual cost": x.cost == null ? "" : r(x.cost), "COD / collect": r(x.collect), "Payment status": x.kind === "courier" ? (x.codReceived != null ? "COD received" : "Pending") : x.cashReceived ? "Cash received" : "Pending" })));
  add("Doctors", c.clinic.doctors.map((d: any) => ({ Doctor: d.doctor, Appointments: d.count, Completed: d.completed, Cancelled: d.cancelled, Paid: d.paid, Unpaid: d.unpaid, Free: d.free, "Fee charged": r(d.fee), Collected: r(d.collected) })));
  if (s) {
    add("Stock by category", s.categories.map((x) => ({ Category: x.category, Products: x.products, Units: r(x.units), "Value at cost": r(x.value), "Value at selling price": r(x.retail) })));
    add("Low & out of stock", s.lowRows.map((x: any) => ({ Product: String(x.name).trim(), Category: x.category, Stock: Number(x.stock_quantity), "Reorder level": Number(x.low_stock_threshold ?? 0), State: x.state })));
    add("Expiry", s.expiryRows.map((x: any) => ({ Product: String(x.name).trim(), Batch: x.batch ?? "", Expiry: x.expiry, Qty: r(x.qty), Value: r(x.value), State: x.expired ? "Expired" : "Expiring" })));
    add("Customer due", s.dueRows.map((x: any) => ({ Invoice: x.invoice_no, Date: String(x.created_at).slice(0, 10), Customer: x.owner?.full_name ?? "Walk-in", Phone: x.owner?.phone ?? "", Total: r(x.total), Paid: r(x.paid), Due: r(x.due) })));
    add("Supplier payable", s.supplierRows.map((x: any) => ({ Supplier: x.name, Phone: x.phone ?? "", Payable: r(x.balance_due) })));
  }
  add("Notes", PROFIT_NOTES.map((t) => ({ Note: t })));
  XLSX.writeFile(wb, `business-report_${c.period.from}_to_${c.period.to}.xlsx`);
}

/** Printable report — the browser's "Save as PDF" makes the PDF. */
export function printBusinessReport(c: Computed, p: Computed | null, s: Snap | null, insights: { tone: string; text: string }[]) {
  const CLINIC = getClinic();
  const cmp = (cur: number, prev?: number) => {
    if (prev == null) return "";
    const ch = changePct(cur, prev);
    return ch == null ? "" : `<span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(1)}%</span>`;
  };
  const kpi = (label: string, cur: number, prev?: number) =>
    `<div class="kpi"><div class="k">${escapeHtml(label)}</div><div class="v">${money(cur)}</div><div class="c">${cmp(cur, prev)}${prev != null ? ` <span class="muted">prev ${money(prev)}</span>` : ""}</div></div>`;
  const table = (head: string[], rows: (string | number)[][]) =>
    `<table><thead><tr>${head.map((h, i) => `<th class="${i ? "r" : ""}">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.length ? rows.map((row) => `<tr>${row.map((v, i) => `<td class="${i ? "r" : ""}">${typeof v === "number" ? money(v) : escapeHtml(v)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="muted">No data</td></tr>`
    }</tbody></table>`;
  const cnt = (v: number) => String(v);

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Business Report ${c.period.from} – ${c.period.to}</title>
<style>
  *{box-sizing:border-box}body{margin:0;font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111}
  .sheet{max-width:820px;margin:0 auto;padding:28px 34px}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #f55504;padding-bottom:10px;margin-bottom:14px}
  h1{margin:0;font-size:20px}h2{font-size:13px;margin:18px 0 6px;color:#f55504;text-transform:uppercase;letter-spacing:.06em}
  .muted{color:#64748b}.meta{text-align:right;font-size:11px;color:#475569}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .kpi{border:1px solid #e5e7eb;border-radius:6px;padding:8px}.kpi .k{font-size:10.5px;color:#64748b}.kpi .v{font-size:15px;font-weight:700;margin-top:2px}.kpi .c{font-size:10px;margin-top:2px}
  .up{color:#047857}.down{color:#b91c1c}
  table{width:100%;border-collapse:collapse;margin-top:4px}th,td{padding:5px 6px;border-bottom:1px solid #eee;text-align:left}th{background:#f8fafc;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:#475569}
  .r{text-align:right;font-variant-numeric:tabular-nums}tr.strong td{font-weight:700;border-top:1.5px solid #111}
  ul{margin:4px 0 0 18px;padding:0}li{margin:2px 0}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .notes{margin-top:16px;font-size:10.5px;color:#475569;border-top:1px dashed #ddd;padding-top:8px}
  @page{size:A4;margin:12mm}@media print{.sheet{padding:0}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}
</style></head><body><div class="sheet">
<header><div><h1>${escapeHtml(CLINIC.name)} — Business Report</h1><div class="muted">${escapeHtml(CLINIC.address)}</div></div>
<div class="meta">Period: <b>${c.period.from}</b> to <b>${c.period.to}</b><br>${p ? `Compared with ${p.period.from} to ${p.period.to}<br>` : ""}Generated: ${new Date().toLocaleString()}</div></header>

<h2>Summary</h2>
<div class="kpis">
${kpi("Net sales", c.sales.netSales, p?.sales.netSales)}
${kpi("Gross profit", c.grossProfit, p?.grossProfit)}
${kpi("Net profit", c.netProfit, p?.netProfit)}
${kpi("Total purchases", c.purchases.total, p?.purchases.total)}
${kpi("Operating expenses", c.opex, p?.opex)}
${kpi("Clinic revenue", c.sales.clinicNet, p?.sales.clinicNet)}
${s ? kpi("Stock value (at cost)", s.stockValue) : ""}
${s ? kpi("Customer due", s.receivable) : ""}
${s ? kpi("Supplier payable", s.payable) : ""}
</div>

<h2>Profit &amp; loss</h2>
<table><tbody>${profitLines(c).map((l) => `<tr class="${l.strong ? "strong" : ""}"><td>${escapeHtml(l.label)}</td><td class="r">${money(l.value)}</td></tr>`).join("")}</tbody></table>

<div class="two">
<div><h2>Collections by method</h2>${table(["Method", "Collected"], Object.entries(c.collected).map(([m, v]) => [METHOD_LABEL[m] ?? m, v]))}</div>
<div><h2>Balances (all time)</h2>${s ? table(["Account", "Balance"], Object.entries(s.balances).map(([m, v]) => [METHOD_LABEL[m] ?? m, v])) : ""}
${s?.drawer ? `<p class="muted">Cash drawer now: expected ${money(Number(s.drawer.expected_cash || 0))} (${escapeHtml(String(s.drawer.status ?? ""))} shift)</p>` : ""}</div>
</div>

<h2>Returns, refunds &amp; cancellations</h2>
${table(["Item", "Value"], [["Returns (" + cnt(c.returns.count) + ")", c.returns.rows.filter((x) => x.type === "Return").reduce((a, x) => a + x.value, 0)], ["Cancelled invoices (" + cnt(c.returns.cancelCount) + ")", c.returns.rows.filter((x) => x.type === "Cancellation").reduce((a, x) => a + x.value, 0)], ["Goods restocked", c.returns.restockedValue], ["Goods not restocked", c.returns.notRestockedValue], ["Cash refunded", c.refundsPaid]])}

<h2>Delivery</h2>
${table(["", "Local", "Courier"], [
  ["Parcels", cnt(c.delivery.local.total), cnt(c.delivery.courier.total)],
  ["Delivered", cnt(c.delivery.local.delivered), cnt(c.delivery.courier.delivered)],
  ["In progress", cnt(c.delivery.local.progress), cnt(c.delivery.courier.progress)],
  ["Cancelled / returned", cnt(c.delivery.local.cancelled), cnt(c.delivery.courier.cancelled)],
  ["Charge income", c.delivery.localMoney.income, c.delivery.courierMoney.income],
  ["Actual cost", c.delivery.localMoney.cost, c.delivery.courierMoney.cost],
  ["Net delivery income", c.delivery.localMoney.net, c.delivery.courierMoney.net],
])}
${table(["Rider / courier", "Parcels", "Delivered", "Income", "Cost", "Net"], c.delivery.agents.map((a: any) => [a.name, cnt(a.assigned), cnt(a.delivered), a.income, a.cost, a.net]))}

<h2>Clinic</h2>
${table(["Doctor", "Appointments", "Paid", "Unpaid", "Free", "Collected"], c.clinic.doctors.map((d: any) => [d.doctor, cnt(d.count), cnt(d.paid), cnt(d.unpaid), cnt(d.free), d.collected]))}
<p class="muted">Clinic revenue ${money(c.clinic.revenue)} − doctor &amp; clinic expenses ${money(c.clinic.expenses)} = net ${money(c.clinic.net)}. Visits ${c.clinic.visits}, prescriptions ${c.clinic.prescriptions}.</p>

<div class="two">
<div><h2>Expenses by category</h2>${table(["Category", "Amount"], c.expenseCategories.map((e) => [e.category, e.amount]))}</div>
<div><h2>Top products</h2>${table(["Product", "Revenue", "Profit"], [...c.products].sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((x) => [x.name.trim(), x.revenue, x.profit]))}</div>
</div>

${s ? `<h2>Stock</h2>${table(["Category", "Units", "Value at cost"], s.categories.slice(0, 15).map((x) => [x.category, String(Math.round(x.units)), x.value]))}
<p class="muted">Total stock value at cost ${money(s.stockValue)} · at selling price ${money(s.retailValue)} · low ${s.low} · out of stock ${s.out} · expired ${money(s.expiredValue)} · expiring in 30 days ${money(s.expiringValue)}</p>` : ""}

<h2>Alerts &amp; insights</h2><ul>${insights.map((i) => `<li>${escapeHtml(i.text)}</li>`).join("") || "<li>Nothing unusual.</li>"}</ul>

<div class="notes"><b>How this is calculated</b><ul>${PROFIT_NOTES.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></div>
</div><script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`;
  const w = window.open("", "_blank", "width=920,height=1000");
  if (!w) { toast.error("Enable pop-ups to print the report"); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
