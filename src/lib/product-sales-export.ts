// Excel / CSV / print for the Product Sales report.
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { getClinic } from "@/lib/clinic-settings";
import { escapeHtml } from "@/lib/invoice-print";
import { METHOD_LABEL, type computeProductSales } from "@/lib/product-sales";

type View = ReturnType<typeof computeProductSales>;
const r = (v: number) => Math.round(v * 100) / 100;
const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export type SheetKey = "lines" | "products" | "daily" | "monthly" | "invoices" | "employees" | "collection";
export const SHEET_TITLES: Record<SheetKey, string> = {
  lines: "Sales lines",
  products: "Products",
  daily: "Daily",
  monthly: "Monthly",
  invoices: "Invoices",
  employees: "Employees",
  collection: "Collection",
};

export function sheetRows(v: View, key: SheetKey): Record<string, string | number>[] {
  switch (key) {
    case "lines":
      return v.lines.map((l) => ({
        Date: dt(l.date), Invoice: l.invoiceNo, Product: l.product, SKU: l.sku, Category: l.category, Qty: l.qty, Returned: l.returnedQty,
        "Unit price": r(l.unitPrice), "Default price": l.listPrice ?? "", "Price changed": l.priceChanged ? "Yes" : "",
        "Line discount": r(l.lineDiscount), "Invoice discount": r(l.invoiceDiscount), "Net sales": r(l.netAfterReturn), Cost: r(l.cost), Profit: r(l.profit),
        Customer: l.customer, Phone: l.customerPhone, Employee: l.employee, Payment: l.methods.map((m) => METHOD_LABEL[m] ?? m).join(", "), Status: l.status,
      }));
    case "products":
      return [...v.products].sort((a, b) => b.net - a.net).map((p) => ({
        Product: p.product, SKU: p.sku, Category: p.category, Invoices: p.invoiceCount, "Qty sold": r(p.qty), Returned: r(p.returnedQty), "Net qty": r(p.soldQty),
        "Avg price": r(p.avgPrice), Discount: r(p.discount), "Net sales": r(p.net), Cost: r(p.cost), Profit: r(p.profit), "Margin %": r(p.margin),
        "Price changes": p.changed, "Last sold": dt(p.last),
      }));
    case "daily":
    case "monthly":
      return v[key].map((d) => ({ [key === "daily" ? "Date" : "Month"]: d.key, Invoices: d.invoiceCount, Qty: r(d.qty), Discount: r(d.discount), Returns: r(d.returned), "Net sales": r(d.net), Cost: r(d.cost), Profit: r(d.profit) }));
    case "invoices":
      return v.invoices.map((i) => ({
        Date: dt(i.date), Invoice: i.invoiceNo, Customer: i.customer, Phone: i.phone, Employee: i.employee, Items: i.items, Qty: r(i.qty),
        Discount: r(i.discount), Total: r(i.total), Paid: r(i.paid), Due: r(i.due), Returns: r(i.returned), Profit: r(i.profit), Payment: i.methods, Status: i.status,
        "Price changed": i.priceChanged ? "Yes" : "",
      }));
    case "employees":
      return v.employees.map((e) => ({ Employee: e.employee, Invoices: e.invoiceCount, Qty: r(e.qty), Discount: r(e.discount), "Net sales": r(e.net), Profit: r(e.profit), Paid: r(e.paid), Due: r(e.due) }));
    case "collection":
      return v.collections.map((c) => ({
        "Received on": dt(c.date), Method: METHOD_LABEL[c.method] ?? c.method, Amount: r(c.amount), Invoice: c.invoiceNo, "Invoice date": dt(c.invoiceDate),
        Product: c.product, SKU: c.sku, Customer: c.customer, Employee: c.employee,
      }));
  }
}

const book = (sheets: { name: string; rows: Record<string, unknown>[] }[]) => {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const rows = s.rows.length ? s.rows : [{ Note: "No data" }];
    const ws = XLSX.utils.json_to_sheet(rows);
    const head = Object.keys(rows[0]);
    ws["!cols"] = head.map((h) => ({ wch: Math.min(40, Math.max(h.length + 2, ...rows.map((x) => String((x as any)[h] ?? "").length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return wb;
};

export function exportExcel(v: View, keys: SheetKey[], from: string, to: string) {
  const wb = book(keys.map((k) => ({ name: SHEET_TITLES[k], rows: sheetRows(v, k) })));
  XLSX.writeFile(wb, `product-sales_${keys.length === 1 ? keys[0] + "_" : ""}${from}_to_${to}.xlsx`);
}

export function exportCsv(v: View, key: SheetKey, from: string, to: string) {
  const rows = sheetRows(v, key);
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No data" }]);
  const csv = "﻿" + XLSX.utils.sheet_to_csv(ws);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `product-sales_${key}_${from}_to_${to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function printSheet(v: View, key: SheetKey, from: string, to: string, filterNote: string) {
  const c = getClinic();
  const rows = sheetRows(v, key);
  const head = rows.length ? Object.keys(rows[0]) : [];
  const isNum = (h: string) => rows.some((x) => typeof x[h] === "number");
  const t = v.totals;
  const m = (x: number) => `${c.currency} ${r(x).toLocaleString("en-BD")}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(SHEET_TITLES[key])} ${from} – ${to}</title>
<style>
*{box-sizing:border-box}body{margin:0;font:10.5px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111}
.sheet{padding:10mm}header{display:flex;justify-content:space-between;border-bottom:2px solid #f55504;padding-bottom:6px;margin-bottom:8px}
h1{margin:0;font-size:16px}.muted{color:#64748b}
.k{display:flex;flex-wrap:wrap;gap:6px 18px;margin:6px 0 10px;font-size:11px}.k b{font-size:12px}
table{width:100%;border-collapse:collapse}th{background:#f8fafc;text-align:left;font-size:9.5px;padding:4px;border-bottom:1px solid #ddd}
td{padding:3px 4px;border-bottom:1px solid #eee;vertical-align:top}.r{text-align:right;font-variant-numeric:tabular-nums}tr{break-inside:avoid}
@page{size:A4 landscape;margin:8mm}
</style></head><body><div class="sheet">
<header><div><h1>${escapeHtml(c.name)} — Product Sales: ${escapeHtml(SHEET_TITLES[key])}</h1><div class="muted">${escapeHtml(filterNote)}</div></div>
<div class="muted" style="text-align:right">${from} to ${to}<br>Printed ${escapeHtml(new Date().toLocaleString("en-GB"))}</div></header>
<div class="k"><span>Invoices <b>${t.invoices}</b></span><span>Qty <b>${r(t.qty - t.returnedQty)}</b></span><span>Net sales <b>${m(t.net)}</b></span><span>Cost <b>${m(t.cost)}</b></span><span>Profit <b>${m(t.profit)}</b></span><span>Discount <b>${m(t.discount)}</b></span><span>Returns <b>${m(t.returned)}</b></span><span>Received <b>${m(t.collected)}</b></span><span>Due <b>${m(t.due)}</b></span></div>
<table><thead><tr>${head.map((h) => `<th class="${isNum(h) ? "r" : ""}">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>
${rows.map((x) => `<tr>${head.map((h) => `<td class="${typeof x[h] === "number" ? "r" : ""}">${escapeHtml(typeof x[h] === "number" ? (x[h] as number).toLocaleString("en-BD") : x[h])}</td>`).join("")}</tr>`).join("") || `<tr><td class="muted">No data</td></tr>`}
</tbody></table></div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  const w = window.open("", "_blank", "width=1200,height=900");
  if (!w) { toast.error("Pop-up blocked. Please allow pop-ups to print."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
