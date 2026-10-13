// Bulk product upload from Excel / CSV. New products are added (with opening stock);
// products already in the list (same SKU, barcode or exact name) can be updated.
// Stock of an existing product is never changed here — use Purchases / Stock Adjustment.
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const db = supabase as any;

type Existing = { id: string; name: string; sku: string | null; barcode: string | null };

const HEADERS = [
  "Name", "SKU", "Barcode", "Category", "Unit", "Purchase price", "Selling price",
  "Wholesale price", "Minimum price", "Tax %", "Opening stock", "Low stock alert", "Description",
] as const;

const CATEGORY_WORDS: [string, string][] = [
  ["pet_food", "pet_food"], ["pet food", "pet_food"], ["food", "pet_food"], ["feed", "pet_food"], ["খাবার", "pet_food"],
  ["medicine", "medicine"], ["med", "medicine"], ["drug", "medicine"], ["vaccine", "medicine"], ["ঔষধ", "medicine"], ["ওষুধ", "medicine"],
  ["accessory", "accessory"], ["accessories", "accessory"], ["toy", "accessory"], ["এক্সেসরিজ", "accessory"],
  ["service", "service"], ["সার্ভিস", "service"],
  ["other", "other"],
];
const toCategory = (raw: string) => {
  const t = raw.trim().toLowerCase();
  if (!t) return "other";
  return CATEGORY_WORDS.find(([w]) => t === w)?.[1] ?? CATEGORY_WORDS.find(([w]) => t.includes(w))?.[1] ?? null;
};

// Accept common header spellings (English / Bangla / with or without units).
const ALIASES: Record<string, (typeof HEADERS)[number]> = {
  name: "Name", "product name": "Name", product: "Name", "নাম": "Name", "প্রোডাক্ট": "Name",
  sku: "SKU", code: "SKU", "item code": "SKU",
  barcode: "Barcode", "bar code": "Barcode",
  category: "Category", type: "Category", "ক্যাটাগরি": "Category",
  unit: "Unit", "ইউনিট": "Unit",
  "purchase price": "Purchase price", cost: "Purchase price", "cost price": "Purchase price", "buying price": "Purchase price", "tp": "Purchase price", "ক্রয়মূল্য": "Purchase price",
  "selling price": "Selling price", price: "Selling price", mrp: "Selling price", "sale price": "Selling price", "বিক্রয়মূল্য": "Selling price",
  "wholesale price": "Wholesale price", wholesale: "Wholesale price", "b2b price": "Wholesale price",
  "minimum price": "Minimum price", "min price": "Minimum price", "minimum selling price": "Minimum price",
  "tax %": "Tax %", tax: "Tax %", vat: "Tax %", "vat %": "Tax %",
  "opening stock": "Opening stock", stock: "Opening stock", qty: "Opening stock", quantity: "Opening stock", "স্টক": "Opening stock",
  "low stock alert": "Low stock alert", "reorder level": "Low stock alert", "low stock": "Low stock alert",
  description: "Description", details: "Description",
};
const normHead = (h: string) => ALIASES[h.trim().toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/[_\s]+/g, " ")] ?? null;

type Row = {
  line: number;
  name: string; sku: string | null; barcode: string | null; category: string; unit: string | null;
  purchase_price: number; selling_price: number; wholesale_price: number | null; min_selling_price: number | null;
  tax_percent: number; stock_quantity: number; low_stock_threshold: number; description: string | null;
  errors: string[]; matchId: string | null; matchBy: string | null;
};

const num = (v: unknown): number | null => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[,৳\s]/g, "").replace(/tk/i, ""));
  return Number.isFinite(n) ? n : NaN;
};

export function downloadProductTemplate() {
  const sample = [
    { Name: "Royal Canin Kitten 2kg", SKU: "RC-K2", Barcode: "", Category: "pet_food", Unit: "pcs", "Purchase price": 2100, "Selling price": 2450, "Wholesale price": 2300, "Minimum price": 2250, "Tax %": 0, "Opening stock": 10, "Low stock alert": 3, Description: "" },
    { Name: "Ivermectin 1% 10ml", SKU: "", Barcode: "", Category: "medicine", Unit: "vial", "Purchase price": 120, "Selling price": 180, "Wholesale price": "", "Minimum price": "", "Tax %": 0, "Opening stock": 25, "Low stock alert": 5, Description: "" },
  ];
  const ws = XLSX.utils.json_to_sheet(sample, { header: [...HEADERS] });
  ws["!cols"] = HEADERS.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const help = XLSX.utils.aoa_to_sheet([
    ["Column", "Required", "Notes"],
    ["Name", "Yes", "Product name"],
    ["Selling price", "Yes", "Retail price"],
    ["Category", "No", "pet_food, medicine, accessory, service or other (default other)"],
    ["SKU / Barcode", "No", "Used to find a product that is already in the list"],
    ["Wholesale price", "No", "Price for B2B customers"],
    ["Minimum price", "No", "Below this only an admin can sell"],
    ["Opening stock", "No", "Only for NEW products. Stock of existing products is not changed"],
  ]);
  help["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  XLSX.utils.book_append_sheet(wb, help, "How to fill");
  XLSX.writeFile(wb, "product-upload-template.xlsx");
}

export function ProductImportDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (o: boolean) => void; existing: Existing[] }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState<Omit<Row, "matchId" | "matchBy">[]>([]);
  const [unknownHeads, setUnknownHeads] = useState<string[]>([]);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; failed: { line: number; name: string; error: string }[] } | null>(null);

  const index = useMemo(() => {
    const bySku = new Map<string, Existing>(), byBarcode = new Map<string, Existing>(), byName = new Map<string, Existing>();
    for (const p of existing) {
      if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p);
      if (p.barcode) byBarcode.set(p.barcode.trim().toLowerCase(), p);
      byName.set(p.name.trim().toLowerCase(), p);
    }
    return { bySku, byBarcode, byName };
  }, [existing]);

  const rows: Row[] = useMemo(() => {
    const seenSku = new Map<string, number>(), seenBarcode = new Map<string, number>();
    return raw.map((r) => {
      const errors = [...r.errors];
      let m: Existing | undefined, by: string | null = null;
      if (r.sku && (m = index.bySku.get(r.sku.toLowerCase()))) by = "SKU";
      else if (r.barcode && (m = index.byBarcode.get(r.barcode.toLowerCase()))) by = "barcode";
      else if ((m = index.byName.get(r.name.toLowerCase()))) by = "name";
      if (r.sku) {
        const k = r.sku.toLowerCase();
        if (seenSku.has(k)) errors.push(`SKU repeats line ${seenSku.get(k)}`); else seenSku.set(k, r.line);
        const other = index.bySku.get(k);
        if (other && m && other.id !== m.id) errors.push("SKU belongs to another product");
      }
      if (r.barcode) {
        const k = r.barcode.toLowerCase();
        if (seenBarcode.has(k)) errors.push(`Barcode repeats line ${seenBarcode.get(k)}`); else seenBarcode.set(k, r.line);
        const other = index.byBarcode.get(k);
        if (other && (!m || other.id !== m.id)) errors.push("Barcode belongs to another product");
      }
      return { ...r, errors, matchId: m?.id ?? null, matchBy: by };
    });
  }, [raw, index]);

  const counts = useMemo(() => ({
    total: rows.length,
    errors: rows.filter((r) => r.errors.length).length,
    create: rows.filter((r) => !r.errors.length && !r.matchId).length,
    update: rows.filter((r) => !r.errors.length && r.matchId).length,
  }), [rows]);

  const reset = () => { setRaw([]); setFileName(""); setUnknownHeads([]); setResult(null); setProgress(0); if (fileRef.current) fileRef.current.value = ""; };

  const readFile = async (file: File) => {
    setResult(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false }) as unknown[][];
      if (!grid.length) throw new Error("The file is empty");
      const head = grid[0].map((h) => String(h ?? ""));
      const mapped = head.map(normHead);
      if (!mapped.includes("Name")) throw new Error('No "Name" column found. Download the template to see the columns.');
      if (!mapped.includes("Selling price")) throw new Error('No "Selling price" column found.');
      setUnknownHeads(head.filter((h, i) => h.trim() && !mapped[i]));
      const out: Omit<Row, "matchId" | "matchBy">[] = [];
      grid.slice(1).forEach((cells, i) => {
        const get = (k: (typeof HEADERS)[number]) => { const j = mapped.indexOf(k); return j >= 0 ? cells[j] : ""; };
        const name = String(get("Name") ?? "").trim();
        if (!name && cells.every((c) => String(c ?? "").trim() === "")) return;
        const errors: string[] = [];
        if (!name) errors.push("Name is empty");
        const sell = num(get("Selling price"));
        if (sell == null) errors.push("Selling price is empty"); else if (Number.isNaN(sell) || sell < 0) errors.push("Selling price is not a number");
        const cat = toCategory(String(get("Category") ?? ""));
        if (!cat) errors.push(`Unknown category "${String(get("Category"))}"`);
        const n = (k: (typeof HEADERS)[number], label: string) => {
          const v = num(get(k));
          if (v != null && (Number.isNaN(v) || v < 0)) { errors.push(`${label} is not a valid number`); return null; }
          return v;
        };
        const purchase = n("Purchase price", "Purchase price");
        const wholesale = n("Wholesale price", "Wholesale price");
        const minP = n("Minimum price", "Minimum price");
        if (minP != null && sell != null && !Number.isNaN(sell) && minP > sell) errors.push("Minimum price is more than selling price");
        const s = (k: (typeof HEADERS)[number]) => { const v = String(get(k) ?? "").trim(); return v || null; };
        out.push({
          line: i + 2, name, sku: s("SKU"), barcode: s("Barcode"), category: cat ?? "other", unit: s("Unit") ?? "pcs",
          purchase_price: purchase ?? 0, selling_price: sell != null && !Number.isNaN(sell) ? sell : 0,
          wholesale_price: wholesale, min_selling_price: minP,
          tax_percent: n("Tax %", "Tax %") ?? 0, stock_quantity: n("Opening stock", "Opening stock") ?? 0,
          low_stock_threshold: n("Low stock alert", "Low stock alert") ?? 5, description: s("Description"), errors,
        });
      });
      if (!out.length) throw new Error("No product rows found under the header");
      setRaw(out);
      setFileName(file.name);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not read the file");
      reset();
    }
  };

  const run = async () => {
    const good = rows.filter((r) => !r.errors.length && (!r.matchId || updateExisting));
    if (!good.length) { toast.error("Nothing to upload"); return; }
    setBusy(true); setProgress(0);
    const failed: { line: number; name: string; error: string }[] = [];
    let created = 0, updated = 0, done = 0;
    // Wholesale / minimum price columns may not exist on an older database.
    let b2bCols = true;
    const base = (r: Row) => ({
      name: r.name, sku: r.sku, barcode: r.barcode, category: r.category, unit: r.unit,
      purchase_price: r.purchase_price, selling_price: r.selling_price, tax_percent: r.tax_percent,
      low_stock_threshold: r.low_stock_threshold, ...(r.description ? { description: r.description } : {}),
    });
    const withB2b = (o: any, r: Row) => (b2bCols ? { ...o, wholesale_price: r.wholesale_price, min_selling_price: r.min_selling_price } : o);
    const isColErr = (e: any) => /wholesale_price|min_selling_price/.test(e?.message ?? "");

    // New products in batches
    const fresh = good.filter((r) => !r.matchId);
    for (let i = 0; i < fresh.length; i += 100) {
      const chunk = fresh.slice(i, i + 100);
      const payload = () => chunk.map((r) => withB2b({ ...base(r), stock_quantity: r.stock_quantity, is_active: true }, r));
      let { error } = await db.from("products").insert(payload());
      if (error && isColErr(error)) { b2bCols = false; ({ error } = await db.from("products").insert(payload())); }
      if (error) {
        // Find the bad rows one by one so the rest still go in.
        for (const r of chunk) {
          const { error: e1 } = await db.from("products").insert(withB2b({ ...base(r), stock_quantity: r.stock_quantity, is_active: true }, r));
          if (e1) failed.push({ line: r.line, name: r.name, error: e1.message }); else created++;
        }
      } else created += chunk.length;
      done += chunk.length; setProgress(Math.round((done / good.length) * 100));
    }
    // Existing products: details and prices only (stock untouched)
    for (const r of good.filter((x) => x.matchId)) {
      let { error } = await db.from("products").update(withB2b(base(r), r)).eq("id", r.matchId);
      if (error && isColErr(error)) { b2bCols = false; ({ error } = await db.from("products").update(base(r)).eq("id", r.matchId)); }
      if (error) failed.push({ line: r.line, name: r.name, error: error.message }); else updated++;
      done++; if (done % 10 === 0 || done === good.length) setProgress(Math.round((done / good.length) * 100));
    }
    setBusy(false);
    const skipped = rows.length - good.length;
    setResult({ created, updated, skipped, failed });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["pos-products"] });
    if (!b2bCols) toast.warning("Wholesale / minimum prices were not saved — run the B2B database update first.");
    toast.success(`Products uploaded: ${created} new, ${updated} updated${failed.length ? `, ${failed.length} failed` : ""}`);
  };

  const downloadProblems = () => {
    const list = [
      ...rows.filter((r) => r.errors.length).map((r) => ({ Line: r.line, Name: r.name, Problem: r.errors.join("; ") })),
      ...(result?.failed ?? []).map((f) => ({ Line: f.line, Name: f.name, Problem: f.error })),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list), "Problems");
    XLSX.writeFile(wb, "product-upload-problems.xlsx");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Upload products (Excel / CSV)</DialogTitle></DialogHeader>

        {!raw.length && !result && (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Download the template and fill one product per row (Name and Selling price are required).</li>
              <li>Upload the file. You will see every row checked before anything is saved.</li>
              <li>Products already in your list (same SKU, barcode or name) are updated; new ones are added with their opening stock.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={downloadProductTemplate}><Download className="h-4 w-4" /> Download template</Button>
              <Button onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" /> Choose file</Button>
            </div>
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground hover:border-primary/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}
            >
              <FileUp className="h-6 w-6" />
              Drop an .xlsx, .xls or .csv file here
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
            </label>
          </div>
        )}

        {!!raw.length && !result && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{fileName}</span>
              <Badge variant="secondary">{counts.total} rows</Badge>
              <Badge className="bg-emerald-600 hover:bg-emerald-600">{counts.create} new</Badge>
              <Badge className="bg-sky-600 hover:bg-sky-600">{counts.update} already in list</Badge>
              {counts.errors > 0 && <Badge variant="destructive">{counts.errors} with problems</Badge>}
              <Button variant="ghost" size="sm" className="ml-auto" onClick={reset} disabled={busy}>Choose another file</Button>
            </div>
            {unknownHeads.length > 0 && (
              <p className="text-xs text-amber-700">Ignored columns: {unknownHeads.join(", ")}</p>
            )}
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              <span>Update products that are already in the list<span className="block text-xs text-muted-foreground">Name, prices and details are updated. Their stock is not changed.</span></span>
              <Switch checked={updateExisting} onCheckedChange={setUpdateExisting} disabled={busy} />
            </label>
            <div className="max-h-[45vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Line</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Wholesale / Min</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.line} className={r.errors.length ? "bg-destructive/5" : ""}>
                      <TableCell className="text-xs text-muted-foreground">{r.line}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{[r.sku, r.barcode, r.unit].filter(Boolean).join(" · ")}</div>
                      </TableCell>
                      <TableCell className="text-xs">{r.category.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.purchase_price}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{r.selling_price}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.wholesale_price ?? "—"} / {r.min_selling_price ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.matchId ? <span className="text-xs text-muted-foreground">unchanged</span> : r.stock_quantity}</TableCell>
                      <TableCell className="text-xs">
                        {r.errors.length ? (
                          <span className="flex items-start gap-1 text-destructive"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{r.errors.join("; ")}</span>
                        ) : r.matchId ? (
                          <span className="text-sky-700">{updateExisting ? `Update (same ${r.matchBy})` : "Skip — already in list"}</span>
                        ) : (
                          <span className="text-emerald-700">New</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {busy && <Progress value={progress} />}
          </div>
        )}

        {result && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-base font-medium"><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Upload finished</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="New products" value={result.created} />
              <Stat label="Updated" value={result.updated} />
              <Stat label="Skipped" value={result.skipped} />
              <Stat label="Failed" value={result.failed.length} bad={result.failed.length > 0} />
            </div>
            {result.failed.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-md border p-2 text-xs text-destructive">
                {result.failed.map((f) => <li key={f.line}>Line {f.line} — {f.name}: {f.error}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {(counts.errors > 0 || (result?.failed.length ?? 0) > 0) && (
            <Button variant="outline" onClick={downloadProblems}><Download className="h-4 w-4" /> Problem rows</Button>
          )}
          {result ? (
            <>
              <Button variant="outline" onClick={reset}>Upload another file</Button>
              <Button onClick={() => { onOpenChange(false); reset(); }}>Done</Button>
            </>
          ) : raw.length ? (
            <Button onClick={run} disabled={busy || counts.create + (updateExisting ? counts.update : 0) === 0}>
              {busy ? `Uploading… ${progress}%` : `Upload ${counts.create + (updateExisting ? counts.update : 0)} products`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${bad ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
