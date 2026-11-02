// Printable expense (debit) voucher — A5, one per expense.
import { escapeHtml } from "@/lib/invoice-print";
import { brandFor } from "@/lib/projects";

export type VoucherExpense = {
  voucher_no?: string | null;
  ref_no?: string | null;
  category: string;
  amount: number;
  method: string;
  paid_to: string | null;
  notes: string | null;
  expense_date: string;
  /** pcv / ss, or null = shared by both businesses. */
  project?: string | null;
};

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under100(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}
function under1000(n: number) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? under100(r) : ""].filter(Boolean).join(" ");
}

/** Taka in words, Bangladeshi grouping (crore / lakh / thousand). 1250.5 → "One Thousand Two Hundred Fifty Taka and Fifty Paisa Only". */
export function takaInWords(amount: number): string {
  const a = Math.abs(Math.round((Number(amount) || 0) * 100));
  let taka = Math.floor(a / 100);
  const paisa = a % 100;
  if (taka === 0 && paisa === 0) return "Zero Taka Only";
  const parts: string[] = [];
  const crore = Math.floor(taka / 10000000); taka %= 10000000;
  const lakh = Math.floor(taka / 100000); taka %= 100000;
  const thousand = Math.floor(taka / 1000); taka %= 1000;
  if (crore) parts.push(`${crore >= 100 ? under1000(crore) : under100(crore)} Crore`);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  if (taka) parts.push(under1000(taka));
  const t = parts.length ? `${parts.join(" ")} Taka` : "";
  const p = paisa ? `${under100(paisa)} Paisa` : "";
  return `${[t, p].filter(Boolean).join(" and ")} Only`;
}

const money = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const methodLabel = (m: string) => m.replace(/^\w/, (c) => c.toUpperCase());

export function printExpenseVoucher(e: VoucherExpense, targetWindow?: Window | null) {
  // Shared expenses print with the main (Pet Care Vet) header.
  const B = brandFor(e.project ?? "pcv");
  const business = e.project === "ss" ? "Sasthya Seba" : e.project === "pcv" ? "Pet Care Vet" : "Shared (both businesses)";
  const date = new Date(`${e.expense_date}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const row = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(e.voucher_no ?? "Expense voucher")}</title>
<style>
  @page { size: A5; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; font-size: 12px; }
  .head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; }
  .head h1 { margin: 0; font-size: 18px; }
  .head .sub { color: #555; font-size: 11px; margin-top: 2px; }
  .title { display: flex; justify-content: space-between; align-items: baseline; margin: 12px 0 8px; }
  .title h2 { margin: 0; font-size: 15px; letter-spacing: .5px; }
  .vno { font-family: ui-monospace, Menlo, monospace; font-size: 13px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 8px; border: 1px solid #ccc; vertical-align: top; }
  th { width: 34%; background: #f5f5f5; font-weight: 600; }
  .amount td { font-size: 16px; font-weight: 700; }
  .words { font-style: italic; }
  .sign { display: flex; justify-content: space-between; gap: 16px; margin-top: 48px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; text-align: center; font-size: 11px; }
  .foot { margin-top: 14px; color: #777; font-size: 10px; text-align: center; }
</style></head><body>
  <div class="head">
    <h1>${escapeHtml(B.name)}</h1>
    <div class="sub">${escapeHtml(B.address)}${B.phone ? ` · Tel: ${escapeHtml(B.phone)}` : ""}</div>
  </div>
  <div class="title"><h2>EXPENSE VOUCHER</h2><span class="vno">${escapeHtml(e.voucher_no ?? "—")}</span></div>
  <table>
    ${row("Date", escapeHtml(date))}
    ${row("Business", escapeHtml(business))}
    ${row("Expense head", escapeHtml(e.category))}
    ${row("Paid to", escapeHtml(e.paid_to || "—"))}
    ${row("Payment method", escapeHtml(methodLabel(e.method)))}
    ${e.ref_no ? row("Bill / receipt no", escapeHtml(e.ref_no)) : ""}
    ${e.notes ? row("Description", escapeHtml(e.notes)) : ""}
    <tr class="amount"><th>Amount</th><td>${money(e.amount)}</td></tr>
    ${row("In words", `<span class="words">${escapeHtml(takaInWords(e.amount))}</span>`)}
  </table>
  <div class="sign"><div>Prepared by</div><div>Received by</div><div>Approved by</div></div>
  <div class="foot">Printed ${escapeHtml(new Date().toLocaleString("en-GB"))}</div>
<script>window.onload=function(){setTimeout(function(){window.print();},200);}</script>
</body></html>`;
  const w = targetWindow ?? window.open("", "_blank", "width=700,height=900");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
