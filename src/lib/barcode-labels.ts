import JsBarcode from "jsbarcode";
import { toast } from "sonner";
import { getClinic } from "@/lib/clinic-settings";
import { escapeHtml } from "@/lib/invoice-print";

export const clinicLabelName = () => getClinic().labelName || getClinic().name;

export type LabelItem = { name: string; selling_price: number; barcode: string | null; copies: number };

export function svgBarcode(value: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(svg, value, { format: "CODE128", displayValue: false, height: 60, margin: 0, width: 2 });
  } catch {
    return `<div style="font-family:monospace;font-size:11px">${value}</div>`;
  }
  return new XMLSerializer().serializeToString(svg);
}

export function printLabelsBatch(items: LabelItem[]) {
  const valid = items.filter((it) => it.barcode && it.copies > 0);
  if (!valid.length) { toast.error("No products with barcode selected"); return; }
  const blocks = valid.flatMap((it) => {
    const bar = svgBarcode(it.barcode!);
    const price = `৳ ${Number(it.selling_price).toFixed(2)}`;
    return Array.from({ length: it.copies }, () => `
      <div class="label"><div class="inner">
        <div class="brand">${escapeHtml(clinicLabelName())}</div>
        <div class="name">${escapeHtml(it.name)}</div>
        <div class="bar">${bar}</div>
        <div class="price">${escapeHtml(price)}</div>
      </div></div>`);
  }).join("");
  const total = valid.reduce((s, x) => s + x.copies, 0);
  const pageW = 38;
  const pageH = 25;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Labels (${total})</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{margin:0;padding:0;background:#f8fafc;font:11px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#000}
  .toolbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #cbd5e1;background:#fff;color:#0f172a}
  .toolbar h3{margin:0 0 4px;font-size:13px;color:#0f766e}
  .toolbar ol{margin:0;padding-left:18px;line-height:1.45}
  .toolbar li{margin:2px 0}
  .toolbar button{white-space:nowrap;font:inherit;font-weight:700;padding:7px 12px;border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;cursor:pointer}
  .sheet{width:${pageW}mm;margin:0 auto;padding:6mm 0 10mm;display:flex;flex-direction:column;align-items:center;gap:3mm}
  .label{position:relative;width:${pageW}mm;height:${pageH}mm;margin:0;padding:0;overflow:hidden;background:#fff;border:1px dashed #94a3b8;box-shadow:0 2px 10px rgba(15,23,42,.12)}
  .inner{width:${pageW}mm;height:${pageH}mm;padding:1.2mm 1.5mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden}
  .brand{font-size:7.5px;color:#000;font-weight:800;letter-spacing:.6px;text-transform:uppercase;line-height:1.1}
  .name{font-size:8.5px;font-weight:700;text-align:center;line-height:1.15;max-height:2.3em;overflow:hidden;width:100%}
  .bar{width:100%;display:flex;justify-content:center;margin:.3mm 0}
  .bar svg{width:33mm;height:9mm}
  .price{font-size:11px;font-weight:800;color:#000;line-height:1.1}
  @page{size:${pageW}mm ${pageH}mm;margin:0}
  @media print{
    html,body{width:${pageW}mm;margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}
    .toolbar{display:none!important}
    .sheet{width:${pageW}mm!important;display:block;margin:0!important;padding:0!important;font-size:0!important;line-height:0!important}
    .label{display:block;width:${pageW}mm!important;height:${pageH}mm!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;page-break-before:auto!important;page-break-after:always!important;page-break-inside:avoid!important;break-before:auto!important;break-after:page!important;break-inside:avoid!important}
    .label:last-child{page-break-after:auto!important;break-after:auto!important}
    .inner{width:${pageW}mm!important;height:${pageH}mm!important}
  }
</style></head><body>
<div class="toolbar no-print">
  <div>
    <h3>Label list ready — ${total} label (${pageW} × ${pageH} mm) · continuous list</h3>
    <ol>
      <li>This is a continuous roll/list print — no forced page break after each label</li>
      <li><b>Paper size:</b> ${pageW}mm roll/continuous or ${pageW}mm × ${pageH}mm, <b>Margins:</b> None, <b>Scale:</b> 100%</li>
      <li><b>Headers and footers:</b> turn off; if the preview shows A4, select the label/roll paper size in the printer driver</li>
    </ol>
  </div>
  <button onclick="window.print()">Print</button>
</div>
<div class="sheet">${blocks}</div>
</body></html>`;
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) { toast.error("Enable pop-ups to print labels"); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function barcodePng(value: string): string | null {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, { format: "CODE128", displayValue: false, height: 60, margin: 0, width: 2 });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export async function downloadLabelsPdf(items: LabelItem[]) {
  const valid = items.filter((it) => it.barcode && it.copies > 0);
  if (!valid.length) { toast.error("No products with barcode selected"); return; }
  const { jsPDF } = await import("jspdf");
  const W = 38, H = 25;
  const doc = new jsPDF({ unit: "mm", format: [W, H], orientation: "landscape" });
  let first = true;
  for (const it of valid) {
    const png = barcodePng(it.barcode!);
    for (let c = 0; c < it.copies; c++) {
      if (!first) doc.addPage([W, H], "landscape");
      first = false;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.5);
      doc.text(clinicLabelName().toUpperCase(), W / 2, 3.6, { align: "center" });
      doc.setFontSize(6.5);
      const name = doc.splitTextToSize(it.name, W - 3).slice(0, 2) as string[];
      doc.text(name, W / 2, 7.2, { align: "center" });
      if (png) doc.addImage(png, "PNG", 2.5, 11, W - 5, 8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`Tk ${Number(it.selling_price).toFixed(2)}`, W / 2, 23, { align: "center" });
    }
  }
  doc.save(`labels-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success("PDF downloaded");
}
