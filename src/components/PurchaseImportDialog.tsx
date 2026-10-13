// Purchase upload from Excel / CSV. Every row is shown first and can be edited
// (name, code, qty, prices, batch, expiry). A row whose SKU / barcode / name is
// already in the product list adds stock to that product; other rows become new
// products. Same name or code twice — in the file or in the list — is pointed out.
// Nothing is saved until the purchase invoice itself is saved.
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AlertTriangle, Download, FileUp, Merge, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const db = supabase as any;

export type ImportProduct = { id: string; name: string; sku: string | null; barcode: string | null; purchase_price: number; selling_price: number };
export type ImportedLine = {
  product_id: string; quantity: string; purchase_price: string; discount: string;
  new_selling_price: string; batch_no: string; expiry_date: string;
};

const HEADERS = ["Name", "SKU", "Barcode", "Category", "Unit", "Qty", "Cost price", "Selling price", "Line discount", "Batch", "Expiry"] as const;
type Head = (typeof HEADERS)[number];
const ALIASES: Record<string, Head> = {
  name: "Name", "product name": "Name", product: "Name", item: "Name", "নাম": "Name",
  sku: "SKU", code: "SKU", "item code": "SKU",
  barcode: "Barcode", "bar code": "Barcode",
  category: "Category", type: "Category",
  unit: "Unit",
  qty: "Qty", quantity: "Qty", "purchase qty": "Qty", "পরিমাণ": "Qty",
  "cost price": "Cost price", cost: "Cost price", "purchase price": "Cost price", "buying price": "Cost price", tp: "Cost price", rate: "Cost price", "unit cost": "Cost price", "ক্রয়মূল্য": "Cost price",
  "selling price": "Selling price", "sell price": "Selling price", mrp: "Selling price", price: "Selling price", "new sell": "Selling price", "বিক্রয়মূল্য": "Selling price",
  "line discount": "Line discount", discount: "Line discount", disc: "Line discount",
  batch: "Batch", "batch no": "Batch", lot: "Batch",
  expiry: "Expiry", "expiry date": "Expiry", exp: "Expiry", "exp date": "Expiry",
};
const normHead = (h: string) => ALIASES[h.trim().toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/[_\s]+/g, " ").replace(/\s*৳\s*/g, "").trim()] ?? null;
const CATS: [string, string][] = [["pet food", "pet_food"], ["pet_food", "pet_food"], ["food", "pet_food"], ["medicine", "medicine"], ["ঔষধ", "medicine"], ["ওষুধ", "medicine"], ["vaccine", "medicine"], ["accessor", "accessory"], ["toy", "accessory"], ["service", "service"]];
const toCat = (s: string) => { const t = s.trim().toLowerCase(); return t ? CATS.find(([w]) => t.includes(w))?.[1] ?? "other" : "other"; };
const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const uid = () => Math.random().toString(36).slice(2, 10);

const toDate = (v: unknown): string => {
  if (v == null || v === "") return "";
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel date serial number → exact calendar date (no time-zone shift).
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); // day/month/year
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/); // month/year → last day of month
  if (m) { const last = new Date(Number(m[2]), Number(m[1]), 0).getDate(); return `${m[2]}-${m[1].padStart(2, "0")}-${String(last).padStart(2, "0")}`; }
  return s;
};
const numStr = (v: unknown) => String(v ?? "").replace(/[,৳\s]/g, "").replace(/tk/i, "");

type Line = {
  id: string; line: number;
  name: string; sku: string; barcode: string; category: string; unit: string;
  qty: string; cost: string; sell: string; disc: string; batch: string; expiry: string;
  /** "auto" = follow SKU / barcode / name; "new" = make a new product; else a chosen product id. */
  pick: string;
};

export function downloadPurchaseTemplate() {
  const ws = XLSX.utils.json_to_sheet([
    { Name: "Royal Canin Kitten 2kg", SKU: "RC-K2", Barcode: "", Category: "pet_food", Unit: "pcs", Qty: 10, "Cost price": 2100, "Selling price": 2450, "Line discount": 0, Batch: "B-101", Expiry: "2027-06-30" },
    { Name: "Ivermectin 1% 10ml", SKU: "", Barcode: "", Category: "medicine", Unit: "vial", Qty: 20, "Cost price": 120, "Selling price": 180, "Line discount": 0, Batch: "", Expiry: "" },
  ], { header: [...HEADERS] });
  ws["!cols"] = HEADERS.map((h) => ({ wch: Math.max(12, h.length + 4) }));
  const help = XLSX.utils.aoa_to_sheet([
    ["Column", "Required", "Notes"],
    ["Name", "Yes", "Same name as in your product list adds stock to that product"],
    ["Qty", "Yes", "Quantity bought"],
    ["Cost price", "Yes", "Purchase price per unit"],
    ["SKU / Barcode", "No", "Best way to match an existing product"],
    ["Selling price", "No", "New selling price (leave empty to keep the current one)"],
    ["Expiry", "No", "YYYY-MM-DD, DD/MM/YYYY or MM/YYYY"],
    ["Category / Unit", "No", "Only used when a NEW product is created"],
  ]);
  help["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Purchase");
  XLSX.utils.book_append_sheet(wb, help, "How to fill");
  XLSX.writeFile(wb, "purchase-upload-template.xlsx");
}

export function PurchaseImportDialog({
  open, onOpenChange, products, onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  products: ImportProduct[];
  /** Gets invoice lines (all with a product id). New products are already created. */
  onApply: (lines: ImportedLine[], createdCount: number) => Promise<void> | void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const idx = useMemo(() => {
    const by = (f: (p: ImportProduct) => string | null) => {
      const m = new Map<string, ImportProduct[]>();
      for (const p of products) { const k = key(f(p)); if (k) m.set(k, [...(m.get(k) ?? []), p]); }
      return m;
    };
    return { sku: by((p) => p.sku), barcode: by((p) => p.barcode), name: by((p) => p.name), byId: new Map(products.map((p) => [p.id, p])) };
  }, [products]);

  // Match + problems for every row (recomputed while editing).
  const view = useMemo(() => {
    const fileNames = new Map<string, number[]>(), fileCodes = new Map<string, number[]>();
    for (const l of lines) {
      const n = key(l.name); if (n) fileNames.set(n, [...(fileNames.get(n) ?? []), l.line]);
      for (const c of [key(l.sku), key(l.barcode)]) if (c) fileCodes.set(c, [...(fileCodes.get(c) ?? []), l.line]);
    }
    return lines.map((l) => {
      const errors: string[] = [], warnings: string[] = [];
      if (!l.name.trim()) errors.push("Name is empty");
      const q = Number(l.qty), c = Number(l.cost);
      if (!(q > 0)) errors.push("Qty must be more than 0");
      if (l.cost.trim() === "" || !(c >= 0)) errors.push("Cost price is missing");
      if (l.sell.trim() !== "" && !(Number(l.sell) >= 0)) errors.push("Selling price is not a number");
      if (l.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(l.expiry)) errors.push("Expiry date not understood");

      let match: ImportProduct | null = null, by = "", candidates: ImportProduct[] = [];
      if (l.pick !== "auto" && l.pick !== "new") { match = idx.byId.get(l.pick) ?? null; by = "chosen"; }
      else if (l.pick === "auto") {
        const s = idx.sku.get(key(l.sku)), b = idx.barcode.get(key(l.barcode)), n = idx.name.get(key(l.name));
        if (s?.length) { match = s[0]; by = "SKU"; }
        else if (b?.length) { match = b[0]; by = "barcode"; }
        else if (n?.length) { candidates = n; if (n.length === 1) { match = n[0]; by = "name"; } }
        if (candidates.length > 1) errors.push(`${candidates.length} products named "${l.name.trim()}" in your list — choose one`);
        if (match && by !== "name" && key(match.name) !== key(l.name)) warnings.push(`Code belongs to "${match.name.trim()}"`);
      }
      if (!match && l.pick !== "new" && candidates.length <= 1) {
        // Will be a new product: its code must not be used by another product.
        if (l.sku.trim() && idx.sku.get(key(l.sku))) errors.push("SKU already used by another product");
        if (l.barcode.trim() && idx.barcode.get(key(l.barcode))) errors.push("Barcode already used by another product");
      }
      if (l.pick === "new") {
        if (l.sku.trim() && idx.sku.get(key(l.sku))) errors.push("SKU already used — change it or match the product");
        if (l.barcode.trim() && idx.barcode.get(key(l.barcode))) errors.push("Barcode already used — change it or match the product");
        if (idx.name.get(key(l.name))) warnings.push("A product with this name already exists");
      }
      // The same product twice: fine for an existing product (stock adds up), but two NEW
      // products with the same name / code would make duplicates — merge them first.
      const sameName = (fileNames.get(key(l.name)) ?? []).filter((x) => x !== l.line);
      const sameCode = [...new Set([...(fileCodes.get(key(l.sku)) ?? []), ...(fileCodes.get(key(l.barcode)) ?? [])])].filter((x) => x !== l.line);
      const willBeNew = !match && candidates.length <= 1;
      if (sameName.length) (willBeNew ? errors : warnings).push(`Same name on line ${sameName.join(", ")}${willBeNew ? " — merge or rename" : ""}`);
      if ((l.sku.trim() || l.barcode.trim()) && sameCode.length) (willBeNew ? errors : warnings).push(`Same code on line ${sameCode.join(", ")}${willBeNew ? " — merge or change the code" : ""}`);
      return { l, match, by, candidates, errors, warnings, isNew: !match && !errors.some((e) => e.includes("choose one")) };
    });
  }, [lines, idx]);

  const counts = {
    total: view.length,
    errors: view.filter((v) => v.errors.length).length,
    warn: view.filter((v) => !v.errors.length && v.warnings.length).length,
    existing: view.filter((v) => !v.errors.length && v.match).length,
    fresh: view.filter((v) => !v.errors.length && v.isNew).length,
  };
  const total = view.reduce((a, v) => a + (Number(v.l.qty) || 0) * (Number(v.l.cost) || 0) - (Number(v.l.disc) || 0), 0);
  const dupGroups = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of lines) {
      const k = key(l.sku) || key(l.barcode) || key(l.name);
      if (k) m.set(k, [...(m.get(k) ?? []), l]);
    }
    return [...m.values()].filter((g) => g.length > 1);
  }, [lines]);

  const set = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const reset = () => { setLines([]); setFileName(""); if (fileRef.current) fileRef.current.value = ""; };

  const mergeDuplicates = () => {
    setLines((ls) => {
      const out: Line[] = [];
      const seen = new Map<string, Line>();
      for (const l of ls) {
        const k = key(l.sku) || key(l.barcode) || key(l.name);
        const first = k ? seen.get(k) : undefined;
        if (first && (first.cost === l.cost) && (first.batch === l.batch)) {
          first.qty = String((Number(first.qty) || 0) + (Number(l.qty) || 0));
          first.disc = String((Number(first.disc) || 0) + (Number(l.disc) || 0));
          continue;
        }
        const copy = { ...l };
        if (k && !first) seen.set(k, copy);
        out.push(copy);
      }
      const removed = ls.length - out.length;
      toast[removed ? "success" : "info"](removed ? `Merged ${removed} repeated row${removed > 1 ? "s" : ""} (qty added together)` : "Repeated rows have different cost or batch — edit them by hand");
      return out;
    });
  };

  const readFile = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false, raw: true }) as unknown[][];
      if (!grid.length) throw new Error("The file is empty");
      const mapped = grid[0].map((h) => normHead(String(h ?? "")));
      for (const need of ["Name", "Qty", "Cost price"] as Head[]) {
        if (!mapped.includes(need)) throw new Error(`No "${need}" column found. Download the template to see the columns.`);
      }
      const out: Line[] = [];
      grid.slice(1).forEach((cells, i) => {
        if (cells.every((c) => String(c ?? "").trim() === "")) return;
        const get = (k: Head) => { const j = mapped.indexOf(k); return j >= 0 ? cells[j] : ""; };
        const str = (k: Head) => String(get(k) ?? "").trim();
        out.push({
          id: uid(), line: i + 2, name: str("Name"), sku: str("SKU"), barcode: str("Barcode"),
          category: toCat(str("Category")), unit: str("Unit") || "pcs",
          qty: numStr(get("Qty")), cost: numStr(get("Cost price")), sell: numStr(get("Selling price")), disc: numStr(get("Line discount")),
          batch: str("Batch"), expiry: toDate(get("Expiry")), pick: "auto",
        });
      });
      if (!out.length) throw new Error("No rows found under the header");
      setLines(out);
      setFileName(file.name);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not read the file");
      reset();
    }
  };

  const apply = async () => {
    if (counts.errors) { toast.error("Fix the red rows first (or remove them)"); return; }
    setBusy(true);
    try {
      // 1) Create the new products (stock 0 — the purchase adds the stock).
      const fresh = view.filter((v) => v.isNew);
      const newIds = new Map<string, string>();
      if (fresh.length) {
        const { data, error } = await db.from("products").insert(fresh.map((v) => ({
          name: v.l.name.trim(), sku: v.l.sku.trim() || null, barcode: v.l.barcode.trim() || null,
          category: v.l.category, unit: v.l.unit || "pcs",
          purchase_price: Number(v.l.cost) || 0, selling_price: v.l.sell.trim() ? Number(v.l.sell) : Number(v.l.cost) || 0,
          stock_quantity: 0, is_active: true,
        }))).select("id,name,sku,barcode");
        if (error) throw new Error(`New products could not be created: ${error.message}`);
        // Match created rows back by code / name (order is kept by the insert).
        (data ?? []).forEach((p: any, i: number) => newIds.set(fresh[i].l.id, p.id));
      }
      // 2) Rename products where the file name was chosen for a code match.
      const out: ImportedLine[] = view.map((v) => ({
        product_id: v.match?.id ?? newIds.get(v.l.id) ?? "",
        quantity: v.l.qty,
        purchase_price: v.l.cost,
        discount: v.l.disc || "0",
        new_selling_price: v.l.sell,
        batch_no: v.l.batch,
        expiry_date: v.l.expiry,
      }));
      if (out.some((o) => !o.product_id)) throw new Error("Some rows have no product — check them");
      await onApply(out, fresh.length);
      toast.success(`${out.length} rows added to the invoice${fresh.length ? ` · ${fresh.length} new products created` : ""}. Check and save the invoice.`);
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add the rows");
    } finally {
      setBusy(false);
    }
  };

  const productOptions = (v: (typeof view)[number]) => {
    const list = v.candidates.length > 1 ? v.candidates : products.filter((p) => key(p.name).includes(key(v.l.name).split(" ")[0] ?? "")).slice(0, 30);
    return list;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Upload purchase (Excel / CSV)</DialogTitle></DialogHeader>

        {!lines.length ? (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Download the template and fill one product per row: Name, Qty and Cost price are required.</li>
              <li>Upload it. You will see every row first — you can change name, code, qty, prices, batch and expiry.</li>
              <li>A product already in your list (same SKU, barcode or name) gets the stock added. Others become new products.</li>
              <li>The rows go into the purchase invoice; save the invoice to add the stock.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={downloadPurchaseTemplate}><Download className="h-4 w-4" /> Download template</Button>
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
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{fileName}</span>
              <Badge variant="secondary">{counts.total} rows</Badge>
              <Badge className="bg-sky-600 hover:bg-sky-600">{counts.existing} add stock</Badge>
              <Badge className="bg-emerald-600 hover:bg-emerald-600">{counts.fresh} new products</Badge>
              {counts.warn > 0 && <Badge className="bg-amber-500 hover:bg-amber-500">{counts.warn} to check</Badge>}
              {counts.errors > 0 && <Badge variant="destructive">{counts.errors} to fix</Badge>}
              <span className="ml-auto font-semibold tabular-nums">Total ৳{total.toLocaleString("en-BD", { maximumFractionDigits: 2 })}</span>
            </div>
            {dupGroups.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" /> {dupGroups.length} product{dupGroups.length > 1 ? "s appear" : " appears"} more than once in the file.
                <Button size="sm" variant="outline" className="ml-auto h-7 bg-background" onClick={mergeDuplicates}><Merge className="h-3.5 w-3.5" /> Merge (add qty)</Button>
              </div>
            )}
            <div className="max-h-[52vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-10">Line</TableHead>
                    <TableHead className="min-w-[200px]">Name</TableHead>
                    <TableHead className="w-28">SKU / Barcode</TableHead>
                    <TableHead className="w-20">Qty</TableHead>
                    <TableHead className="w-24">Cost ৳</TableHead>
                    <TableHead className="w-24">Sell ৳</TableHead>
                    <TableHead className="w-24">Batch</TableHead>
                    <TableHead className="w-36">Expiry</TableHead>
                    <TableHead className="min-w-[220px]">Product in your list</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.map((v) => {
                    const l = v.l;
                    const cell = "h-8 min-w-[72px] px-2 text-sm";
                    return (
                      <TableRow key={l.id} className={v.errors.length ? "bg-destructive/5" : v.warnings.length ? "bg-amber-50/60 dark:bg-amber-950/10" : ""}>
                        <TableCell className="align-top text-xs text-muted-foreground">{l.line}</TableCell>
                        <TableCell className="align-top">
                          <Input className={cell} value={l.name} onChange={(e) => set(l.id, { name: e.target.value })} />
                          {(v.errors.length > 0 || v.warnings.length > 0) && (
                            <div className="mt-1 space-y-0.5 text-[11px]">
                              {v.errors.map((m) => <p key={m} className="text-destructive">✕ {m}</p>)}
                              {v.warnings.map((m) => <p key={m} className="text-amber-700">! {m}</p>)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="space-y-1 align-top">
                          <Input className={cell} value={l.sku} placeholder="SKU" onChange={(e) => set(l.id, { sku: e.target.value })} />
                          <Input className={cell} value={l.barcode} placeholder="Barcode" onChange={(e) => set(l.id, { barcode: e.target.value })} />
                        </TableCell>
                        <TableCell className="align-top"><Input className={cell} inputMode="decimal" value={l.qty} onChange={(e) => set(l.id, { qty: e.target.value })} /></TableCell>
                        <TableCell className="align-top"><Input className={cell} inputMode="decimal" value={l.cost} onChange={(e) => set(l.id, { cost: e.target.value })} /></TableCell>
                        <TableCell className="align-top">
                          <Input className={cell} inputMode="decimal" value={l.sell} placeholder={v.match ? String(v.match.selling_price) : ""} onChange={(e) => set(l.id, { sell: e.target.value })} />
                        </TableCell>
                        <TableCell className="align-top"><Input className={cell} value={l.batch} onChange={(e) => set(l.id, { batch: e.target.value })} /></TableCell>
                        <TableCell className="align-top"><Input className={cell} type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(l.expiry) ? l.expiry : ""} onChange={(e) => set(l.id, { expiry: e.target.value })} /></TableCell>
                        <TableCell className="align-top">
                          <Select value={l.pick} onValueChange={(x) => set(l.id, { pick: x })}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue>
                                {l.pick === "new" ? "➕ Make a new product" : v.match ? `✓ ${v.match.name.trim()}` : v.candidates.length > 1 ? "Choose which one…" : "➕ New product"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">Match automatically</SelectItem>
                              <SelectItem value="new">➕ Make a new product</SelectItem>
                              {productOptions(v).map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name.trim()}{p.sku ? ` · ${p.sku}` : ""}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {v.match && (
                            <p className="mt-1 text-[11px] text-sky-700">
                              Adds stock{v.by !== "chosen" ? ` · matched by ${v.by}` : ""} · now cost ৳{v.match.purchase_price}, sell ৳{v.match.selling_price}
                            </p>
                          )}
                          {v.isNew && !v.match && <p className="mt-1 text-[11px] text-emerald-700">New product will be created</p>}
                        </TableCell>
                        <TableCell className="align-top">
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Remove row" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {lines.length > 0 && <Button variant="ghost" onClick={reset} disabled={busy}>Choose another file</Button>}
          {lines.length > 0 && (
            <Button onClick={apply} disabled={busy || counts.errors > 0 || !lines.length}>
              {busy ? "Adding…" : counts.errors ? `Fix ${counts.errors} row${counts.errors > 1 ? "s" : ""} first` : `Add ${lines.length} rows to invoice`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
