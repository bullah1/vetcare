// Cash Close Report — immutable PDF snapshot generated once per closed shift,
// stored permanently in the "cash-close-reports" bucket and linked to the shift.
import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { getClinic } from "@/lib/clinic-settings";

const BUCKET = "cash-close-reports";

export type CloseSummary = {
  shift_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_balance: number;
  cash_sales: number;
  cash_due_collections: number;
  cash_refunds: number;
  supplier_payments: number;
  expenses: number;
  manual_in: number;
  manual_out: number;
  cancelled_in?: number;
  cancelled_out?: number;
  expected_cash: number;
  counted_cash: number | null;
  variance: number | null;
  closing_notes: string | null;
};

export type CloseSnapshot = {
  reportNo: string;
  shiftId: string;
  branch: string;
  branchAddress: string;
  branchPhone: string;
  cashier: string;
  openedAt: string;
  closedAt: string;
  openingCash: number;
  cashSales: number;
  dueCollections: number;
  manualIn: number;
  cancelledIn: number;
  cashIn: number;
  refunds: number;
  supplierPayments: number;
  expenses: number;
  manualOut: number;
  cancelledOut: number;
  cashOut: number;
  expectedCash: number;
  actualCash: number;
  difference: number;
  notes: string;
  generatedAt: string;
};

const n = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;
const tk = (v: number) => `${v < 0 ? "-" : ""}Tk ${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso));

export function buildSnapshot(s: CloseSummary, cashier: string): CloseSnapshot {
  const c = getClinic();
  const cashIn = n(s.cash_sales) + n(s.cash_due_collections) + n(s.manual_in) + n(s.cancelled_in);
  const cashOut = n(s.cash_refunds) + n(s.supplier_payments) + n(s.expenses) + n(s.manual_out) + n(s.cancelled_out);
  const closedAt = s.closed_at ?? new Date().toISOString();
  const expected = n(s.expected_cash);
  const actual = n(s.counted_cash);
  return {
    reportNo: `CC-${s.shift_id.slice(0, 8).toUpperCase()}`,
    shiftId: s.shift_id,
    branch: c.name, branchAddress: c.address, branchPhone: c.phone,
    cashier,
    openedAt: s.opened_at, closedAt,
    openingCash: n(s.opening_balance),
    cashSales: n(s.cash_sales), dueCollections: n(s.cash_due_collections),
    manualIn: n(s.manual_in), cancelledIn: n(s.cancelled_in), cashIn: n(cashIn),
    refunds: n(s.cash_refunds), supplierPayments: n(s.supplier_payments), expenses: n(s.expenses),
    manualOut: n(s.manual_out), cancelledOut: n(s.cancelled_out), cashOut: n(cashOut),
    expectedCash: expected, actualCash: actual,
    difference: s.variance != null ? n(s.variance) : n(actual - expected),
    notes: (s.closing_notes ?? "").trim(),
    generatedAt: new Date().toISOString(),
  };
}

export function renderPdf(x: CloseSnapshot): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, L = 18, R = W - 18;
  let y = 20;
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(x.branch, L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100);
  y += 5; doc.text(doc.splitTextToSize(`${x.branchAddress}  |  ${x.branchPhone}`, 120), L, y);
  doc.setTextColor(0); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("CASH CLOSE REPORT", R, 20, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(x.reportNo, R, 25, { align: "right" });
  y = 34; doc.setDrawColor(220); doc.line(L, y, R, y);

  const meta: [string, string][] = [
    ["Cash Close ID", x.shiftId], ["Branch", x.branch], ["Cashier", x.cashier || "-"],
    ["Shift Opened", dt(x.openedAt)], ["Close Date & Time", dt(x.closedAt)],
  ];
  y += 7; doc.setFontSize(9.5);
  for (const [k, v] of meta) {
    doc.setTextColor(110); doc.text(k, L, y); doc.setTextColor(0); doc.text(v, L + 45, y); y += 6;
  }

  const section = (title: string, rows: [string, number][], total?: [string, number]) => {
    y += 4; doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(title.toUpperCase(), L, y);
    y += 2; doc.line(L, y, R, y); y += 6; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    for (const [k, v] of rows) { doc.text(k, L + 2, y); doc.text(tk(v), R, y, { align: "right" }); y += 6; }
    if (total) {
      doc.setFont("helvetica", "bold"); doc.text(total[0], L + 2, y); doc.text(tk(total[1]), R, y, { align: "right" });
      doc.setFont("helvetica", "normal"); y += 6;
    }
  };
  section("Opening", [["Opening Cash", x.openingCash]]);
  section("Cash In", [["Cash Sales", x.cashSales], ["Due Collections (cash)", x.dueCollections], ["Manual Cash In", x.manualIn], ["Cancellation Adjustments In", x.cancelledIn]], ["Total Cash In", x.cashIn]);
  section("Cash Out", [["Refunds", x.refunds], ["Supplier Payments", x.supplierPayments], ["Expenses", x.expenses], ["Manual Cash Out", x.manualOut], ["Cancellation Adjustments Out", x.cancelledOut]], ["Total Cash Out", x.cashOut]);

  y += 4; doc.setFillColor(246, 246, 245); doc.roundedRect(L, y, R - L, 32, 2, 2, "F");
  const box = (label: string, v: number, bx: number) => {
    doc.setFontSize(8.5); doc.setTextColor(110); doc.text(label, bx, y + 10);
    doc.setFontSize(13); doc.setTextColor(0); doc.setFont("helvetica", "bold"); doc.text(tk(v), bx, y + 19); doc.setFont("helvetica", "normal");
  };
  const cw = (R - L) / 3;
  box("Expected Cash", x.expectedCash, L + 5); box("Actual Cash", x.actualCash, L + 5 + cw);
  const status = x.difference < 0 ? "SHORT" : x.difference > 0 ? "OVER" : "BALANCED";
  box(`Difference (${status})`, x.difference, L + 5 + cw * 2);
  y += 40;

  if (x.notes) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("CLOSING NOTES", L, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(x.notes.replace(/[^\x20-\x7E\n]/g, ""), R - L).slice(0, 18);
    doc.text(lines, L, y); y += lines.length * 4 + 6;
  }

  y = Math.max(y + 10, 250);
  doc.line(L, y, L + 60, y); doc.line(R - 60, y, R, y);
  doc.setFontSize(8.5); doc.setTextColor(110);
  doc.text("Cashier Signature", L, y + 5); doc.text("Manager Signature", R - 60, y + 5);
  doc.setFontSize(7.5);
  doc.text(`Final snapshot generated ${dt(x.generatedAt)} - this document is not affected by later edits.`, W / 2, 285, { align: "center" });
  return doc.output("blob");
}

export type CloseReportRow = {
  id: string; shift_id: string; report_no: string; file_path: string; cashier: string | null;
  opening_cash: number; expected_cash: number; actual_cash: number; difference: number; closed_at: string; created_at: string;
};

/** Generate + store the report exactly once per shift. Existing reports are never overwritten. */
export async function ensureCloseReport(s: CloseSummary): Promise<CloseReportRow | null> {
  const { data: existing } = await supabase.from("cash_close_reports").select("*").eq("shift_id", s.shift_id).maybeSingle();
  if (existing) return existing as CloseReportRow;

  const { data: u } = await supabase.auth.getUser();
  const snap = buildSnapshot(s, u.user?.email ?? "");
  const blob = renderPdf(snap);
  const path = `${s.closed_at?.slice(0, 7) ?? "unknown"}/${snap.reportNo}-${s.shift_id}.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "application/pdf", upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) throw up.error;

  const { data, error } = await supabase.from("cash_close_reports").insert({
    shift_id: s.shift_id, report_no: snap.reportNo, file_path: path, snapshot: snap as never,
    branch: snap.branch, cashier: snap.cashier, opening_cash: snap.openingCash, cash_sales: snap.cashSales,
    cash_in: snap.cashIn, cash_out: snap.cashOut, refunds: snap.refunds, expected_cash: snap.expectedCash,
    actual_cash: snap.actualCash, difference: snap.difference, closed_at: snap.closedAt,
  }).select("*").single();
  if (error) {
    if (error.code === "23505") {
      const { data: again } = await supabase.from("cash_close_reports").select("*").eq("shift_id", s.shift_id).maybeSingle();
      return (again as CloseReportRow) ?? null;
    }
    throw error;
  }
  return data as CloseReportRow;
}

export async function reportBlob(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  return data;
}

export async function reportSignedUrl(path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
