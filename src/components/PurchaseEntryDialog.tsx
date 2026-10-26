// New purchase invoice — keyboard-first entry.
//
// Flow: search → Enter picks the product → Qty → Enter → Total (or Tab to Unit
// price) → Enter adds the line → focus returns to search. Ctrl+Enter saves.
// Saving still goes through the existing create_purchase_invoice RPC, which does
// stock and batches in one database transaction. Purchases are stock only:
// no payment or supplier due is recorded (accounts are kept separately).
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Keyboard, Plus, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PurchaseImportDialog, type ImportedLine } from "@/components/PurchaseImportDialog";
import { PurchaseItemSearch, type SearchProduct } from "@/components/PurchaseItemSearch";
import { todayDhaka } from "@/lib/sales-ledger";
import { cn } from "@/lib/utils";
import {
  exactUnitPrice, fmtField, invoiceTotals, lineAmounts, lineError, num, onQuantity, onTotal, onUnitPrice,
  type AmountKind, type LineInput,
} from "@/lib/purchase-calc";

export type EntryProduct = SearchProduct & { selling_price: number };
export type EntrySupplier = { id: string; name: string; phone: string | null; balance_due: number };

/** An existing purchase opened for editing. */
export type EditPurchase = {
  id: string; invoice_no: string; supplier_id: string | null; supplier_invoice_no: string | null; invoice_date: string;
  discount: number; vat: number; freight: number; notes: string | null; stock_only: boolean; paid: number;
  items: { product_id: string; quantity: number; discount: number; line_total: number; batch_no: string | null; expiry_date: string | null }[];
};

type Row = LineInput & {
  key: string;
  product_id: string;
  new_selling_price: string;
  batch_no: string;
  expiry_date: string;
  open?: boolean;
};

const money = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 });
let keySeq = 0;
const newKey = () => `r${++keySeq}`;
const emptyLine = (): LineInput => ({ quantity: "", unit_price: "", total: "", source: "unit", disc_value: "", disc_kind: "amt" });

/** Focus now (not on the next frame) and select the value so typing replaces it —
 *  fast typists and barcode scanners send the next key immediately. */
const focusSelect = (el: HTMLInputElement | null) => { el?.focus(); el?.select(); };

export function PurchaseEntryDialog({
  open, onOpenChange, suppliers, products, onCreated, startWithUpload = false, refreshProducts, editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suppliers: EntrySupplier[];
  products: EntryProduct[];
  onCreated: (created?: { id: string; invoice_no?: string }) => void;
  startWithUpload?: boolean;
  refreshProducts: () => Promise<unknown>;
  /** Open an existing purchase to change it (same invoice number; stock moves by the difference). */
  editing?: EditPurchase | null;
}) {
  const [uploadOpen, setUploadOpen] = useState(startWithUpload && !editing);
  const [supplierId, setSupplierId] = useState(editing?.supplier_id ?? "");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState(editing?.supplier_invoice_no ?? "");
  const [invoiceDate, setInvoiceDate] = useState(editing?.invoice_date ?? todayDhaka());
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() => (editing?.items ?? []).map((it) => {
    // Rebuild the line from its saved total, so the exact unit price comes back.
    const disc = Number(it.discount) || 0;
    const gross = Number(it.line_total) + disc;
    const p = products.find((x) => x.id === it.product_id);
    return {
      ...onTotal({ ...emptyLine(), quantity: fmtField(Number(it.quantity), 2) }, fmtField(gross, 2)),
      disc_value: disc ? fmtField(disc, 2) : "", disc_kind: "amt" as AmountKind,
      key: newKey(), product_id: it.product_id,
      new_selling_price: p?.selling_price ? String(p.selling_price) : "",
      batch_no: it.batch_no ?? "", expiry_date: it.expiry_date ?? "",
    };
  }));

  // Totals inputs
  const amt = (n?: number) => (Number(n) ? fmtField(Number(n), 2) : "");
  const [discValue, setDiscValue] = useState(amt(editing?.discount));
  const [discKind, setDiscKind] = useState<AmountKind>("amt");
  const [vatValue, setVatValue] = useState(amt(editing?.vat));
  const [vatKind, setVatKind] = useState<AmountKind>("amt");
  const [charges, setCharges] = useState(amt(editing?.freight));

  // Entry bar
  const [entryProduct, setEntryProduct] = useState<EntryProduct | null>(null);
  const [entry, setEntry] = useState<LineInput>(emptyLine());
  const [entryError, setEntryError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLInputElement>(null);
  const unitRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const totals = useMemo(
    () => invoiceTotals(rows, { overall_disc_value: discValue, overall_disc_kind: discKind, vat_value: vatValue, vat_kind: vatKind, charges }),
    [rows, discValue, discKind, vatValue, vatKind, charges],
  );
  const dirty = editing ? true : rows.length > 0 || !!entryProduct;

  // ---------- entry bar ----------
  const pickProduct = (p: SearchProduct) => {
    const full = productById.get(p.id);
    if (!full) return;
    const price = Number(full.purchase_price) || 0;
    // Commit now so the quantity box is enabled and filled before we focus it.
    flushSync(() => {
      setEntryProduct(full);
      setEntryError(null);
      setEntry({ ...emptyLine(), quantity: "1", unit_price: price ? fmtField(price, 4) : "", total: price ? fmtField(price, 2) : "", source: "unit" });
    });
    focusSelect(qtyRef.current);
  };

  const cancelEntry = () => {
    flushSync(() => {
      setEntryProduct(null);
      setEntry(emptyLine());
      setEntryError(null);
    });
    focusSelect(searchRef.current);
  };

  const addEntry = () => {
    if (!entryProduct) { focusSelect(searchRef.current); return; }
    const err = lineError(entry);
    if (err) {
      setEntryError(err);
      focusSelect(err.startsWith("Enter a quantity") ? qtyRef.current : entry.source === "total" ? totalRef.current : unitRef.current);
      return;
    }
    const p = entryProduct;
    flushSync(() => setRows((prev) => {
      // Same product at the same price with nothing else set → add to that line.
      const i = prev.findIndex((r) => r.product_id === p.id && !r.batch_no && !r.expiry_date && !r.disc_value
        && Math.abs(exactUnitPrice(r) - exactUnitPrice(entry)) < 1e-9);
      if (i >= 0) {
        const r = prev[i];
        const q = (num(r.quantity) ?? 0) + (num(entry.quantity) ?? 0);
        const merged = r.source === "total"
          ? onTotal({ ...r, quantity: fmtField(q, 2) }, fmtField((num(r.total) ?? 0) + (num(entry.total) ?? 0), 2))
          : onQuantity(r, fmtField(q, 2));
        return prev.map((x, j) => (j === i ? { ...x, ...merged } : x));
      }
      return [...prev, {
        ...entry, key: newKey(), product_id: p.id,
        new_selling_price: p.selling_price ? String(p.selling_price) : "", batch_no: "", expiry_date: "",
      }];
    }));
    flushSync(() => {
      setEntryProduct(null);
      setEntry(emptyLine());
      setEntryError(null);
    });
    focusSelect(searchRef.current);
  };

  const entryKeys = (field: "qty" | "total" | "unit") => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) return; // Ctrl+Enter is handled by the window (save)
      if (field === "qty") {
        if (lineError({ ...entry, unit_price: "0", source: "unit" })) { setEntryError("Enter a quantity above 0"); focusSelect(qtyRef.current); return; }
        setEntryError(null);
        focusSelect(totalRef.current);
      } else addEntry();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelEntry();
    }
  };

  // ---------- table ----------
  const updateRow = (key: string, fn: (r: Row) => Row) => setRows((prev) => prev.map((r) => (r.key === key ? fn(r) : r)));
  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const applyUpload = async (lines: ImportedLine[], created: number) => {
    if (created) await refreshProducts();
    setRows((prev) => [
      ...prev,
      ...lines.map((l): Row => ({
        ...onUnitPrice({ ...emptyLine(), quantity: l.quantity }, l.purchase_price),
        disc_value: Number(l.discount) ? l.discount : "",
        disc_kind: "amt",
        key: newKey(), product_id: l.product_id,
        new_selling_price: l.new_selling_price, batch_no: l.batch_no, expiry_date: l.expiry_date,
      })),
    ]);
  };

  // ---------- save ----------
  const create = useMutation({
    mutationFn: async () => {
      if (rows.length === 0) throw new Error("Add at least one product");
      const bad = rows.find((r) => lineError(r));
      if (bad) {
        updateRow(bad.key, (r) => ({ ...r, open: true }));
        throw new Error(`${productById.get(bad.product_id)?.name ?? "A line"}: ${lineError(bad)}`);
      }
      if ([discValue, vatValue, charges].some((v) => v.trim() !== "" && num(v) === null)) {
        throw new Error("Discount, VAT and charges must be numbers of 0 or more");
      }

      const items = rows.map((r) => ({
        product_id: r.product_id,
        quantity: num(r.quantity),
        purchase_price: exactUnitPrice(r),
        discount: lineAmounts(r).discount,
        new_selling_price: num(r.new_selling_price),
        batch_no: r.batch_no.trim() || null,
        expiry_date: r.expiry_date || null,
      }));

      if (editing) {
        const { data, error } = await supabase.rpc("update_purchase_invoice" as any, {
          _invoice_id: editing.id,
          _supplier_id: supplierId || null,
          _supplier_invoice_no: supplierInvoiceNo.trim() || null,
          _invoice_date: invoiceDate,
          _items: items,
          _discount: totals.overallDiscount,
          _vat: totals.vat,
          _freight: totals.charges,
          _notes: notes.trim() || null,
        });
        if (error) {
          if (/update_purchase_invoice|PGRST202|schema cache/i.test(`${error.message} ${(error as any).code ?? ""}`)) {
            throw new Error("Run the purchase edit SQL in Supabase first, then save again. Nothing was changed.");
          }
          throw error;
        }
        return data as any;
      }

      const { data, error } = await supabase.rpc("create_purchase_invoice" as any, {
        _supplier_id: supplierId || null,
        _supplier_invoice_no: supplierInvoiceNo.trim() || null,
        _invoice_date: invoiceDate,
        _items: items,
        _discount: totals.overallDiscount,
        _vat: totals.vat,
        _freight: totals.charges,
        _paid: 0,
        _payment_method: "cash" as any,
        _notes: notes.trim() || null,
        // Goods into stock only: no payment, cash or supplier due (accounts are kept separately).
        _stock_only: true,
      });
      if (error) {
        if (/create_purchase_invoice|_stock_only|PGRST202|schema cache/i.test(`${error.message} ${(error as any).code ?? ""}`)) {
          throw new Error("Run the new purchase SQL (stock only) in Supabase first, then save again. Nothing was saved.");
        }
        throw error;
      }
      return data as any;
    },
    onSuccess: (data) => {
      toast.success(editing ? `Purchase ${editing.invoice_no} updated` : `Purchase ${data?.invoice_no ?? ""} saved`);
      onCreated(data ? { id: data.id, invoice_no: data.invoice_no } : undefined);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save the purchase"),
  });

  const save = () => {
    // One save at a time, even with a double-click or a held Ctrl+Enter.
    if (saving.current || create.isPending) return;
    saving.current = true;
    create.mutate(undefined, { onSettled: () => { saving.current = false; } });
  };

  const requestClose = (v: boolean) => {
    if (v) return onOpenChange(true);
    if (create.isPending) return;
    if (dirty && !confirm(editing ? "Close without saving? Your changes will be lost." : "Close without saving? The products you added will be lost.")) return;
    onOpenChange(false);
  };

  const entryProductLabel = entryProduct
    ? [entryProduct.sku && `SKU ${entryProduct.sku}`, entryProduct.unit, `Stock ${qtyFmt(entryProduct.stock_quantity)}`, `Last cost ৳${qtyFmt(entryProduct.purchase_price)}`].filter(Boolean).join("   ")
    : null;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        className="flex h-[96vh] max-h-[96vh] max-w-6xl flex-col gap-0 overflow-y-auto p-0 sm:p-0 md:overflow-hidden"
        onEscapeKeyDown={(e) => { if (dirty) e.preventDefault(); }}
        onInteractOutside={(e) => { if (dirty) e.preventDefault(); }}
        onOpenAutoFocus={(e) => { e.preventDefault(); if (!startWithUpload) requestAnimationFrame(() => focusSelect(searchRef.current)); }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key.toLowerCase() === "s")) { e.preventDefault(); save(); }
          else if (e.key === "F2") { e.preventDefault(); focusSelect(searchRef.current); }
        }}
      >
        {/* Header: supplier + invoice details */}
        <div className="border-b px-4 py-3 pr-12 sm:px-5">
          <DialogTitle className="text-lg font-semibold">{editing ? `Edit purchase ${editing.invoice_no}` : "New purchase"}</DialogTitle>
          <DialogDescription className="sr-only">Add products with the keyboard and save the purchase invoice.</DialogDescription>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,160px)]">
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="h-9" aria-label="Supplier"><SelectValue placeholder="Supplier (optional)" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input className="h-9" value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} placeholder="Supplier invoice no." aria-label="Supplier invoice number" />
            <Input className="h-9" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} aria-label="Invoice date" />
          </div>
        </div>

        {/* Entry bar */}
        <div className="border-b bg-muted/40 px-4 py-3 sm:px-5">
          <div className="grid grid-cols-3 gap-2 md:grid-cols-[minmax(0,1fr)_96px_140px_140px_auto]">
            <PurchaseItemSearch
              ref={searchRef}
              className="col-span-3 md:col-span-1"
              products={products}
              onPick={pickProduct}
              onNoMatch={(q) => toast.error(`No product for "${q}". Create it in Inventory or use Upload Excel.`)}
            />
            <EntryField label="Qty" suffix={entryProduct?.unit ?? undefined}>
              <input ref={qtyRef} inputMode="decimal" disabled={!entryProduct} value={entry.quantity}
                onChange={(e) => { setEntryError(null); setEntry((l) => onQuantity(l, e.target.value)); }}
                onKeyDown={entryKeys("qty")} className={entryInput} aria-label="Quantity" />
            </EntryField>
            <EntryField label="Total ৳" active={entry.source === "total" && !!entryProduct}>
              <input ref={totalRef} inputMode="decimal" disabled={!entryProduct} value={entry.total}
                onChange={(e) => { setEntryError(null); setEntry((l) => onTotal(l, e.target.value)); }}
                onKeyDown={entryKeys("total")} className={entryInput} aria-label="Total purchase amount" />
            </EntryField>
            <EntryField label="Unit price ৳" active={entry.source === "unit" && !!entryProduct}>
              <input ref={unitRef} inputMode="decimal" disabled={!entryProduct} value={entry.unit_price}
                onChange={(e) => { setEntryError(null); setEntry((l) => onUnitPrice(l, e.target.value)); }}
                onKeyDown={entryKeys("unit")} className={entryInput} aria-label="Per unit purchase price" />
            </EntryField>
            <Button type="button" className="col-span-3 h-11 md:col-span-1" disabled={!entryProduct} onClick={addEntry}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
          <div className="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
            {entryProduct ? (
              <p className="min-w-0 truncate">
                <span className="font-medium">{entryProduct.name}</span>
                <span className="ml-3 text-muted-foreground">{entryProductLabel}</span>
                {entryError && <span className="ml-3 font-medium text-destructive">{entryError}</span>}
              </p>
            ) : (
              <p className="hidden items-center gap-1.5 text-muted-foreground md:flex">
                <Keyboard className="h-3.5 w-3.5" />
                <Kbd>↑</Kbd><Kbd>↓</Kbd> choose, <Kbd>Enter</Kbd> next field, <Kbd>Enter</Kbd> on a price adds the line, <Kbd>Esc</Kbd> cancel, <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> save
              </p>
            )}
            <button type="button" onClick={() => setUploadOpen(true)} className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              <Upload className="h-3.5 w-3.5" /> Upload Excel / CSV
            </button>
          </div>
        </div>

        {/* Lines */}
        <div className="shrink-0 overflow-x-auto md:min-h-0 md:flex-1 md:shrink md:overflow-auto">
          {rows.length === 0 ? (
            <div className="flex min-h-32 items-center md:h-full justify-center px-6 py-10 text-center text-sm text-muted-foreground">
              No products yet. Search above, or upload the supplier&apos;s Excel list.
            </div>
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th className="w-8 py-2 pl-4 text-left font-medium">#</th>
                  <th className="py-2 text-left font-medium">Product</th>
                  <th className="w-16 py-2 text-left font-medium">Unit</th>
                  <th className="w-24 py-2 text-right font-medium">Qty</th>
                  <th className="w-28 py-2 text-right font-medium">Unit price</th>
                  <th className="w-28 py-2 text-right font-medium">Total</th>
                  <th className="w-36 py-2 text-right font-medium">Item discount</th>
                  <th className="w-28 py-2 text-right font-medium">Final</th>
                  <th className="w-20 py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = productById.get(r.product_id);
                  const a = lineAmounts(r);
                  const err = lineError(r);
                  return (
                    <RowView key={r.key} r={r} i={i} p={p} a={a} err={err}
                      onChange={(fn) => updateRow(r.key, fn)} onRemove={() => removeRow(r.key)} />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Totals + payment */}
        <div className="grid gap-4 border-t bg-muted/30 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="text-xs text-muted-foreground">
              {rows.length} line{rows.length === 1 ? "" : "s"}, {qtyFmt(rows.reduce((s, r) => s + (num(r.quantity) ?? 0), 0))} items
            </div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" className="min-h-0 resize-none text-sm" />
          </div>
          <div className="space-y-1.5 text-sm">
            <TotalLine label="Gross subtotal" value={money(totals.gross)} />
            <TotalLine label="Item discount" value={totals.itemDiscount ? `− ${money(totals.itemDiscount)}` : money(0)} muted />
            <AmountLine label="Overall discount" value={discValue} kind={discKind} onValue={setDiscValue} onKind={setDiscKind} result={totals.overallDiscount ? `− ${money(totals.overallDiscount)}` : money(0)} />
            <AmountLine label="VAT / tax" value={vatValue} kind={vatKind} onValue={setVatValue} onKind={setVatKind} result={money(totals.vat)} />
            <AmountLine label="Additional charges" value={charges} onValue={setCharges} result={money(totals.charges)} />
            <div className="flex items-baseline justify-between border-t pt-2">
              <span className="font-semibold">Purchase total</span>
              <span className="text-2xl font-bold tabular-nums">{money(totals.net)}</span>
            </div>
            <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
              {editing
                ? <>Saving changes stock by the difference only (same invoice number).{!editing.stock_only && Number(editing.paid) > 0 ? ` Paid ${money(Number(editing.paid))} stays; the supplier due is recalculated.` : ""}</>
                : "Stock only: products go into stock. No payment, cash or supplier due is recorded — accounts are kept separately."}
            </p>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => requestClose(false)} disabled={create.isPending}>Cancel</Button>
              <Button type="button" className="flex-[2]" onClick={save} disabled={create.isPending || rows.length === 0}>
                {create.isPending ? "Saving…" : <>{editing ? "Save changes" : "Save purchase"} <span className="ml-1 hidden text-xs opacity-75 sm:inline">Ctrl+Enter</span></>}
              </Button>
            </div>
          </div>
        </div>

        <PurchaseImportDialog open={uploadOpen} onOpenChange={setUploadOpen} products={products} onApply={applyUpload} />
      </DialogContent>
    </Dialog>
  );
}

const entryInput =
  "h-11 w-full rounded-lg border border-input bg-background px-3 pt-3 text-right text-[15px] font-medium tabular-nums outline-none transition-shadow focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50";

function EntryField({ label, suffix, active, children }: { label: string; suffix?: string; active?: boolean; children: ReactNode }) {
  return (
    <label className="relative block min-w-0">
      <span className={cn("pointer-events-none absolute left-2.5 top-1 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
        {label}{suffix ? ` (${suffix})` : ""}
      </span>
      {children}
    </label>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-background px-1 font-sans text-[10px] font-medium text-foreground">{children}</kbd>;
}

const cellInput =
  "h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-right tabular-nums outline-none hover:border-input focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20";

function RowView({ r, i, p, a, err, onChange, onRemove }: {
  r: Row; i: number; p?: EntryProduct; a: { gross: number; discount: number; final: number }; err: string | null;
  onChange: (fn: (r: Row) => Row) => void; onRemove: () => void;
}) {
  // Enter inside a table cell just leaves the cell; it never saves the invoice.
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
  };
  return (
    <>
      <tr className={cn("border-b align-middle", err && "bg-destructive/5")}>
        <td className="py-1.5 pl-4 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
        <td className="min-w-0 py-1.5 pr-2">
          <div className="truncate font-medium">{p?.name ?? "Unknown product"}</div>
          <div className="truncate text-xs text-muted-foreground">
            {[p?.sku && `SKU ${p.sku}`, r.batch_no && `Batch ${r.batch_no}`, r.expiry_date && `Exp ${r.expiry_date}`].filter(Boolean).join("   ") || " "}
            {err && <span className="ml-2 font-medium text-destructive">{err}</span>}
          </div>
        </td>
        <td className="py-1.5 text-xs text-muted-foreground">{p?.unit || "—"}</td>
        <td className="py-1.5"><input className={cellInput} inputMode="decimal" value={r.quantity} aria-label="Quantity"
          onChange={(e) => onChange((x) => ({ ...x, ...onQuantity(x, e.target.value) }))} onKeyDown={blurOnEnter} /></td>
        <td className="py-1.5"><input className={cn(cellInput, r.source === "unit" && "font-semibold")} inputMode="decimal" value={r.unit_price} aria-label="Unit price"
          onChange={(e) => onChange((x) => ({ ...x, ...onUnitPrice(x, e.target.value) }))} onKeyDown={blurOnEnter} /></td>
        <td className="py-1.5"><input className={cn(cellInput, r.source === "total" && "font-semibold")} inputMode="decimal" value={r.total} aria-label="Total amount"
          onChange={(e) => onChange((x) => ({ ...x, ...onTotal(x, e.target.value) }))} onKeyDown={blurOnEnter} /></td>
        <td className="py-1.5">
          <div className="flex items-center justify-end gap-1">
            <input className={cn(cellInput, "w-20")} inputMode="decimal" value={r.disc_value} placeholder="0" aria-label="Item discount"
              onChange={(e) => onChange((x) => ({ ...x, disc_value: e.target.value }))} onKeyDown={blurOnEnter} />
            <KindToggle kind={r.disc_kind} onKind={(k) => onChange((x) => ({ ...x, disc_kind: k }))} />
          </div>
          {r.disc_kind === "pct" && a.discount > 0 && <div className="pr-1 text-right text-[11px] text-muted-foreground tabular-nums">− {money(a.discount)}</div>}
        </td>
        <td className="py-1.5 pr-1 text-right font-semibold tabular-nums">{money(a.final)}</td>
        <td className="py-1.5 pr-3">
          <div className="flex justify-end">
            <button type="button" onClick={() => onChange((x) => ({ ...x, open: !x.open }))} title="Batch, expiry and selling price"
              aria-expanded={!!r.open} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              {r.open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <button type="button" onClick={onRemove} title="Remove line" className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
      {r.open && (
        <tr className="border-b bg-muted/30">
          <td />
          <td colSpan={8} className="py-2 pr-4">
            <div className="grid max-w-2xl grid-cols-3 gap-3">
              <label className="text-xs text-muted-foreground">Batch no.
                <Input className="mt-1 h-8" value={r.batch_no} onChange={(e) => onChange((x) => ({ ...x, batch_no: e.target.value }))} onKeyDown={blurOnEnter} />
              </label>
              <label className="text-xs text-muted-foreground">Expiry date
                <Input className="mt-1 h-8" type="date" value={r.expiry_date} onChange={(e) => onChange((x) => ({ ...x, expiry_date: e.target.value }))} />
              </label>
              <label className="text-xs text-muted-foreground">New selling price ৳{p ? ` (now ${qtyFmt(p.selling_price)})` : ""}
                <Input className="mt-1 h-8 text-right" inputMode="decimal" value={r.new_selling_price} onChange={(e) => onChange((x) => ({ ...x, new_selling_price: e.target.value }))} onKeyDown={blurOnEnter} />
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function KindToggle({ kind, onKind }: { kind: AmountKind; onKind: (k: AmountKind) => void }) {
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border text-xs font-semibold" role="group" aria-label="Amount or percent">
      {(["amt", "pct"] as const).map((k) => (
        <button key={k} type="button" aria-pressed={kind === k} onClick={() => onKind(k)}
          className={cn("min-w-6 px-1.5 py-1", kind === k ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground")}>
          {k === "amt" ? "৳" : "%"}
        </button>
      ))}
    </div>
  );
}

function TotalLine({ label, value, muted, danger }: { label: string; value: string; muted?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", muted && "text-muted-foreground", danger && "font-semibold text-destructive")}>{value}</span>
    </div>
  );
}

function AmountLine({ label, value, kind, onValue, onKind, result }: {
  label: string; value: string; kind?: AmountKind; onValue: (v: string) => void; onKind?: (k: AmountKind) => void; result: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,130px)_minmax(0,110px)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,130px)_minmax(0,140px)]">
      <span className="leading-tight text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Input className="h-8 min-w-0 text-right tabular-nums" inputMode="decimal" value={value} placeholder="0" aria-label={label}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) e.preventDefault(); }} />
        {kind && onKind && <KindToggle kind={kind} onKind={onKind} />}
      </div>
      <span className="text-right tabular-nums">{result}</span>
    </div>
  );
}
