// Printable 4×6 inch courier sticker / 80mm roll label for courier parcels.
// Used from the CourierDialog and Sales History so the shop can just peel & stick.
import JsBarcode from "jsbarcode";
import { toast } from "sonner";
import { getClinic } from "@/lib/clinic-settings";
import { escapeHtml } from "@/lib/invoice-print";

export type CourierLabelData = {
  invoice_no: string;
  courier: string;
  consignment_id?: string | null;
  tracking_code?: string | null;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  item_description?: string;
  quantity?: number;
  sales_total: number;
  courier_charge: number;
  paid_by: "customer" | "shop";
  cod_amount: number;
  note?: string | null;
  sent_at?: string | null;
};

const money = (n: number) => `${getClinic().currency} ${Number(n || 0).toFixed(2)}`;

function svgBarcode(value: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(svg, value, { format: "CODE128", displayValue: true, height: 62, margin: 2, width: 2, fontSize: 15, fontOptions: "bold", textMargin: 6 });
  } catch {
    return `<div style="font-family:monospace;font-size:20px;font-weight:700;text-align:center;padding:8px 0">${escapeHtml(value)}</div>`;
  }
  return new XMLSerializer().serializeToString(svg);
}

function codBadge(cod: number) {
  if (cod <= 0.004) {
    return `<div class="badge paid">PAID</div>`;
  }
  return `<div class="badge cod">COD ${money(cod)}</div>`;
}

/**
 * Print a courier sticker label.
 * Defaults to a 4×6 inch (101.6 × 152.4 mm) label. The user can choose 80mm
 * thermal roll via the settings dropdown inside the print window.
 */
export function printCourierLabel(d: CourierLabelData) {
  const CLINIC = getClinic();
  const tracking = d.tracking_code?.trim() || d.consignment_id?.trim() || d.invoice_no;
  const barcodeSvg = svgBarcode(tracking);

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Courier Label — ${escapeHtml(d.invoice_no)}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{margin:0;padding:0;background:#fff;color:#000;font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  .toolbar{position:sticky;top:0;z-index:10;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#fff}
  .toolbar select{font:inherit;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff}
  .toolbar button{font:inherit;font-weight:700;padding:8px 14px;border:0;border-radius:6px;background:#000;color:#fff;cursor:pointer}
  .sheet{width:101.6mm;min-height:152.4mm;margin:0 auto;padding:4mm;background:#fff;display:flex;flex-direction:column;gap:3mm}
  .sheet.w80{width:80mm;min-height:152.4mm}
  .box{border:1px solid #000;border-radius:3mm;padding:3mm;background:#fff}
  .box.dark{background:#000;color:#fff;border-color:#000}
  .row{display:flex;justify-content:space-between;gap:4px;align-items:center}
  .label{font-size:9px;text-transform:uppercase;letter-spacing:.4px;opacity:.75;margin-bottom:1mm}
  .value{font-size:13px;font-weight:700;line-height:1.25;word-break:break-word}
  .value.sm{font-size:11px;font-weight:600}
  .value.lg{font-size:16px}
  .brand{font-size:15px;font-weight:800;letter-spacing:.3px;text-transform:uppercase}
  .addr{font-size:10px;line-height:1.35;margin-top:1mm;opacity:.9}
  .to-name{font-size:18px;font-weight:800;line-height:1.15;word-break:break-word}
  .to-phone{font-size:14px;font-weight:700;margin-top:1mm}
  .to-address{font-size:12px;line-height:1.35;margin-top:1.5mm;word-break:break-word}
  .badge{display:inline-block;padding:2mm 4mm;border-radius:2mm;font-size:16px;font-weight:800;text-align:center;letter-spacing:.5px}
  .badge.cod{background:#000;color:#fff}
  .badge.paid{background:#16a34a;color:#fff}
  .bar-wrap{margin-top:1mm;display:flex;justify-content:center;align-items:center;flex-direction:column}
  .bar-wrap svg{width:100%;height:24mm}
  .barcode-text{font-family:"SF Mono",ui-monospace,monospace;font-size:18px;font-weight:800;text-align:center;letter-spacing:1px;margin-top:1.5mm}
  .meta{font-size:10px;line-height:1.4}
  .meta b{font-weight:700}
  .note{font-size:10px;line-height:1.3;opacity:.85;word-break:break-word}
  .divider{border-top:1px dashed #000;margin:1mm 0}
  .flex1{flex:1}
  @page{size:101.6mm 152.4mm;margin:0}
  @media print{
    html,body{background:#fff;width:101.6mm}
    .toolbar{display:none!important}
    .sheet{margin:0;width:101.6mm;min-height:152.4mm;padding:4mm;gap:3mm}
    .sheet.w80{width:80mm}
    .box{page-break-inside:avoid;break-inside:avoid}
  }
</style></head><body>
<div class="toolbar no-print">
  <div>
    <b>Courier Label</b>
    <select id="sizeSelect">
      <option value="4x6">4 × 6 inch sticker</option>
      <option value="80mm">80mm thermal roll</option>
    </select>
  </div>
  <button onclick="window.print()">Print Label</button>
</div>
<div id="sheet" class="sheet">
  <div class="box dark">
    <div class="label" style="color:#fff">From / Shipper</div>
    <div class="brand">${escapeHtml(CLINIC.name)}</div>
    <div class="addr">${escapeHtml(CLINIC.address)}<br>Phone: ${escapeHtml(CLINIC.phone)}</div>
  </div>

  <div class="box flex1">
    <div class="label">To / Recipient</div>
    <div class="to-name">${escapeHtml(d.recipient_name)}</div>
    <div class="to-phone">${escapeHtml(d.recipient_phone)}</div>
    <div class="to-address">${escapeHtml(d.recipient_address)}</div>
  </div>

  <div class="box">
    <div class="row" style="align-items:flex-start">
      <div>
        <div class="label">Invoice</div>
        <div class="value lg">${escapeHtml(d.invoice_no)}</div>
      </div>
      ${codBadge(Number(d.cod_amount))}
    </div>
    <div class="divider"></div>
    <div class="row">
      <div>
        <div class="label">Consignment ID</div>
        <div class="value sm">${escapeHtml(d.consignment_id || "—")}</div>
      </div>
      <div style="text-align:right">
        <div class="label">Courier</div>
        <div class="value sm" style="text-transform:capitalize">${escapeHtml(d.courier)}</div>
      </div>
    </div>
  </div>

  <div class="box" style="padding:3.5mm 3mm">
    <div class="label">Tracking / Consignment Code</div>
    <div class="bar-wrap">${barcodeSvg}<div class="barcode-text">${escapeHtml(tracking)}</div></div>
  </div>

  <div class="box" style="padding:2.5mm">
    <div class="meta">
      <b>${escapeHtml(CLINIC.name)}</b> · ${escapeHtml(CLINIC.phone)} · Please handle with care.
    </div>
  </div>
</div>
<script>
  (function(){
    var sheet = document.getElementById('sheet');
    var sel = document.getElementById('sizeSelect');
    function apply(){
      var v = sel.value;
      if (v === '80mm') sheet.classList.add('w80');
      else sheet.classList.remove('w80');
    }
    sel.addEventListener('change', apply);
    apply();
  })();
</script>
</body></html>`;

  const w = window.open("", "_blank", "width=520,height=820");
  if (!w) {
    toast.error("Enable pop-ups to print the courier label");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
