// Cash Close (v2): Sales / Collection / Account summary per business, frozen at close.
// Data comes from the SQL functions cash_close_summary (live) and close_cash_shift_v2
// (frozen copy in cash_shifts.close_summary). Print = 80mm thermal; PDF = A4, stored once.
import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { getClinic } from "@/lib/clinic-settings";
import { getThermalSettings } from "@/lib/invoice-print";

export type BizKey = "pcv" | "ss" | "all";
export const BIZ: { key: BizKey; label: string }[] = [
  { key: "pcv", label: "Pet Care Vet" },
  { key: "ss", label: "Sasthya Seba" },
  { key: "all", label: "Combined" },
];
export const METHODS = ["cash", "bkash", "nagad", "rocket", "bank", "card"] as const;
export const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", bkash: "bKash", nagad: "Nagad", rocket: "Rocket", bank: "Bank", card: "Card",
};

export type SalesPart = {
  bills: number; total_sales: number; discount: number; returns: number; cancelled_old_bills: number;
  refund: number; net_sales: number; new_due: number; cancelled_bills: number; cancelled_bills_amount: number;
};
export type MethodCollection = {
  method: string; bill_collection: number; prev_due_collection: number; collection: number; refund_paid: number; net: number;
};
export type CollectionPart = {
  methods: MethodCollection[]; bill_collection: number; prev_due_collection: number; total_collection: number;
  refund_paid: number; net_collection: number;
  /** Store credit (product exchange). Not money, so not part of collection. */
  credit_used?: number; credit_issued?: number;
};

/** Store credit kept on customer accounts in this close (+) or spent from earlier credit (−). */
export const creditNet = (c: CollectionPart) => num(num(c.credit_issued) - num(c.credit_used));
export type AccountRow = {
  method: string; opening: number; collection: number; refunds: number; expenses: number; supplier_payments: number;
  manual_in: number; manual_out: number; expected: number; counted?: number; variance?: number; settled?: number;
  /** cash only: spending not yet entered as an expense (shown, not booked) */
  pending_expense?: number; variance_after_pending?: number;
};
export type CloseV2 = {
  version: 2;
  shift_id: string; status: string; opened_at: string; closed_at: string | null; opening_balance: number;
  business: Record<BizKey, { sales: SalesPart; collection: CollectionPart }>;
  accounts: AccountRow[];
  expenses: { total: number; cash: number; supplier_payments: number };
  totals?: { expected: number; counted: number; variance: number; settled: number };
  notes?: string | null;
  pending_expense?: number;
  generated_at: string;
};

export const num = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;
export const accIn = (a: AccountRow) => num(a.collection) + num(a.manual_in);
export const accOut = (a: AccountRow) => num(a.refunds) + num(a.expenses) + num(a.supplier_payments) + num(a.manual_out);

export async function loadCloseSummary(shiftId: string): Promise<CloseV2> {
  const { data, error } = await (supabase.rpc as any)("cash_close_summary", { _shift_id: shiftId });
  if (error) throw error;
  return data as CloseV2;
}

/** Frozen summary for a closed shift (null for shifts closed before v2). */
export async function loadFrozenSummary(shiftId: string): Promise<CloseV2 | null> {
  const { data, error } = await (supabase.from("cash_shifts") as any).select("close_summary").eq("id", shiftId).maybeSingle();
  if (error) throw error;
  return (data?.close_summary as CloseV2) ?? null;
}

const dt = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso))
    : "-";
const tkPdf = (v: number) => `${v < 0 ? "-" : ""}${Math.abs(num(v)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tkPrint = (v: number) => {
  const r = Math.round(num(v));
  const s = `৳${Math.abs(r).toLocaleString("en-BD")}`;
  return r < 0 ? `−${s}` : s;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function reportNo(s: CloseV2) {
  return `CC-${s.shift_id.slice(0, 8).toUpperCase()}`;
}

// ---------- A4 PDF ----------
export function renderCloseV2Pdf(s: CloseV2, cashier: string): Blob {
  const c = getClinic();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, L = 14, R = W - 14;
  let y = 16;
  const ensure = (h: number) => { if (y + h > 282) { doc.addPage(); y = 16; } };

  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(c.name || "Pet Care Vet", L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(100);
  doc.text(doc.splitTextToSize(`${c.address ?? ""}  |  ${c.phone ?? ""}`.replace(/[^\x20-\x7E]/g, ""), 120), L, y + 5);
  doc.setTextColor(0); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("CASH CLOSE REPORT", R, y, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(reportNo(s), R, y + 5, { align: "right" });
  y += 12; doc.setDrawColor(210); doc.line(L, y, R, y); y += 5;
  doc.setFontSize(8.5);
  const meta: [string, string][] = [
    ["Opened", dt(s.opened_at)], ["Closed", dt(s.closed_at)], ["Closed by", cashier || "-"], ["Amounts in", "Taka (BDT)"],
  ];
  meta.forEach(([k, v], i) => {
    const x = L + (i % 2) * 95; if (i % 2 === 0 && i) y += 5;
    doc.setTextColor(110); doc.text(k, x, y); doc.setTextColor(0); doc.text(v, x + 22, y);
  });
  y += 8;

  const cols = [L + 70, L + 105, L + 140, R];
  const header = (title: string, heads = ["Pet Care Vet", "Sasthya Seba", "Combined"]) => {
    ensure(14);
    doc.setFillColor(243, 243, 241); doc.rect(L, y - 4, R - L, 6.5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.text(title, L + 1, y);
    doc.setFontSize(8); heads.forEach((h, i) => doc.text(h, cols[i + 1] ?? R, y, { align: "right" }));
    doc.setFont("helvetica", "normal"); y += 6;
  };
  const row3 = (label: string, vals: number[], bold = false, count = false) => {
    ensure(6);
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(8.5);
    doc.text(label, L + 2, y);
    vals.forEach((v, i) => doc.text(count ? String(Math.round(v)) : tkPdf(v), cols[i + 1] ?? R, y, { align: "right" }));
    if (bold) { doc.setDrawColor(225); doc.line(L, y + 1.5, R, y + 1.5); }
    y += 5.2;
  };
  const B = (k: BizKey) => s.business[k];
  const three = (f: (k: BizKey) => number) => (["pcv", "ss", "all"] as BizKey[]).map(f);

  header("PART A - SALES SUMMARY");
  row3("Bills", three((k) => B(k).sales.bills), false, true);
  row3("Total Sales", three((k) => B(k).sales.total_sales));
  row3("Total Discount", three((k) => B(k).sales.discount));
  row3("Total Refund", three((k) => B(k).sales.refund));
  row3("Net Sales", three((k) => B(k).sales.net_sales), true);
  if (B("all").sales.cancelled_bills) row3(`Cancelled bills (not counted)`, three((k) => B(k).sales.cancelled_bills_amount));
  y += 3;

  header("PART B - COLLECTION SUMMARY");
  for (const m of METHODS) {
    const v = three((k) => num(B(k).collection.methods.find((x) => x.method === m)?.collection));
    if (v.every((x) => x === 0)) continue;
    row3(`${METHOD_LABEL[m]} Collection`, v);
  }
  row3("Total Collection", three((k) => B(k).collection.total_collection), true);
  row3("Refund paid (older bills)", three((k) => B(k).collection.refund_paid));
  if (three((k) => creditNet(B(k).collection)).some((x) => x !== 0)) {
    row3("Store credit kept (+) / used (-)", three((k) => creditNet(B(k).collection)));
  }
  y += 3;

  header("DUE");
  row3("New Due (this close)", three((k) => B(k).sales.new_due));
  row3("Previous Due Collection", three((k) => B(k).collection.prev_due_collection));
  y += 3;

  // Part C
  const ch = ["Opening", "In", "Out", "Expected", "Counted", "Variance"];
  const ccols = [L + 46, L + 70, L + 94, L + 120, L + 146, R];
  ensure(20);
  doc.setFillColor(243, 243, 241); doc.rect(L, y - 4, R - L, 6.5, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.text("PART C - ACCOUNT CLOSING", L + 1, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text("all businesses together", R, y, { align: "right" });
  y += 6; doc.setFont("helvetica", "bold"); doc.text("Account", L + 2, y);
  ch.forEach((h, i) => doc.text(h, ccols[i], y, { align: "right" }));
  doc.setDrawColor(225); doc.line(L, y + 1.5, R, y + 1.5);
  doc.setFont("helvetica", "normal"); y += 6;
  for (const a of s.accounts) {
    ensure(6); doc.setFontSize(8.5);
    doc.text(METHOD_LABEL[a.method] ?? a.method, L + 2, y);
    [a.opening, accIn(a), accOut(a), a.expected, a.counted ?? a.expected, a.variance ?? 0].forEach((v, i) =>
      doc.text(tkPdf(num(v)), ccols[i], y, { align: "right" }));
    y += 5.2;
  }
  if (s.totals) {
    doc.setFont("helvetica", "bold");
    doc.text("Total", L + 2, y);
    doc.text(tkPdf(s.totals.expected), ccols[3], y, { align: "right" });
    doc.text(tkPdf(s.totals.counted), ccols[4], y, { align: "right" });
    doc.text(tkPdf(s.totals.variance), ccols[5], y, { align: "right" });
    doc.setFont("helvetica", "normal"); y += 6;
  }
  ensure(16); doc.setFontSize(8.5);
  const extra: [string, number][] = [
    ["Cash expenses", s.expenses.cash],
    ["All expenses (combined)", s.expenses.total],
    ["Supplier payments", s.expenses.supplier_payments],
    ["Digital account settlement", s.totals?.settled ?? 0],
  ];
  const pend = num(s.pending_expense);
  if (pend) {
    const cashRow = s.accounts.find((a) => a.method === "cash");
    extra.push(["Expense not yet entered (info only)", pend]);
    extra.push(["Cash variance after that expense", num(cashRow?.variance_after_pending ?? 0)]);
  }
  for (const [k, v] of extra) { doc.text(k, L + 2, y); doc.text(tkPdf(v), R, y, { align: "right" }); y += 5; }

  if (s.notes) {
    y += 2; ensure(12);
    doc.setFont("helvetica", "bold"); doc.text("Closing notes", L, y); y += 4.5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    const lines = doc.splitTextToSize(s.notes.replace(/[^\x20-\x7E\n]/g, ""), R - L).slice(0, 12);
    doc.text(lines, L, y); y += lines.length * 3.8;
  }
  y = Math.max(y + 16, 262); if (y > 280) { doc.addPage(); y = 40; }
  doc.setDrawColor(150); doc.line(L, y, L + 55, y); doc.line(R - 55, y, R, y);
  doc.setFontSize(8); doc.setTextColor(110);
  doc.text("Cashier", L, y + 4); doc.text("Manager", R - 55, y + 4);
  doc.setFontSize(7);
  doc.text(`Frozen at close ${dt(s.closed_at)} - later edits do not change this report.`, W / 2, 290, { align: "center" });
  return doc.output("blob");
}

/** Store the A4 PDF + snapshot once per shift (never overwritten). */
export async function ensureCloseReportV2(s: CloseV2): Promise<void> {
  const { data: existing } = await supabase.from("cash_close_reports").select("id").eq("shift_id", s.shift_id).maybeSingle();
  if (existing) return;
  const { data: u } = await supabase.auth.getUser();
  const cashier = u.user?.email ?? "";
  const blob = renderCloseV2Pdf(s, cashier);
  const no = reportNo(s);
  const path = `${(s.closed_at ?? new Date().toISOString()).slice(0, 7)}/${no}-${s.shift_id}.pdf`;
  const up = await supabase.storage.from("cash-close-reports").upload(path, blob, { contentType: "application/pdf", upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) throw up.error;
  const cash = s.accounts.find((a) => a.method === "cash")!;
  const c = getClinic();
  const { error } = await supabase.from("cash_close_reports").insert({
    shift_id: s.shift_id, report_no: no, file_path: path,
    snapshot: { ...s, reportNo: no, branch: c.name, cashier } as never,
    branch: c.name, cashier, opening_cash: num(cash.opening), cash_sales: num(cash.collection),
    cash_in: accIn(cash), cash_out: accOut(cash), refunds: num(cash.refunds),
    expected_cash: num(cash.expected), actual_cash: num(cash.counted ?? cash.expected),
    difference: num(cash.variance ?? 0), closed_at: s.closed_at ?? new Date().toISOString(),
  });
  if (error && error.code !== "23505") throw error;
}

// ---------- 80mm thermal print ----------
export function printCloseV2(s: CloseV2, targetWindow?: Window | null) {
  const c = getClinic();
  const paper = getThermalSettings().paperWidth || 80;
  const row = (k: string, v: string, cls = "") => `<div class="r ${cls}"><span>${esc(k)}</span><b>${v}</b></div>`;
  const bizBlock = (k: BizKey, label: string) => {
    const b = s.business[k];
    const methods = b.collection.methods.filter((m) => num(m.collection) !== 0)
      .map((m) => row(`  ${METHOD_LABEL[m.method] ?? m.method}`, tkPrint(m.collection))).join("");
    return `
    <div class="sec"><div class="t">${esc(label)}</div>
      <div class="st">A · Sales</div>
      ${row("Bills", String(b.sales.bills))}
      ${row("Total Sales", tkPrint(b.sales.total_sales))}
      ${row("Discount", tkPrint(-b.sales.discount), "neg")}
      ${row("Refund", tkPrint(-b.sales.refund), "neg")}
      ${row("Net Sales", tkPrint(b.sales.net_sales), "big")}
      <div class="st">B · Collection</div>
      ${methods || row("  —", tkPrint(0))}
      ${row("Total Collection", tkPrint(b.collection.total_collection), "big")}
      ${num(b.collection.refund_paid) ? row("Refund paid (old bills)", tkPrint(-b.collection.refund_paid), "neg") : ""}
      ${creditNet(b.collection) ? row(creditNet(b.collection) > 0 ? "Store credit kept" : "Store credit used", tkPrint(Math.abs(creditNet(b.collection)))) : ""}
      <div class="st">Due</div>
      ${row("New Due", tkPrint(b.sales.new_due))}
      ${row("Prev. Due Collection", tkPrint(b.collection.prev_due_collection))}
    </div>`;
  };
  const acc = s.accounts.filter((a) => a.method === "cash" || num(a.expected) || num(a.counted) || num(a.collection) || num(a.opening))
    .map((a) => `<tr><td>${esc(METHOD_LABEL[a.method] ?? a.method)}</td><td>${tkPrint(a.expected)}</td><td>${tkPrint(a.counted ?? a.expected)}</td><td>${tkPrint(a.variance ?? 0)}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${reportNo(s)}</title><style>
  @page{size:${paper}mm auto;margin:0} body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000}
  .w{width:${paper - 6}mm;padding:2mm 3mm;font-size:11px}
  .h{text-align:center} .h b{font-size:14px} .muted{color:#333;font-size:10px}
  .dash{border-top:1px dashed #000;margin:5px 0}
  .t{font-weight:700;font-size:12px;border-bottom:1px solid #000;margin:4px 0 2px}
  .st{font-weight:700;font-size:10px;margin-top:4px;text-transform:uppercase}
  .r{display:flex;justify-content:space-between;line-height:1.45}
  .r.big b{font-size:12px} .r.big{border-top:1px solid #000;margin-top:1px}
  table{width:100%;border-collapse:collapse;font-size:10px} td,th{text-align:right;padding:1px 0} td:first-child,th:first-child{text-align:left}
  th{border-bottom:1px solid #000}
  .sign{display:flex;justify-content:space-between;margin-top:22px;font-size:10px}
  .sign div{border-top:1px solid #000;width:42%;text-align:center;padding-top:2px}
  </style></head><body><div class="w">
  <div class="h"><b>${esc(c.name || "Pet Care Vet")}</b><br/><span class="muted">Cash Close Report · ${reportNo(s)}</span><br/>
  <span class="muted">Open ${dt(s.opened_at)}<br/>Close ${dt(s.closed_at)}</span></div>
  <div class="dash"></div>
  ${bizBlock("all", "COMBINED")}
  <div class="dash"></div>
  ${bizBlock("pcv", "PET CARE VET")}
  <div class="dash"></div>
  ${bizBlock("ss", "SASTHYA SEBA")}
  <div class="dash"></div>
  <div class="sec"><div class="t">C · ACCOUNT CLOSING</div>
    ${row("Opening (cash)", tkPrint(s.accounts.find((a) => a.method === "cash")?.opening ?? 0))}
    <table><tr><th>Account</th><th>Expected</th><th>Counted</th><th>Var.</th></tr>${acc}</table>
    ${s.totals ? row("Total variance", tkPrint(s.totals.variance), "big") : ""}
    ${row("Cash expenses", tkPrint(s.expenses.cash))}
    ${row("All expenses", tkPrint(s.expenses.total))}
    ${num(s.expenses.supplier_payments) ? row("Supplier payments", tkPrint(s.expenses.supplier_payments)) : ""}
    ${row("Digital settlement", tkPrint(s.totals?.settled ?? 0))}
    ${num(s.pending_expense) ? row("Expense not entered (info)", tkPrint(s.pending_expense!)) : ""}
    ${num(s.pending_expense) ? row("Cash var. after it", tkPrint(s.accounts.find((a) => a.method === "cash")?.variance_after_pending ?? 0), "big") : ""}
  </div>
  ${s.notes ? `<div class="dash"></div><div class="muted">${esc(s.notes)}</div>` : ""}
  <div class="sign"><div>Cashier</div><div>Manager</div></div>
  </div></body></html>`;
  const w = targetWindow ?? window.open("", "_blank", `width=${Math.max(420, paper * 6)},height=900`);
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 400);
  return true;
}
