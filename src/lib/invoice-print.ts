// Shared invoice printing utilities used by POS, Sales History and the
// SalesHistory drawer. Keeps every printed sale invoice visually consistent.
import { toast } from "sonner";
import { getClinic, DEFAULT_CLINIC } from "@/lib/clinic-settings";

// Kept for legacy imports; live values come from getClinic() at print time.
export const CLINIC = DEFAULT_CLINIC;

export type InvoiceItem = {
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax: number;
  line_total: number;
};

export type InvoicePayment = { method: string; amount: number; reference?: string | null };

export type Receipt = {
  /** Database id of the sale — lets WhatsApp send through the Cloud API. */
  sale_id?: string;
  invoice_no: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paid: number;
  due: number;
  method: string; // primary/first method label for legacy callers
  issued_at: string;
  owner: { full_name: string; phone: string | null } | null;
  items: InvoiceItem[];
  payments?: InvoicePayment[];
  status?: string;
  notes?: string | null;
  /** Active delivery of this invoice (Delivery module). Shown on the invoice
   *  only — the delivery charge is NOT part of the sale's total/paid/due. */
  delivery?: { charge: number; man?: string | null } | null;
};

/** Delivery charge shown on the invoice (0 when there is no active delivery). */
const deliveryCharge = (r: Receipt) => Math.max(0, Number(r.delivery?.charge || 0));
/** What the customer still has to hand over: unpaid product due + delivery charge. */
const toCollect = (r: Receipt) => Number(r.due || 0) + deliveryCharge(r);

export function escapeHtml(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const money = (n: number) => `${getClinic().currency} ${Number(n || 0).toFixed(2)}`;

// Build a WhatsApp-friendly plain text invoice summary and open wa.me.
// Uses the same clinic branding + item/payment breakdown as the printed invoice.
export function shareInvoiceOnWhatsApp(r: Receipt, phoneOverride?: string) {
  const CLINIC = getClinic();
  const rawPhone = (phoneOverride ?? r.owner?.phone ?? "").replace(/[^\d]/g, "");
  // Assume Bangladesh if a leading 0 is given (01XXXXXXXXX -> 8801XXXXXXXXX)
  const phone = rawPhone.startsWith("0") ? `88${rawPhone}` : rawPhone;

  const dt = new Date(r.issued_at);
  const dateStr = `${dt.toLocaleDateString("en-GB")} ${dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

  const lines: string[] = [];
  lines.push(`*${CLINIC.name}*`);
  lines.push(CLINIC.tagline);
  lines.push(`${CLINIC.address}`);
  lines.push(`${CLINIC.phone}`);
  lines.push("");
  lines.push(`*Invoice:* ${r.invoice_no}`);
  lines.push(`*Date:* ${dateStr}`);
  if (r.owner?.full_name) lines.push(`*Customer:* ${r.owner.full_name}`);
  lines.push("");
  lines.push("*Items*");
  r.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.name} — ${it.quantity} × ${money(it.unit_price)} = ${money(it.line_total)}`);
  });
  lines.push("");
  lines.push(`Subtotal: ${money(r.subtotal)}`);
  if (r.discount) lines.push(`Discount: -${money(r.discount)}`);
  if (r.tax) lines.push(`Tax: ${money(r.tax)}`);
  if (deliveryCharge(r) > 0) {
    lines.push(`Product total: ${money(r.total)}`);
    lines.push(`Delivery charge: ${money(deliveryCharge(r))}`);
    lines.push(`*Total bill: ${money(r.total + deliveryCharge(r))}*`);
    lines.push(`Paid: ${money(r.paid)}`);
    if (toCollect(r) > 0) lines.push(`*To collect: ${money(toCollect(r))}*`);
  } else {
    lines.push(`*Total: ${money(r.total)}*`);
    lines.push(`Paid: ${money(r.paid)}`);
    if (r.due > 0) lines.push(`*Due: ${money(r.due)}*`);
  }
  lines.push("");
  lines.push(`Payment: ${paymentSummary(r)}`);
  if (r.notes) { lines.push(""); lines.push(`Note: ${r.notes}`); }
  lines.push("");
  lines.push(`Thank you for choosing ${CLINIC.name}.`);

  const text = encodeURIComponent(lines.join("\n"));
  const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) toast.error("Pop-up blocked. Please allow pop-ups to share on WhatsApp.");
}

function paymentSummary(r: Receipt): string {
  if (r.payments && r.payments.length) {
    return r.payments
      .map((p) => `${p.method}${p.reference ? ` (${p.reference})` : ""}: ${money(Number(p.amount))}`)
      .join(" · ");
  }
  return r.method || "—";
}

export function printInvoice(r: Receipt) {
  const CLINIC = getClinic();
  const issued = new Date(r.issued_at);
  const printedAt = new Date();
  const rows =
    r.items
      .map(
        (it, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td><strong>${escapeHtml(it.name)}</strong></td>
      <td class="right">${it.quantity}</td>
      <td class="right">${money(it.unit_price)}</td>
      <td class="right">${money(it.discount)}</td>
      <td class="right">${money(it.tax)}</td>
      <td class="right"><strong>${money(it.line_total)}</strong></td>
    </tr>`
      )
      .join("") || `<tr><td colspan="7" class="muted center">No items</td></tr>`;

  const paymentsBlock =
    r.payments && r.payments.length
      ? `<div class="paylist">
          <div class="paylist-title">Payments</div>
          ${r.payments
            .map(
              (p) =>
                `<div class="paylist-row"><span style="text-transform:capitalize">${escapeHtml(p.method)}${
                  p.reference ? ` <span class="muted">· ${escapeHtml(p.reference)}</span>` : ""
                }</span><span>${money(Number(p.amount))}</span></div>`
            )
            .join("")}
        </div>`
      : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.invoice_no)} — Invoice</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#111;font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  .sheet{max-width:780px;margin:0 auto;padding:32px 40px}
  header{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:flex-start;border-bottom:2px solid #0f766e;padding-bottom:14px}
  .brand h1{margin:0;font-size:22px;color:#0f766e;letter-spacing:.3px}
  .brand .tag{margin-top:2px;font-size:11px;color:#555;font-style:italic}
  .brand .addr{margin-top:8px;font-size:11px;color:#334155;line-height:1.55}
  .brand .lic{margin-top:4px;font-size:10.5px;color:#64748b}
  .doc-title{font-size:15px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.12em;text-align:right}
  .doc-meta{margin-top:8px;font-size:11px;color:#475569;text-align:right;line-height:1.6}
  .doc-meta .k{color:#94a3b8;margin-right:4px}
  .doc-meta .id{font-family:ui-monospace,monospace;background:#f1f5f9;padding:1px 6px;border-radius:4px;color:#0f172a}
  .status{display:inline-block;margin-top:6px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:#ecfdf5;color:#065f46}
  .status.due{background:#fef2f2;color:#991b1b}
  .status.ret{background:#fffbeb;color:#92400e}
  .info{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;margin:16px 0 18px;background:#f8fafc}
  .info .label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
  .info .value{font-size:13px;font-weight:600;color:#0f172a}
  table{width:100%;border-collapse:collapse;margin-top:4px;font-size:12.5px}
  thead th{text-align:left;background:#0f766e;color:#fff;padding:8px 10px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  thead th.right{text-align:right}
  tbody td{padding:9px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}
  tbody tr:nth-child(even) td{background:#f8fafc}
  td.num{width:32px;color:#64748b;font-family:ui-monospace,monospace}
  td.right{text-align:right;font-variant-numeric:tabular-nums}
  .muted{color:#64748b}.center{text-align:center}
  .totals{margin-top:14px;margin-left:auto;width:280px;font-size:12.5px}
  .totals .row{display:flex;justify-content:space-between;padding:5px 0}
  .totals .row.grand{border-top:2px solid #0f766e;margin-top:6px;padding-top:8px;font-size:14px;font-weight:700;color:#0f766e}
  .totals .row.due{color:#b91c1c;font-weight:600}
  .paylist{margin-top:14px;padding:10px 14px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;background:#fafafa}
  .paylist-title{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#475569;margin-bottom:4px}
  .paylist-row{display:flex;justify-content:space-between;padding:2px 0}
  .pay{margin-top:14px;padding:10px 14px;border-left:3px solid #0f766e;background:#f0fdfa;border-radius:4px;font-size:12px}
  footer{margin-top:38px;display:flex;justify-content:space-between;align-items:flex-end;font-size:11px;color:#64748b}
  .sig{text-align:center;min-width:200px}
  .sig .line{border-top:1px solid #111;margin-bottom:4px;height:34px}
  .sig .name{font-weight:600;color:#111;font-size:12px}
  .notes{margin-top:12px;font-size:11px;color:#475569;border-top:1px dashed #e5e7eb;padding-top:8px}
  .disclaimer{margin-top:24px;font-size:10px;color:#94a3b8;text-align:center;border-top:1px dashed #e5e7eb;padding-top:10px}
  @page{size:A4;margin:14mm}
  @media print{.no-print{display:none}}
</style></head><body>
<div class="sheet">
  <header>
    <div class="brand">
      <h1>${escapeHtml(CLINIC.name)}</h1>
      <div class="tag">${escapeHtml(CLINIC.tagline)}</div>
      <div class="addr">
        ${escapeHtml(CLINIC.address)}<br>
        Tel: ${escapeHtml(CLINIC.phone)} · ${escapeHtml(CLINIC.email)} · ${escapeHtml(CLINIC.website)}
      </div>
      <div class="lic">Clinic License: ${escapeHtml(CLINIC.license)}</div>
    </div>
    <div>
      <div class="doc-title">Tax Invoice</div>
      <div class="doc-meta">
        <div><span class="k">Invoice:</span> <span class="id">${escapeHtml(r.invoice_no)}</span></div>
        <div><span class="k">Issued:</span> ${escapeHtml(issued.toLocaleString())}</div>
        <div><span class="k">Printed:</span> ${escapeHtml(printedAt.toLocaleString())}</div>
        ${
          r.status
            ? `<div><span class="status ${r.due > 0 ? "due" : r.status.includes("return") || r.status.includes("refund") ? "ret" : ""}">${escapeHtml(
                r.status.replace(/_/g, " ")
              )}</span></div>`
            : ""
        }
      </div>
    </div>
  </header>

  <div class="info">
    <div><div class="label">Billed To</div><div class="value">${escapeHtml(r.owner?.full_name ?? "Walk-in Customer")}${
    r.owner?.phone ? ` <span class="muted">· ${escapeHtml(r.owner.phone)}</span>` : ""
  }</div></div>
    <div><div class="label">Payment</div><div class="value" style="text-transform:capitalize;font-size:11.5px">${escapeHtml(paymentSummary(r))}</div></div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Item</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Disc</th><th class="right">Tax</th><th class="right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span class="muted">Subtotal</span><span>${money(r.subtotal)}</span></div>
    <div class="row"><span class="muted">Tax</span><span>${money(r.tax)}</span></div>
    <div class="row"><span class="muted">Discount</span><span>− ${money(r.discount)}</span></div>
    ${deliveryCharge(r) > 0
      ? `<div class="row"><span>Product Total</span><span>${money(r.total)}</span></div>
    <div class="row"><span class="muted">Delivery Charge${r.delivery?.man ? ` (${escapeHtml(r.delivery.man)})` : ""}</span><span>${money(deliveryCharge(r))}</span></div>
    <div class="row grand"><span>Total Bill</span><span>${money(r.total + deliveryCharge(r))}</span></div>
    <div class="row"><span class="muted">Paid</span><span>${money(r.paid)}</span></div>
    ${toCollect(r) > 0 ? `<div class="row due"><span>To Collect</span><span>${money(toCollect(r))}</span></div>` : ""}`
      : `<div class="row grand"><span>Grand Total</span><span>${money(r.total)}</span></div>
    <div class="row"><span class="muted">Paid</span><span>${money(r.paid)}</span></div>
    ${r.due > 0 ? `<div class="row due"><span>Due</span><span>${money(r.due)}</span></div>` : ""}`}
  </div>

  ${paymentsBlock}

  <div class="pay">Thank you for choosing ${escapeHtml(CLINIC.name)}. Please retain this invoice for your records${
    r.due > 0 ? ` — outstanding balance of ${money(r.due)} is payable at your next visit.` : "."
  }</div>

  ${r.notes ? `<div class="notes"><strong>Note:</strong> ${escapeHtml(r.notes)}</div>` : ""}

  <footer>
    <div class="muted">This is a computer-generated invoice and does not require a physical signature.</div>
    <div class="sig">
      <div class="line"></div>
      <div class="name">Authorized Signatory</div>
    </div>
  </footer>

  <div class="disclaimer">${escapeHtml(CLINIC.name)} · ${escapeHtml(CLINIC.address)} · ${escapeHtml(CLINIC.phone)}</div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},200);}</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    toast.error("Enable pop-ups to print the invoice");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ---------- Thermal printer settings (persisted in localStorage) ----------
export type ThermalSettings = {
  paperWidth: 58 | 72 | 80;   // mm — physical roll width
  widthAdjust: number;        // mm — fine tune (−10..+10) if print is too wide/narrow
  sideMargin: number;         // mm — left/right padding inside the paper
  fontSize: number;           // base font size in px
  marginTop: number;          // mm
  marginBottom: number;       // mm
  reverseOrder: boolean;      // flip render order (for printers that spool bottom-to-top)
  topFeedLines: number;       // mm of blank space BEFORE content (tear-off gap at top)
  feedLines: number;          // blank lines after content (helps cutter)
  autoPrint: boolean;         // auto-open print dialog after render
  showTagline: boolean;
  showLicense: boolean;
  footerNote: string;
  boldness: "light" | "normal" | "bold" | "extra"; // print darkness / weight
  lineHeight: number; // unitless line-height multiplier (1.0 – 2.0)
};

const THERMAL_KEY = "thermal.settings.v6";
export const DEFAULT_THERMAL: ThermalSettings = {
  paperWidth: 80,
  widthAdjust: 0,
  sideMargin: 4,
  fontSize: 12,
  marginTop: 0,
  marginBottom: 4,
  reverseOrder: false,
  topFeedLines: 3,
  feedLines: 1,
  autoPrint: false,
  showTagline: true,
  showLicense: false,
  footerNote: "Get well soon 🐾",
  boldness: "bold",
  lineHeight: 1.35,
};


export function getThermalSettings(): ThermalSettings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(THERMAL_KEY) : null;
    if (!raw) return { ...DEFAULT_THERMAL };
    const saved = { ...DEFAULT_THERMAL, ...(JSON.parse(raw) as Partial<ThermalSettings>) };
    return {
      ...saved,
      marginTop: Math.max(0, Math.min(2, Number(saved.marginTop) || 0)),
      topFeedLines: Math.max(0, Math.min(6, Number(saved.topFeedLines) || 0)),
      feedLines: Math.max(0, Math.min(3, Number(saved.feedLines) || 0)),
    };
  } catch {
    return { ...DEFAULT_THERMAL };
  }
}

export function saveThermalSettings(s: ThermalSettings) {
  try {
    window.localStorage.setItem(THERMAL_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function printThermal(r: Receipt, override?: Partial<ThermalSettings>) {
  const CLINIC = getClinic();
  const s: ThermalSettings = { ...getThermalSettings(), ...(override ?? {}) };
  const issued = new Date(r.issued_at);
  // Printable width = roll width + user fine-tune. Content is padded inside it,
  // so text never gets clipped by the printer's unprintable edge.
  const pageWidth = Math.max(40, s.paperWidth + (Number(s.widthAdjust) || 0));
  const side = Math.max(0, Math.min(8, Number(s.sideMargin) || 0));

  const rows =
    r.items
      .map(
        (it) => `
    <div class="li">
      <div class="li-name">${escapeHtml(it.name)}</div>
      <div class="li-row"><span>${it.quantity} × ${it.unit_price.toFixed(2)}</span><span>${money(it.line_total)}</span></div>
    </div>`
      )
      .join("") || `<div class="center muted">No items</div>`;

  const payLines =
    r.payments && r.payments.length
      ? r.payments
          .map(
            (p) =>
              `<div class="tot"><span>Paid (${escapeHtml(p.method)})</span><span>${money(Number(p.amount))}</span></div>`
          )
          .join("")
      : `<div class="tot"><span>Paid (${escapeHtml(r.method)})</span><span>${money(r.paid)}</span></div>`;

  const headerBlock = `
  <div class="center hdr">
    <h1>${escapeHtml(CLINIC.name)}</h1>
    ${s.showTagline ? `<div class="tag">${escapeHtml(CLINIC.tagline)}</div>` : ""}
    <div class="addr">${escapeHtml(CLINIC.address)}<br>Tel: ${escapeHtml(CLINIC.phone)}</div>
    ${s.showLicense ? `<div class="addr">Lic: ${escapeHtml(CLINIC.license)}</div>` : ""}
  </div>
  <div class="sep"></div>
  <div class="kv"><span>Invoice</span><span>${escapeHtml(r.invoice_no)}</span></div>
  <div class="kv"><span>Date</span><span>${escapeHtml(issued.toLocaleString())}</span></div>
  <div class="kv"><span>Customer</span><span>${escapeHtml(r.owner?.full_name ?? "Walk-in")}</span></div>
  ${r.owner?.phone ? `<div class="kv"><span>Phone</span><span>${escapeHtml(r.owner.phone)}</span></div>` : ""}
  <div class="sep"></div>`;

  const itemsBlock = `${rows}
  <div class="sep"></div>
  <div class="tot"><span>Subtotal</span><span>${money(r.subtotal)}</span></div>
  <div class="tot"><span>Tax</span><span>${money(r.tax)}</span></div>
  <div class="tot"><span>Discount</span><span>− ${money(r.discount)}</span></div>
  ${deliveryCharge(r) > 0
    ? `<div class="tot"><span>Product total</span><span>${money(r.total)}</span></div>
  <div class="tot"><span>Delivery</span><span>${money(deliveryCharge(r))}</span></div>
  <div class="tot grand"><span>TOTAL BILL</span><span>${money(r.total + deliveryCharge(r))}</span></div>
  ${payLines}
  ${toCollect(r) > 0 ? `<div class="tot"><span>To collect</span><span>${money(toCollect(r))}</span></div>` : ""}`
    : `<div class="tot grand"><span>TOTAL</span><span>${money(r.total)}</span></div>
  ${payLines}
  ${r.due > 0 ? `<div class="tot"><span>Due</span><span>${money(r.due)}</span></div>` : ""}`}
  <div class="sep"></div>`;

  const footerBlock = `
  <div class="center thanks">Thank you!<br>${escapeHtml(CLINIC.name)}</div>
  ${s.footerNote ? `<div class="center muted" style="font-size:10px;margin-top:4px">${escapeHtml(s.footerNote)}</div>` : ""}
  <div class="feed" style="height:${Math.max(0, Math.min(3, s.feedLines)).toFixed(1)}mm"></div>`;

  const topFeedBlock = `<div class="feed" style="height:${Math.max(0, Number(s.topFeedLines) || 0).toFixed(1)}mm"></div>`;

  const body = topFeedBlock + (s.reverseOrder
    ? `${footerBlock}${itemsBlock}${headerBlock}`
    : `${headerBlock}${itemsBlock}${footerBlock}`);

  // Boldness → base font-weight + a subtle text-shadow that mimics a darker/heavier
  // strike on thermal printers (which often print thin strokes lightly).
  const boldMap = {
    light:  { weight: 400, shadow: "none" },
    normal: { weight: 500, shadow: "none" },
    bold:   { weight: 700, shadow: "0 0 0.3px #000" },
    extra:  { weight: 800, shadow: "0 0 0.5px #000" },
  } as const;
  const b = boldMap[s.boldness];
  const strongWeight = Math.min(900, Math.max(700, b.weight + 100));


  const lh = Math.max(1, Math.min(2.2, Number(s.lineHeight) || 1.35));
  // Derive tiny vertical padding from lineHeight so rows breathe without overlapping.
  const rowPad = ((lh - 1) * 3).toFixed(2); // 0 at lh=1, ~1.2px at lh=1.4, ~3.6px at lh=2.2

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.invoice_no)}</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;width:${pageWidth}mm;min-width:${pageWidth}mm;background:#fff;color:#000;font:${b.weight} ${s.fontSize}px/${lh} 'Courier New',ui-monospace,monospace;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-shadow:${b.shadow};-webkit-font-smoothing:antialiased}
  .r{width:${pageWidth}mm;max-width:${pageWidth}mm;margin:0;padding:${s.marginTop}mm ${side}mm ${s.marginBottom}mm;overflow-wrap:break-word}
  .center{text-align:center}.right{text-align:right}.muted{color:#000;opacity:.85}
  strong,b,.li-name,.grand,h1{font-weight:${strongWeight}}
  h1{margin:0;font-size:${s.fontSize + 2}px;letter-spacing:.5px;line-height:${(lh * 0.95).toFixed(2)}}
  .tag{font-size:${s.fontSize - 2}px;margin-top:1px;line-height:${lh}}
  .addr{font-size:${s.fontSize - 2}px;margin-top:2px;line-height:${lh}}
  .sep{border-top:1.2px dashed #000;margin:${(lh * 4).toFixed(2)}px 0}
  .kv{display:flex;justify-content:space-between;gap:4px;font-size:${s.fontSize - 1}px;padding:${rowPad}px 0;line-height:${lh}}
  .li{margin:${(lh * 2).toFixed(2)}px 0}
  .li-name{font-size:${s.fontSize - 0.5}px;line-height:${lh};overflow-wrap:anywhere}
  .li-row{display:flex;justify-content:space-between;gap:4px;font-size:${s.fontSize - 1}px;line-height:${lh}}
  .tot{display:flex;justify-content:space-between;gap:4px;font-size:${s.fontSize}px;padding:${rowPad}px 0;line-height:${lh}}
  .kv span:first-child,.tot span:first-child,.li-row span:first-child{min-width:0;overflow-wrap:anywhere}
  .kv span:last-child,.tot span:last-child,.li-row span:last-child{flex:0 0 auto;white-space:nowrap;text-align:right}
  .grand{font-size:${s.fontSize + 1}px;border-top:1.5px solid #000;border-bottom:1.5px double #000;padding:${(Number(rowPad) + 3).toFixed(2)}px 0;margin-top:3px}
  .thanks{margin-top:6px;font-size:${s.fontSize - 1}px;line-height:${lh}}
  .feed{width:100%}
  .bar{display:flex;gap:8px;justify-content:center;padding:8px;background:#f4f4f5;font-family:system-ui,sans-serif}
  .bar button{padding:6px 14px;font-size:13px;border:1px solid #999;border-radius:6px;background:#fff;cursor:pointer}
  @page{size:${pageWidth}mm 180mm;margin:0}
  @media print{
    .no-print{display:none !important}
    html,body{width:${pageWidth}mm;min-width:${pageWidth}mm;max-width:${pageWidth}mm;height:auto;overflow:visible;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .r{width:${pageWidth}mm;max-width:${pageWidth}mm;padding-bottom:0}
    .li,.tot,.kv,.sep,.hdr,.thanks{page-break-inside:avoid;break-inside:avoid}
    .feed{page-break-inside:avoid;break-inside:avoid}
    .r > *:last-child{margin-bottom:0;page-break-after:avoid;break-after:avoid}
  }

</style><style id="thermal-page-style"></style></head><body>
<div class="bar no-print">
  <button onclick="window.printThermalReceipt()">Print receipt</button>
  <button onclick="window.close()">Close</button>
</div>
<div class="r">${body}</div>
<script>
(function(){
  var printed = false;
  function fitThermalPage(){
    var receipt = document.querySelector('.r');
    var pageStyle = document.getElementById('thermal-page-style');
    if (!receipt || !pageStyle) return;
    var pxPerMm = 96 / 25.4;
    var heightMm = Math.ceil(receipt.getBoundingClientRect().height / pxPerMm) + 2;
    heightMm = Math.max(45, Math.min(1000, heightMm));
    pageStyle.textContent = '@page{size:${pageWidth}mm ' + heightMm + 'mm;margin:0}' +
      '@media print{html,body{width:${pageWidth}mm;min-width:${pageWidth}mm;max-width:${pageWidth}mm;height:' + heightMm + 'mm}.r{width:${pageWidth}mm;max-width:${pageWidth}mm}}';
  }
  window.printThermalReceipt = function(){
    if (printed) return;
    fitThermalPage();
    printed = true;
    window.print();
  };
  window.addEventListener('beforeprint', fitThermalPage);
  window.addEventListener('afterprint', function(){ printed = false; });
  window.addEventListener('load', function(){
    fitThermalPage();
    ${s.autoPrint ? "setTimeout(function(){ window.printThermalReceipt(); }, 250);" : ""}
  });
})();
</script>
</body></html>`;

  const w = window.open("", "_blank", `width=${Math.max(320, s.paperWidth * 6)},height=800`);
  if (!w) {
    toast.error("Enable pop-ups to print the receipt");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// Sample receipt used by the settings dialog "Test print" button.
export function testThermalReceipt(): Receipt {
  const now = new Date().toISOString();
  return {
    invoice_no: "TEST-0001",
    subtotal: 500,
    tax: 25,
    discount: 25,
    total: 500,
    paid: 500,
    due: 0,
    method: "cash",
    issued_at: now,
    owner: { full_name: "Test Customer", phone: "01700000000" },
    items: [
      { name: "Sample Product A", quantity: 2, unit_price: 150, discount: 0, tax: 0, line_total: 300 },
      { name: "Sample Product B", quantity: 1, unit_price: 200, discount: 25, tax: 25, line_total: 200 },
    ],
    payments: [{ method: "cash", amount: 500 }],
    status: "paid",
    notes: null,
  };
}
