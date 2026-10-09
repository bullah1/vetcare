import * as XLSX from "xlsx";

export function exportToExcel(
  rows: Record<string, unknown>[],
  fileBaseName: string,
  sheetName = "Sheet1",
) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  ws["!cols"] = headers.map((h) => ({
    wch: Math.min(
      40,
      Math.max(h.length + 2, ...rows.map((r) => String(r[h] ?? "").length + 2)),
    ),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${fileBaseName}-${stamp}.xlsx`);
}
