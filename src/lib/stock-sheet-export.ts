// Monthly physical stock verification sheet (.xlsx).
// One section per category: heading, column titles, products, category totals;
// a grand total at the end. "Stock (Physical)" is left blank to write by hand and
// "Change" fills itself in Excel once a count is typed. Reading only — nothing in
// the POS changes.

export type SheetProduct = {
  name: string;
  selling_price: number | null;
  stock_quantity: number | null;
};
export type SheetSection = { title: string; products: SheetProduct[] };

const BORDER = { style: "thin" as const, color: { argb: "FF9CA3AF" } };
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

export async function downloadStockSheet(opts: {
  sections: SheetSection[];
  business: string;          // "Pet Care Vet", "Sasthya Seba" or "All businesses"
  scope: string;             // "All Categories" or the category name
  date?: Date;
}) {
  const ExcelJS = (await import("exceljs")).default;
  const date = opts.date ?? new Date();
  const month = date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const wb = new ExcelJS.Workbook();
  wb.created = date;
  const ws = wb.addWorksheet("Stock Verification", {
    pageSetup: {
      paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      horizontalCentered: true,
    },
    headerFooter: { oddFooter: `&L${opts.business} · ${month}&RPage &P of &N` },
    views: [{ showGridLines: false }],
  });
  ws.columns = [
    { key: "sl", width: 6 },
    { key: "name", width: 46 },
    { key: "price", width: 12 },
    { key: "prev", width: 14 },
    { key: "phys", width: 16 },
    { key: "chg", width: 12 },
  ];

  // Title block
  const t1 = ws.addRow([`Monthly Physical Stock Verification — ${month}`]);
  ws.mergeCells(t1.number, 1, t1.number, 6);
  t1.font = { bold: true, size: 15 };
  t1.height = 24;
  const t2 = ws.addRow([`${opts.business}  ·  ${opts.scope}  ·  Downloaded ${day}`]);
  ws.mergeCells(t2.number, 1, t2.number, 6);
  t2.font = { size: 10, color: { argb: "FF4B5563" } };
  const t3 = ws.addRow(["Counted by: ____________________      Checked by: ____________________      Date: ____________"]);
  ws.mergeCells(t3.number, 1, t3.number, 6);
  t3.font = { size: 10 };
  t3.height = 22;
  ws.addRow([]);

  const totalCells: { prev: string; phys: string; chg: string }[] = [];

  for (const sec of opts.sections) {
    // Category heading
    const h = ws.addRow([sec.title.toUpperCase()]);
    ws.mergeCells(h.number, 1, h.number, 6);
    h.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
    h.height = 22;
    h.alignment = { vertical: "middle" };

    const head = ws.addRow(["SL", "Product Name", "Sale Price", "Previous Stock", "Stock (Physical)", "Change"]);
    head.font = { bold: true, size: 10 };
    head.height = 20;
    head.eachCell((c, col) => {
      c.border = ALL_BORDERS;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      c.alignment = { vertical: "middle", horizontal: col <= 2 ? "left" : "center", wrapText: true };
    });

    const first = head.number + 1;
    sec.products.forEach((p, i) => {
      const r = ws.addRow([
        String(i + 1).padStart(2, "0"),
        p.name.trim(),
        Number(p.selling_price) || 0,
        Number(p.stock_quantity) || 0,
        null,
        null,
      ]);
      const n = r.number;
      // Change = Physical − Previous, only once a count is written.
      r.getCell(6).value = { formula: `IF(E${n}="","",E${n}-D${n})` };
      r.height = 22; // room to write by hand
      r.font = { size: 10 };
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.border = ALL_BORDERS;
        c.alignment = { vertical: "middle", horizontal: col === 1 ? "center" : col === 2 ? "left" : "right", wrapText: col === 2 };
      });
      r.getCell(3).numFmt = "#,##0.##";
      r.getCell(4).numFmt = "#,##0.##";
      r.getCell(5).numFmt = "#,##0.##";
      r.getCell(6).numFmt = "+#,##0.##;-#,##0.##;0";
    });
    const last = ws.lastRow!.number;
    const has = sec.products.length > 0;

    // Category totals
    const tot = ws.addRow(["", `Total — ${sec.title}`, "", null, null, null]);
    const tn = tot.number;
    tot.getCell(4).value = has ? { formula: `SUM(D${first}:D${last})` } : 0;
    tot.getCell(5).value = has ? { formula: `IF(COUNT(E${first}:E${last})=0,"",SUM(E${first}:E${last}))` } : "";
    tot.getCell(6).value = has ? { formula: `IF(COUNT(E${first}:E${last})=0,"",SUM(F${first}:F${last}))` } : "";
    tot.font = { bold: true, size: 10 };
    tot.height = 20;
    tot.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = ALL_BORDERS;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      c.alignment = { vertical: "middle", horizontal: col <= 2 ? "left" : "right" };
      if (col >= 4) c.numFmt = col === 6 ? "+#,##0.##;-#,##0.##;0" : "#,##0.##";
    });
    totalCells.push({ prev: `D${tn}`, phys: `E${tn}`, chg: `F${tn}` });
    ws.addRow([]);
  }

  // Grand total over every category section
  if (totalCells.length > 1) {
    const g = ws.addRow(["", "GRAND TOTAL (all categories)", "", null, null, null]);
    g.getCell(4).value = { formula: totalCells.map((t) => t.prev).join("+") };
    g.getCell(5).value = { formula: `IF(COUNT(${totalCells.map((t) => t.phys).join(",")})=0,"",SUM(${totalCells.map((t) => t.phys).join(",")}))` };
    g.getCell(6).value = { formula: `IF(COUNT(${totalCells.map((t) => t.chg).join(",")})=0,"",SUM(${totalCells.map((t) => t.chg).join(",")}))` };
    g.font = { bold: true, size: 11 };
    g.height = 24;
    g.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = { top: { style: "medium" }, left: BORDER, bottom: { style: "medium" }, right: BORDER };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1D5DB" } };
      c.alignment = { vertical: "middle", horizontal: col <= 2 ? "left" : "right" };
      if (col >= 4) c.numFmt = col === 6 ? "+#,##0.##;-#,##0.##;0" : "#,##0.##";
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `stock-verification_${ym}_${slug(opts.scope)}_${date.toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
