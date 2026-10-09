// Delivery invoices — a separate invoice for parcels that leave the shop:
//  - Local delivery (our own rider): rider name/phone, customer address,
//    products, delivery charge and the amount the rider must collect.
//  - Courier (Steadfast): consignment ID, tracking code + link, delivery
//    charge, 1% COD charge and the COD amount the courier collects.
// Printing / sharing only — nothing here writes to the sale, payments, stock
// or accounts.
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getClinic } from "@/lib/clinic-settings";
import { escapeHtml } from "@/lib/invoice-print";

export type DeliveryInvoiceItem = { name: string; quantity: number; unit_price: number; line_total: number };

export type DeliveryInvoice = {
  kind: "local" | "courier";
  invoice_no: string;
  issued_at: string;
  customer: { name: string; phone: string | null; address: string | null };
  items: DeliveryInvoiceItem[];
  /** Product bill after discount (the sale total). */
  product_total: number;
  /** Already paid at the shop. */
  paid: number;
  delivery_charge: number;
  /** Who pays the delivery charge. "shop" = free delivery for the customer. */
  charge_paid_by?: "customer" | "shop";
  /** Courier only: COD charge (e.g. 1% of the COD amount). */
  cod_charge?: number;
  cod_charge_percent?: number;
  /** Amount the rider / courier collects from the customer. */
  to_collect: number;
  status?: string | null;
  note?: string | null;
  rider?: { name: string; phone: string | null } | null;
  courier?: {
    name: string;
    consignment_id: string | null;
    tracking_code: string | null;
    tracking_url: string | null;
  } | null;
};

const money = (n: number) => `${getClinic().currency} ${Number(n || 0).toFixed(2)}`;
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const COD_CHARGE_PERCENT = 1;

/**
 * Steadfast COD maths. The COD charge is a percentage of the amount the
 * courier collects, so it is worked out on (product due + delivery charge)
 * and rounded up to a whole taka.
 */
export function courierCod(input: { productDue: number; deliveryCharge: number; paidBy: "customer" | "shop"; percent?: number }) {
  const pct = Math.max(0, Number(input.percent ?? COD_CHARGE_PERCENT) || 0);
  const due = Math.max(0, Number(input.productDue) || 0);
  const charge = Math.max(0, Number(input.deliveryCharge) || 0);
  const base = input.paidBy === "customer" ? due + charge : due;
  const codCharge = base > 0 && pct > 0 ? Math.ceil((base * pct) / 100) : 0;
  const cod = input.paidBy === "customer" ? base + codCharge : base;
  return { percent: pct, codCharge, cod: round2(cod) };
}

export function steadfastTrackingUrl(trackingCode: string | null | undefined) {
  const t = String(trackingCode ?? "").trim();
  return t ? `https://steadfast.com.bd/t/${encodeURIComponent(t)}` : null;
}

/** Load the products + payment state of a sale for a delivery invoice. */
export async function loadSaleForDeliveryInvoice(saleId: string) {
  const { data, error } = await supabase
    .from("sales")
    .select("id,invoice_no,total,paid,due,created_at,status, owner:pet_owners(full_name,phone,address), sale_items(name,quantity,returned_quantity,unit_price,line_total)")
    .eq("id", saleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Invoice not found");
  const s: any = data;
  const items: DeliveryInvoiceItem[] = (s.sale_items ?? [])
    .map((it: any) => {
      const qty = Number(it.quantity) - Number(it.returned_quantity || 0);
      const unit = Number(it.unit_price) || 0;
      const lineAll = Number(it.line_total) || unit * Number(it.quantity);
      const line = Number(it.quantity) > 0 ? (lineAll * qty) / Number(it.quantity) : 0;
      return { name: String(it.name ?? "").trim(), quantity: qty, unit_price: unit, line_total: round2(line) };
    })
    .filter((it: DeliveryInvoiceItem) => it.quantity > 0);
  return {
    invoice_no: String(s.invoice_no),
    issued_at: String(s.created_at),
    total: Number(s.total) || 0,
    paid: Number(s.paid) || 0,
    due: Number(s.due) || 0,
    owner: s.owner as { full_name: string; phone: string | null; address: string | null } | null,
    items,
  };
}

/** Invoice for a local delivery (our own rider) from a `deliveries` row. */
export async function buildLocalDeliveryInvoice(d: {
  sale_id: string;
  delivery_man_name: string;
  delivery_man_phone: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  delivery_charge: number;
  status: string;
  note: string | null;
}): Promise<DeliveryInvoice> {
  const sale = await loadSaleForDeliveryInvoice(d.sale_id);
  const charge = Math.max(0, Number(d.delivery_charge) || 0);
  return {
    kind: "local",
    invoice_no: sale.invoice_no,
    issued_at: sale.issued_at,
    customer: {
      name: d.customer_name || sale.owner?.full_name || "Customer",
      phone: d.customer_phone || sale.owner?.phone || null,
      address: d.customer_address || sale.owner?.address || null,
    },
    items: sale.items,
    product_total: sale.total,
    paid: sale.paid,
    delivery_charge: charge,
    charge_paid_by: "customer",
    to_collect: round2(sale.due + charge),
    status: d.status,
    note: d.note,
    rider: { name: d.delivery_man_name, phone: d.delivery_man_phone },
  };
}

/** Invoice for a courier parcel from a `courier_orders` row. */
export async function buildCourierInvoice(o: {
  sale_id: string;
  courier: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  courier_charge: number;
  paid_by: string;
  cod_amount: number;
  cod_charge?: number | null;
  cod_charge_percent?: number | null;
  consignment_id: string | null;
  tracking_code: string | null;
  status: string;
  note: string | null;
}): Promise<DeliveryInvoice> {
  const sale = await loadSaleForDeliveryInvoice(o.sale_id);
  const charge = Math.max(0, Number(o.courier_charge) || 0);
  const paidBy = o.paid_by === "shop" ? "shop" : "customer";
  const cod = Number(o.cod_amount) || 0;
  // Orders made before the COD charge existed have none stored.
  const codCharge = Math.max(0, Number(o.cod_charge) || 0);
  return {
    kind: "courier",
    invoice_no: sale.invoice_no,
    issued_at: sale.issued_at,
    customer: { name: o.recipient_name, phone: o.recipient_phone, address: o.recipient_address },
    items: sale.items,
    product_total: sale.total,
    paid: sale.paid,
    delivery_charge: charge,
    charge_paid_by: paidBy,
    cod_charge: codCharge,
    cod_charge_percent: o.cod_charge_percent == null ? undefined : Number(o.cod_charge_percent),
    to_collect: round2(cod),
    status: o.status,
    note: o.note,
    courier: {
      name: o.courier === "steadfast" ? "Steadfast Courier" : o.courier,
      consignment_id: o.consignment_id,
      tracking_code: o.tracking_code,
      tracking_url: o.courier === "steadfast" ? steadfastTrackingUrl(o.tracking_code) : null,
    },
  };
}

/** Bill lines shared by print and WhatsApp. */
function billLines(d: DeliveryInvoice) {
  const lines: { label: string; value: number; strong?: boolean; minus?: boolean }[] = [];
  lines.push({ label: "Product total", value: d.product_total });
  if (d.charge_paid_by === "shop") {
    lines.push({ label: "Delivery charge (free)", value: 0 });
  } else {
    lines.push({ label: "Delivery charge", value: d.delivery_charge });
  }
  if (d.kind === "courier" && (d.cod_charge ?? 0) > 0) {
    lines.push({ label: `COD charge${d.cod_charge_percent ? ` (${d.cod_charge_percent}%)` : ""}`, value: d.cod_charge ?? 0 });
  }
  const bill = d.product_total + (d.charge_paid_by === "shop" ? 0 : d.delivery_charge) + (d.kind === "courier" ? d.cod_charge ?? 0 : 0);
  lines.push({ label: "Total bill", value: round2(bill), strong: true });
  if (d.paid > 0) lines.push({ label: "Paid at shop", value: d.paid, minus: true });
  return lines;
}

const statusLabel = (s?: string | null) => (s ? String(s).replace(/_/g, " ") : "");

export function deliveryInvoiceText(d: DeliveryInvoice) {
  const C = getClinic();
  const out: string[] = [];
  out.push(`*${C.name}*`);
  out.push(`${C.address}`);
  out.push(`${C.phone}`);
  out.push("");
  out.push(d.kind === "courier" ? "*COURIER DELIVERY INVOICE*" : "*DELIVERY INVOICE*");
  out.push(`Invoice: ${d.invoice_no}`);
  out.push(`Date: ${new Date(d.issued_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`);
  if (d.status) out.push(`Status: ${statusLabel(d.status)}`);
  out.push("");
  out.push(`*Customer:* ${d.customer.name}`);
  if (d.customer.phone) out.push(`Phone: ${d.customer.phone}`);
  if (d.customer.address) out.push(`Address: ${d.customer.address}`);
  if (d.rider) {
    out.push("");
    out.push(`*Delivery man:* ${d.rider.name}${d.rider.phone ? ` (${d.rider.phone})` : ""}`);
  }
  if (d.courier) {
    out.push("");
    out.push(`*Courier:* ${d.courier.name}`);
    if (d.courier.consignment_id) out.push(`Consignment ID: ${d.courier.consignment_id}`);
    if (d.courier.tracking_code) out.push(`Tracking code: ${d.courier.tracking_code}`);
    if (d.courier.tracking_url) out.push(`Track: ${d.courier.tracking_url}`);
  }
  out.push("");
  out.push("*Items*");
  d.items.forEach((it, i) => out.push(`${i + 1}. ${it.name} — ${it.quantity} × ${money(it.unit_price)} = ${money(it.line_total)}`));
  out.push("");
  for (const l of billLines(d)) {
    const v = `${l.minus ? "− " : ""}${money(l.value)}`;
    out.push(l.strong ? `*${l.label}: ${v}*` : `${l.label}: ${v}`);
  }
  out.push(`*${d.kind === "courier" ? "COD (pay to courier)" : "Pay to delivery man"}: ${money(d.to_collect)}*`);
  if (d.note) { out.push(""); out.push(`Note: ${d.note}`); }
  out.push("");
  out.push(`Thank you for choosing ${C.name}.`);
  return out.join("\n");
}

export function shareDeliveryInvoiceOnWhatsApp(d: DeliveryInvoice) {
  const raw = String(d.customer.phone ?? "").replace(/\D/g, "");
  const phone = raw.startsWith("0") ? `88${raw}` : raw;
  const text = encodeURIComponent(deliveryInvoiceText(d));
  const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) toast.error("Pop-up blocked. Please allow pop-ups to share on WhatsApp.");
}

export function printDeliveryInvoice(d: DeliveryInvoice) {
  const C = getClinic();
  const title = d.kind === "courier" ? "Courier Delivery Invoice" : "Delivery Invoice";
  const itemRows =
    d.items
      .map(
        (it, i) => `<tr><td class="n">${i + 1}</td><td>${escapeHtml(it.name)}</td><td class="r">${it.quantity}</td><td class="r">${money(it.unit_price)}</td><td class="r"><b>${money(it.line_total)}</b></td></tr>`,
      )
      .join("") || `<tr><td colspan="5" class="c m">No items</td></tr>`;
  const bill = billLines(d)
    .map((l) => `<div class="row${l.strong ? " strong" : ""}"><span>${escapeHtml(l.label)}</span><span>${l.minus ? "− " : ""}${money(l.value)}</span></div>`)
    .join("");

  const partyBox = d.rider
    ? `<div class="box"><div class="lb">Delivery man</div><div class="big">${escapeHtml(d.rider.name)}</div>${d.rider.phone ? `<div>${escapeHtml(d.rider.phone)}</div>` : ""}</div>`
    : d.courier
      ? `<div class="box"><div class="lb">Courier</div><div class="big">${escapeHtml(d.courier.name)}</div>
          ${d.courier.consignment_id ? `<div>Consignment ID: <b>${escapeHtml(d.courier.consignment_id)}</b></div>` : ""}
          ${d.courier.tracking_code ? `<div>Tracking code: <b>${escapeHtml(d.courier.tracking_code)}</b></div>` : `<div class="m">Not booked with the courier yet</div>`}
          ${d.courier.tracking_url ? `<div class="m small">${escapeHtml(d.courier.tracking_url)}</div>` : ""}</div>`
      : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(d.invoice_no)} — ${title}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{margin:0;background:#fff;color:#111;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  .bar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px 12px;background:#f4f4f5;border-bottom:1px solid #e4e4e7}
  .bar button{font:inherit;font-weight:600;padding:6px 14px;border-radius:6px;border:1px solid #d4d4d8;background:#fff;cursor:pointer}
  .bar button.p{background:#111;color:#fff;border-color:#111}
  .sheet{max-width:760px;margin:0 auto;padding:26px 32px}
  header{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:12px}
  h1{margin:0;font-size:20px}
  .addr{font-size:11px;color:#444;margin-top:4px}
  .doc{text-align:right}
  .doc .t{font-size:14px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
  .doc .k{font-size:11px;color:#555;margin-top:4px}
  .pill{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:999px;border:1px solid #111;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}
  .box{border:1px solid #d4d4d8;border-radius:8px;padding:10px 12px}
  .lb{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}
  .big{font-size:15px;font-weight:700}
  .small{font-size:11px}.m{color:#666}.c{text-align:center}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#555;border-bottom:1.5px solid #111;padding:6px 8px}
  td{padding:7px 8px;border-bottom:1px solid #e4e4e7;vertical-align:top}
  .n{width:28px;color:#777}.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  th.r{text-align:right}
  .totals{margin:14px 0 0 auto;width:300px}
  .row{display:flex;justify-content:space-between;padding:4px 0;font-variant-numeric:tabular-nums}
  .row.strong{border-top:1.5px solid #111;margin-top:4px;padding-top:7px;font-weight:700;font-size:14px}
  .collect{margin-top:10px;display:flex;justify-content:space-between;align-items:center;background:#111;color:#fff;border-radius:8px;padding:10px 14px;font-size:16px;font-weight:800}
  .note{margin-top:14px;font-size:12px;border-top:1px dashed #d4d4d8;padding-top:8px}
  .sign{margin-top:42px;display:flex;justify-content:space-between;gap:24px;font-size:11px;color:#555}
  .sign div{flex:1;text-align:center;border-top:1px solid #111;padding-top:4px}
  .foot{margin-top:18px;text-align:center;font-size:10px;color:#888}
  @page{size:A4;margin:12mm}
  @media print{.bar{display:none}.sheet{padding:0}}
  @media (max-width:560px){.grid{grid-template-columns:1fr}.totals{width:100%}.sheet{padding:16px}}
</style></head><body>
<div class="bar"><button onclick="window.close()">Close</button><button class="p" onclick="window.print()">Print</button></div>
<div class="sheet">
  <header>
    <div><h1>${escapeHtml(C.name)}</h1><div class="addr">${escapeHtml(C.address)}<br>Tel: ${escapeHtml(C.phone)}</div></div>
    <div class="doc">
      <div class="t">${title}</div>
      <div class="k">Invoice <b>${escapeHtml(d.invoice_no)}</b></div>
      <div class="k">${escapeHtml(new Date(d.issued_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}</div>
      ${d.status ? `<div class="pill">${escapeHtml(statusLabel(d.status))}</div>` : ""}
    </div>
  </header>
  <div class="grid">
    <div class="box"><div class="lb">Deliver to</div><div class="big">${escapeHtml(d.customer.name)}</div>
      ${d.customer.phone ? `<div>${escapeHtml(d.customer.phone)}</div>` : ""}
      ${d.customer.address ? `<div class="small">${escapeHtml(d.customer.address)}</div>` : `<div class="m small">No address</div>`}
    </div>
    ${partyBox}
  </div>
  <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead><tbody>${itemRows}</tbody></table>
  <div class="totals">${bill}
    <div class="collect"><span>${d.kind === "courier" ? "COD amount" : "To collect"}</span><span>${money(d.to_collect)}</span></div>
  </div>
  ${d.note ? `<div class="note"><b>Note:</b> ${escapeHtml(d.note)}</div>` : ""}
  <div class="sign"><div>${d.kind === "courier" ? "Courier" : "Delivery man"}</div><div>Customer</div></div>
  <div class="foot">The delivery${d.kind === "courier" ? " and COD" : ""} charge is collected for the delivery service. Thank you for choosing ${escapeHtml(C.name)}.</div>
</div>
</body></html>`;

  const w = window.open("", "_blank", "width=860,height=1000");
  if (!w) {
    toast.error("Enable pop-ups to print the delivery invoice");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
