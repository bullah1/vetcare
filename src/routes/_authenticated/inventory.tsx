import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Search, AlertTriangle, Truck, PackagePlus, Printer, Wand2, ClipboardEdit, FileDown, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { fuzzyMatch, codeMatch, type MatchRange } from "@/lib/fuzzy-search";
import { HighlightText } from "@/components/HighlightText";
import { PageHeader } from "@/components/PageHeader";
import { exportToExcel } from "@/lib/export-excel";
import { DOSE_FORMS, inferDoseForm } from "@/lib/clinical-master";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MobileFilterBar } from "@/components/MobileFilterBar";

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { ProductImageUpload, resolveProductImageUrl } from "@/components/ProductImageUpload";
import { StockCountDialog } from "@/components/StockCountDialog";
import { BarcodeLabelDialog, type LabelProduct } from "@/components/BarcodeLabelDialog";
import { printLabelsBatch } from "@/lib/barcode-labels";
import { refreshAppData } from "@/lib/refresh-data";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Pet Care Vet ERP" }] }),
  component: InventoryPage,
});

const CATEGORIES = ["medicine", "pet_food", "accessory", "service", "other"] as const;

function generateBarcode() {
  // CODE128-friendly: prefix + last 10 digits of timestamp + 2 random digits
  const ts = Date.now().toString().slice(-10);
  const rand = Math.floor(Math.random() * 90 + 10);
  return `PC${ts}${rand}`;
}

function printLabels(product: { name: string; selling_price: number; barcode: string | null }, copies: number) {
  if (!product.barcode) { toast.error("Set a barcode first"); return; }
  printLabelsBatch([{ name: product.name, selling_price: product.selling_price, barcode: product.barcode, copies }]);
}



function InventoryPage() {
  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Products, suppliers, and stock movements."
        icon={Package}
      />
      <Tabs defaultValue="products">
        <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-4"><ProductsTab /></TabsContent>
        <TabsContent value="suppliers" className="mt-4"><SuppliersTab /></TabsContent>
        <TabsContent value="purchases" className="mt-4"><PurchasesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* -------------------- Products -------------------- */

function ProductThumb({ path, name }: { path: string | null; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveProductImageUrl(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!url) {
    return (
      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground shrink-0">
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return <img src={url} alt={name} loading="lazy" decoding="async" className="h-8 w-8 rounded object-cover border shrink-0" />;
}


type Product = {
  id: string; name: string; sku: string | null; barcode: string | null;
  category: string; unit: string | null; purchase_price: number; selling_price: number;
  tax_percent: number; stock_quantity: number; low_stock_threshold: number;
  is_active: boolean; description: string | null; image_url: string | null;
};

function ProductsTab() {
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const queryClient = useQueryClient();

  const deleteMut = useMutation({
    mutationFn: async (p: Product) => {
      const { error } = await supabase.from("products").delete().eq("id", p.id);
      if (error) {
        // FK constraint: product has sales/purchases history — soft-deactivate instead
        if ((error as { code?: string }).code === "23503" || /foreign key/i.test(error.message)) {
          const { error: upErr } = await supabase.from("products").update({ is_active: false }).eq("id", p.id);
          if (upErr) throw upErr;
          return "deactivated" as const;
        }
        throw error;
      }
      return "deleted" as const;
    },
    onSuccess: (result, p) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      if (result === "deleted") toast.success(`"${p.name}" deleted`);
      else toast.info(`"${p.name}" has sales/purchase history — marked Inactive instead of deleting`);
      setDeleting(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      // Paged — products after the first 1000 were missing from Inventory.
      return fetchAll<Product>(() => supabase.from("products").select("*").order("name").order("id"));
    },
  });

  const availableCategories = Array.from(new Set(products.map((p) => p.category))).sort();

  // Typo-tolerant name search; matched words are highlighted in the list.
  const searchRanges = useMemo(() => {
    const map = new Map<string, MatchRange[]>();
    const s = q.trim();
    if (!s) return map;
    for (const p of products) {
      const m = fuzzyMatch(p.name, s);
      if (m) map.set(p.id, m.ranges);
      else if (codeMatch(p.sku, s) || codeMatch(p.barcode, s)) map.set(p.id, []);
    }
    return map;
  }, [products, q]);

  const filtered = products.filter((p) => {
    const matchesSearch = !q.trim() || searchRanges.has(p.id);
    const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
    const stock = Number(p.stock_quantity);
    const threshold = Number(p.low_stock_threshold);
    const matchesStock =
      stockFilter === "all" ||
      (stockFilter === "low" && stock > 0 && stock <= threshold) ||
      (stockFilter === "out" && stock <= 0) ||
      (stockFilter === "in" && stock > threshold);
    return matchesSearch && matchesCategory && matchesStock;
  });

  const lowStockCount = products.filter((p) => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.low_stock_threshold)).length;
  const outCount = products.filter((p) => Number(p.stock_quantity) <= 0).length;

  const labelProducts: LabelProduct[] = useMemo(() => {
    const source = selected.size > 0
      ? products.filter((p) => selected.has(p.id) && p.barcode)
      : filtered.filter((p) => p.barcode);
    return source.map((p) => {
      const stock = Math.max(0, Math.floor(Number(p.stock_quantity) || 0));
      return {
        id: p.id,
        name: p.name,
        selling_price: Number(p.selling_price),
        barcode: p.barcode,
        sku: p.sku,
        badge: {
          label: `Stock ${stock}`,
          tone: stock <= 0 ? "destructive" : stock <= Number(p.low_stock_threshold || 0) ? "secondary" : "outline",
        } as LabelProduct["badge"],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, selected, q, categoryFilter, stockFilter]);

  return (
    <div className="space-y-4">
      <MobileFilterBar
        search={{ value: q, onChange: setQ, placeholder: "Search products, SKU, barcode…" }}
        groups={[
          {
            key: "category",
            label: "Category",
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: [
              { value: "all", label: "All categories" },
              ...availableCategories.map((c) => ({ value: c, label: c })),
            ],
          },
          {
            key: "stock",
            label: "Stock",
            value: stockFilter,
            onChange: setStockFilter,
            options: [
              { value: "all", label: "All stock" },
              { value: "low", label: `Low stock (${lowStockCount})` },
              { value: "out", label: `Out of stock (${outCount})` },
              { value: "in", label: "In stock" },
            ],
          },
        ]}
        onClear={() => { setQ(""); setCategoryFilter("all"); setStockFilter("all"); }}
      />
      <div className="flex flex-wrap items-center gap-2">

        <div className="ml-auto text-xs text-muted-foreground hidden sm:block">
          {filtered.length} of {products.length}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (filtered.length === 0) { toast.error("No products to export"); return; }
            exportToExcel(
              filtered.map((p) => ({
                Name: p.name,
                SKU: p.sku ?? "",
                Barcode: p.barcode ?? "",
                Category: p.category,
                Unit: p.unit ?? "",
                "Purchase Price": Number(p.purchase_price),
                "Selling Price": Number(p.selling_price),
                "Tax %": Number(p.tax_percent),
                Stock: Number(p.stock_quantity),
                "Low Stock Alert": Number(p.low_stock_threshold),
                "Stock Value": Number(p.stock_quantity) * Number(p.purchase_price),
                Status: p.is_active ? "Active" : "Inactive",
              })),
              "product-list",
              "Products",
            );
            toast.success(`Exported ${filtered.length} products`);
          }}
        >
          <FileDown className="h-4 w-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCountOpen(true)}>
          <ClipboardEdit className="h-4 w-4" /> Stock Adjustment
        </Button>
        <StockCountDialog open={countOpen} onOpenChange={setCountOpen} products={filtered} />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const count = selected.size > 0
              ? products.filter((p) => selected.has(p.id) && p.barcode).length
              : filtered.filter((p) => p.barcode).length;
            if (count === 0) { toast.error("No products with barcode found"); return; }
            setBulkOpen(true);
          }}
        >
          <Printer className="h-4 w-4" /> Barcode Labels{selected.size > 0 ? ` (${selected.size})` : ""}
        </Button>

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New product</Button>
          </DialogTrigger>
          <ProductDialog key={editing?.id ?? "new"} product={editing} onDone={() => setOpen(false)} />
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={filtered.length > 0 && filtered.every((p) => selected.has(p.id))}
                    onCheckedChange={(v) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (v) filtered.forEach((p) => { if (p.barcode) next.add(p.id); });
                        else filtered.forEach((p) => next.delete(p.id));
                        return next;
                      });
                    }}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">Loading...</TableCell></TableRow>}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No products yet.</TableCell></TableRow>
              )}
              {filtered.map((p) => {
                const low = Number(p.stock_quantity) <= Number(p.low_stock_threshold);
                return (
                  <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        disabled={!p.barcode}
                        checked={selected.has(p.id)}
                        onCheckedChange={(v) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(p.id); else next.delete(p.id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${p.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <ProductThumb path={p.image_url} name={p.name} />
                        <HighlightText text={p.name} ranges={searchRanges.get(p.id)} />
                        {!p.is_active && <Badge variant="secondary" className="ml-1">Inactive</Badge>}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{p.category}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.sku ?? "—"}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{p.barcode ?? "—"}</TableCell>
                    <TableCell className="text-right">৳ {Number(p.selling_price).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <span className={low ? "text-destructive font-medium" : ""}>
                        {Number(p.stock_quantity)} {p.unit ?? ""}
                      </span>
                      {low && <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-destructive" />}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Adjust stock"
                          onClick={() => setAdjusting(p)}
                        >
                          <ClipboardEdit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={p.barcode ? `Print ${Math.max(1, Math.floor(Number(p.stock_quantity) || 0))} label(s) — stock qty` : "No barcode — edit product first"}
                          disabled={!p.barcode}
                          onClick={() => printLabels(p, Math.max(1, Math.floor(Number(p.stock_quantity) || 0)))}

                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setOpen(true); }}>Edit</Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            title="Delete product"
                            onClick={() => setDeleting(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <QuickAdjustDialog product={adjusting} onOpenChange={(v) => { if (!v) setAdjusting(null); }} />
      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.name}" স্থায়ীভাবে মুছে যাবে। যদি এই প্রোডাক্টের sales/purchase history থাকে, সেটি মোছা যাবে না — সেক্ষেত্রে প্রোডাক্টটি "Inactive" হিসেবে চিহ্নিত হবে।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && deleteMut.mutate(deleting)}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <BarcodeLabelDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        products={labelProducts}
        hint="Copies default to 0 — use the +/− buttons or quick-set rows to choose how many labels to print. Stock is never changed by printing."
        onDone={() => { setBulkOpen(false); setSelected(new Set()); }}
      />
    </div>
  );
}

const ADJUST_REASONS = [
  { value: "damage", label: "Damaged / Broken" },
  { value: "loss", label: "Lost / Missing" },
  { value: "found", label: "Found / Extra" },
  { value: "correction", label: "Manual Correction" },
  { value: "expired", label: "Expired" },
  { value: "other", label: "Other" },
] as const;

function QuickAdjustDialog({ product, onOpenChange }: { product: Product | null; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<string>("damage");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() { setDirection("out"); setQty(""); setReason("damage"); setNotes(""); }

  async function submit() {
    if (!product) return;
    const n = Number(qty);
    if (!n || n <= 0) return toast.error("Quantity must be greater than 0");
    setSaving(true);
    const change = direction === "in" ? n : -n;
    const { error } = await supabase.rpc("adjust_stock" as never, {
      _product_id: product.id,
      _quantity_change: change,
      _reason: reason,
      _notes: notes.trim() || null,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Stock updated");
    refreshAppData();
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stock-adjustments"] });
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={!!product} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Stock — {product?.name}</DialogTitle>
        </DialogHeader>
        {product && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-3 text-sm">
              Current stock: <b>{Number(product.stock_quantity)} {product.unit ?? ""}</b>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Direction</Label>
                <Select value={direction} onValueChange={(v: "in" | "out") => setDirection(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="out">➖ Decrease</SelectItem>
                    <SelectItem value="in">➕ Increase</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Quantity</Label>
                <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div>
              <Label>Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADJUST_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 500))} rows={2} placeholder="Batch #, cause, reference..." />
            </div>
            {qty && (
              <div className="rounded-md bg-muted p-3 text-sm">
                After: <b>{Number(product.stock_quantity) + (direction === "in" ? Number(qty) : -Number(qty))} {product.unit ?? ""}</b>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !qty}>{saving ? "Saving..." : "Save Adjustment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ product, onDone }: { product: Product | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    category: product?.category ?? "medicine",
    unit: product?.unit ?? "pcs",
    purchase_price: product?.purchase_price ?? 0,
    selling_price: product?.selling_price ?? 0,
    tax_percent: product?.tax_percent ?? 0,
    stock_quantity: product?.stock_quantity ?? 0,
    low_stock_threshold: product?.low_stock_threshold ?? 5,
    description: product?.description ?? "",
    is_active: product?.is_active ?? true,
    image_url: product?.image_url ?? null as string | null,
    is_prescribable: (product as any)?.is_prescribable ?? false,
    dose_form: inferDoseForm(product?.name) ?? (product as any)?.dose_form ?? "tablet",
    dose_unit: (product as any)?.dose_unit ?? "",
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        ...form,
        sku: form.sku?.trim() ? form.sku.trim() : null,
        barcode: form.barcode?.trim() ? form.barcode.trim() : null,
        dose_form: form.is_prescribable ? form.dose_form : null,
        dose_unit: form.is_prescribable && form.dose_unit.trim() ? form.dose_unit.trim() : null,
      };
      if (product) {
        const { error } = await supabase.from("products").update(payload).eq("id", product.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(product ? "Product updated" : "Product created");
      qc.invalidateQueries({ queryKey: ["products"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>{product ? "Edit product" : "New product"}</DialogTitle></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Unit</Label>
          <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs, box, kg" />
        </div>
        <div className="space-y-2 rounded-md border p-3 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={form.is_prescribable}
              onChange={(e) => setForm({ ...form, is_prescribable: e.target.checked })}
            />
            Prescribable medicine (shows in the doctor&apos;s medicine picker)
          </label>
          {form.is_prescribable && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Dose form</Label>
                <Select value={form.dose_form} onValueChange={(v) => setForm({ ...form, dose_form: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOSE_FORMS.map((d) => (
                      <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Dose unit (optional)</Label>
                <Input
                  value={form.dose_unit}
                  onChange={(e) => setForm({ ...form, dose_unit: e.target.value })}
                  placeholder="tablet, ml, sachet"
                />
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>SKU</Label>
          <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Barcode</Label>
          <div className="flex gap-2">
            <Input
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              placeholder="Scan or type…"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Auto-generate"
              onClick={() => setForm({ ...form, barcode: generateBarcode() })}
            >
              <Wand2 className="h-4 w-4" />
            </Button>
            {product?.barcode && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Print label"
                onClick={() => printLabels(product, 1)}
              >
                <Printer className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Purchase price</Label>
          <Input type="number" step="0.01" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: Number(e.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label>Selling price</Label>
          <Input type="number" step="0.01" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: Number(e.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label>Tax %</Label>
          <Input type="number" step="0.01" value={form.tax_percent} onChange={(e) => setForm({ ...form, tax_percent: Number(e.target.value) })} />
        </div>
        <div className="space-y-2">
          <Label>Low stock threshold</Label>
          <Input type="number" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })} />
        </div>
        {!product && (
          <div className="space-y-2 sm:col-span-2">
            <Label>Opening stock</Label>
            <Input type="number" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: Number(e.target.value) })} />
          </div>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Label>Product image</Label>
          <ProductImageUpload
            value={form.image_url}
            onChange={(path) => setForm({ ...form, image_url: path })}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Description</Label>
          <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name}>
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* -------------------- Suppliers -------------------- */

type Supplier = { id: string; name: string; contact_name: string | null; phone: string | null; email: string | null; address: string | null; balance_due: number };

function SuppliersTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", contact_name: "", phone: "", email: "", address: "" });

  const { data: suppliers = [] } = useQuery({
    // unique cache key: the same key held a different column set on another page
    queryKey: ["suppliers", "full"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return data as Supplier[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("suppliers").insert(form);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Supplier added");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      setForm({ name: "", contact_name: "", phone: "", email: "", address: "" });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Truck className="h-4 w-4" /> New supplier</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New supplier</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Contact person</Label><Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="space-y-2"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>Address</Label><Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead className="text-right">Balance</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {suppliers.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No suppliers yet.</TableCell></TableRow>}
            {suppliers.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.contact_name ?? "—"}</TableCell>
                <TableCell>{s.phone ?? "—"}</TableCell>
                <TableCell>{s.email ?? "—"}</TableCell>
                <TableCell className="text-right">৳ {Number(s.balance_due).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

/* -------------------- Purchases -------------------- */

type StockBatch = { id: string; product_id: string; supplier_id: string | null; batch_no: string | null; quantity: number; purchase_price: number; expiry_date: string | null; received_at: string };

function PurchasesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ product_id: "", supplier_id: "", batch_no: "", quantity: 0, purchase_price: 0, new_selling_price: "" as string, expiry_date: "", notes: "" });
  // Idempotency key — stable across retries of the same submit attempt.
  // Reset on successful save or when the dialog is reopened with a fresh form.
  const requestIdRef = useRef<string | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products", "select"],
    queryFn: () => fetchAll<{ id: string; name: string }>(() => supabase.from("products").select("id,name").eq("is_active", true).order("name").order("id")),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers", "select"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: batches = [] } = useQuery({
    queryKey: ["batches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stock_batches")
        .select("*, product:products(name), supplier:suppliers(name)")
        .order("received_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as (StockBatch & { product: { name: string }; supplier: { name: string } | null })[];
    },
  });

  const record = useMutation({
    mutationFn: async () => {
      if (!requestIdRef.current) {
        requestIdRef.current =
          (globalThis.crypto as any)?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      const { data: rpcData, error } = await (supabase.rpc as any)("record_purchase", {
        _product_id: form.product_id,
        _supplier_id: form.supplier_id || null,
        _batch_no: form.batch_no || null,
        _quantity: form.quantity,
        _purchase_price: form.purchase_price,
        _expiry_date: form.expiry_date || null,
        _notes: form.notes || null,
        _client_request_id: requestIdRef.current,
      });
      if (error) throw error;
      const duplicate = !!(rpcData as any)?.duplicate;

      const newSell = form.new_selling_price.trim() === "" ? null : Number(form.new_selling_price);
      const priceChanged = newSell !== null && !Number.isNaN(newSell) && newSell > 0 && !duplicate;
      if (priceChanged) {
        const { error: upErr } = await supabase.from("products").update({ selling_price: newSell }).eq("id", form.product_id);
        if (upErr) throw upErr;
      }
      return { priceChanged, newSell, duplicate };
    },
    onMutate: async () => {
      const newSell = form.new_selling_price.trim() === "" ? null : Number(form.new_selling_price);
      const priceChanged = newSell !== null && !Number.isNaN(newSell) && newSell > 0;
      const qty = Number(form.quantity) || 0;

      await Promise.all([
        qc.cancelQueries({ queryKey: ["products"] }),
        qc.cancelQueries({ queryKey: ["batches"] }),
      ]);
      const snapshots = [
        ...qc.getQueriesData({ queryKey: ["products"] }),
        ...qc.getQueriesData({ queryKey: ["batches"] }),
      ];

      // Optimistically bump product stock (+ optional selling price)
      qc.setQueriesData({ queryKey: ["products"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((p: any) => {
          if (p?.id !== form.product_id) return p;
          const next = { ...p };
          if (typeof p.stock_quantity === "number") next.stock_quantity = p.stock_quantity + qty;
          if (priceChanged) next.selling_price = newSell;
          return next;
        });
      });

      // Optimistically prepend a temporary batch row
      const productName = (qc.getQueryData<any[]>(["products", "select"]) ?? qc.getQueryData<any[]>(["products"]))
        ?.find((p: any) => p?.id === form.product_id)?.name ?? "…";
      const supplierName = qc.getQueryData<any[]>(["suppliers", "select"])
        ?.find((s: any) => s?.id === form.supplier_id)?.name ?? null;
      const tempBatch = {
        id: `optimistic-${Date.now()}`,
        product_id: form.product_id,
        supplier_id: form.supplier_id || null,
        batch_no: form.batch_no || null,
        quantity: qty,
        purchase_price: Number(form.purchase_price) || 0,
        expiry_date: form.expiry_date || null,
        received_at: new Date().toISOString(),
        product: { name: productName },
        supplier: supplierName ? { name: supplierName } : null,
        __optimistic: true,
      };
      qc.setQueriesData({ queryKey: ["batches"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return [tempBatch, ...old];
      });

      return {
        snapshots,
        priceChanged,
        expected: {
          product_id: form.product_id,
          batch_qty: qty,
          stock_after: (() => {
            const list = qc.getQueryData<any[]>(["products"]);
            const p = Array.isArray(list) ? list.find((x: any) => x?.id === form.product_id) : null;
            // list has already been optimistically updated → subtract qty to get pre-value, then add for expected
            return p && typeof p.stock_quantity === "number" ? p.stock_quantity : null;
          })(),
          selling_price: priceChanged ? newSell : null,
        },
      };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.snapshots) for (const [key, data] of ctx.snapshots) qc.setQueryData(key, data);
      toast.error(e.message);
    },
    onSuccess: (result, _vars, ctx) => {
      if (result.duplicate) {
        // Roll back the optimistic stock/batch bump — server did not apply a new purchase.
        if (ctx?.snapshots) for (const [key, data] of ctx.snapshots) qc.setQueryData(key, data);
        toast.info("Duplicate request detected — purchase was already saved. No changes applied.");
      } else {
        toast.success(
          result.priceChanged
            ? `Purchase saved. Selling price updated to ৳ ${Number(result.newSell).toFixed(2)}`
            : "Purchase saved. Selling price unchanged."
        );
      }
      setForm({ product_id: "", supplier_id: "", batch_no: "", quantity: 0, purchase_price: 0, new_selling_price: "", expiry_date: "", notes: "" });
      requestIdRef.current = null; // fresh key for the next purchase
      setOpen(false);
    },
    onSettled: async (_data, error, _vars, ctx) => {
      const results = await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ["batches"], refetchType: "all" }),
        qc.invalidateQueries({ queryKey: ["products"], refetchType: "all" }),
      ]);
      const refetchFailed = results.some((r) => r.status === "rejected");
      if (!error && refetchFailed && ctx?.snapshots?.length) {
        for (const [key, data] of ctx.snapshots) qc.setQueryData(key, data);
        toast.error("Refresh failed — rolled back stock preview. Please reload.");
        return;
      }
      if (error || !ctx?.expected) return;

      // Reconcile: refetch already replaced cache with server data. Compare and notify on mismatch.
      const exp = ctx.expected;
      const products = qc.getQueryData<any[]>(["products"]);
      const serverProduct = Array.isArray(products) ? products.find((p: any) => p?.id === exp.product_id) : null;
      const batches = qc.getQueryData<any[]>(["batches"]);
      const serverBatch = Array.isArray(batches)
        ? batches.find((b: any) => !b?.__optimistic && b?.product_id === exp.product_id)
        : null;

      const mismatches: string[] = [];
      if (serverProduct && exp.stock_after != null && Number(serverProduct.stock_quantity) !== Number(exp.stock_after)) {
        mismatches.push(`stock ${exp.stock_after} → ${serverProduct.stock_quantity}`);
      }
      if (serverBatch && Number(serverBatch.quantity) !== Number(exp.batch_qty)) {
        mismatches.push(`batch qty ${exp.batch_qty} → ${serverBatch.quantity}`);
      }
      if (
        serverProduct &&
        exp.selling_price != null &&
        Number(serverProduct.selling_price) !== Number(exp.selling_price)
      ) {
        mismatches.push(`price ${exp.selling_price} → ${serverProduct.selling_price}`);
      }
      if (mismatches.length) {
        toast.info(`Reconciled with server: ${mismatches.join(", ")}`);
      }
    },


  });


  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <BulkPurchaseDialog products={products as any[]} suppliers={suppliers as any[]} onDone={() => {
          qc.invalidateQueries({ queryKey: ["batches"] });
          qc.invalidateQueries({ queryKey: ["products"] });
        }} />
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) requestIdRef.current = null; }}>
          <DialogTrigger asChild><Button><PackagePlus className="h-4 w-4" /> Record purchase</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record stock purchase</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Product</Label>
                <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose product" /></SelectTrigger>
                  <SelectContent>{products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Supplier</Label>
                <Select value={form.supplier_id} onValueChange={(v) => setForm({ ...form, supplier_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose supplier (optional)" /></SelectTrigger>
                  <SelectContent>{suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Batch #</Label><Input value={form.batch_no} onChange={(e) => setForm({ ...form, batch_no: e.target.value })} /></div>
              <div className="space-y-2"><Label>Expiry</Label><Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Quantity</Label><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Purchase price</Label><Input type="number" step="0.01" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: Number(e.target.value) })} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>New selling price <span className="text-xs text-muted-foreground">(optional — updates product price)</span></Label><Input type="number" step="0.01" placeholder="Leave blank to keep current" value={form.new_selling_price} onChange={(e) => setForm({ ...form, new_selling_price: e.target.value })} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => record.mutate()} disabled={!form.product_id || !form.quantity || record.isPending}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Supplier</TableHead><TableHead>Batch</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Cost</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {batches.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No purchases recorded.</TableCell></TableRow>}
            {batches.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="text-xs text-muted-foreground">{new Date(b.received_at).toLocaleDateString()}</TableCell>
                <TableCell className="font-medium">{b.product?.name}</TableCell>
                <TableCell>{b.supplier?.name ?? "—"}</TableCell>
                <TableCell>{b.batch_no ?? "—"}</TableCell>
                <TableCell>{b.expiry_date ?? "—"}</TableCell>
                <TableCell className="text-right">{Number(b.quantity)}</TableCell>
                <TableCell className="text-right">৳ {Number(b.purchase_price).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

/* -------------------- Bulk Purchase -------------------- */

type BulkRow = {
  product_id: string;
  quantity: string;
  purchase_price: string;
  new_selling_price: string;
  batch_no: string;
  expiry_date: string;
};

const emptyRow = (): BulkRow => ({ product_id: "", quantity: "", purchase_price: "", new_selling_price: "", batch_no: "", expiry_date: "" });

function BulkPurchaseDialog({ products, suppliers, onDone }: { products: any[]; suppliers: any[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<BulkRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const reset = () => {
    setSupplierId(""); setNotes(""); setRows([emptyRow(), emptyRow(), emptyRow()]); setProgress(null);
  };

  const updateRow = (i: number, patch: Partial<BulkRow>) => {
    setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };

  const validRows = rows.filter(r => r.product_id && Number(r.quantity) > 0 && Number(r.purchase_price) >= 0);
  const grandTotal = validRows.reduce((s, r) => s + Number(r.quantity) * Number(r.purchase_price), 0);

  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current) return; // double tap would record the purchase twice
    if (validRows.length === 0) { toast.error("Add at least one valid row (product, qty, price)."); return; }
    submitting.current = true;
    setProgress({ done: 0, total: validRows.length });
    const errors: string[] = [];
    const saved = new Set<BulkRow>();
    let ok = 0;
    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i];
      const reqId = (globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
      try {
        const { error } = await (supabase.rpc as any)("record_purchase", {
          _product_id: r.product_id,
          _supplier_id: supplierId || null,
          _batch_no: r.batch_no || null,
          _quantity: Number(r.quantity),
          _purchase_price: Number(r.purchase_price),
          _expiry_date: r.expiry_date || null,
          _notes: notes || null,
          _client_request_id: reqId,
        });
        if (error) throw error;
        const newSell = r.new_selling_price.trim() === "" ? null : Number(r.new_selling_price);
        if (newSell !== null && !Number.isNaN(newSell) && newSell > 0) {
          await supabase.from("products").update({ selling_price: newSell }).eq("id", r.product_id);
        }
        saved.add(r);
        ok++;
      } catch (e: any) {
        const name = products.find(p => p.id === r.product_id)?.name ?? r.product_id;
        errors.push(`${name}: ${e?.message ?? "failed"}`);
      }
      setProgress({ done: i + 1, total: validRows.length });
    }
    if (ok > 0) toast.success(`Saved ${ok} of ${validRows.length} purchases`);
    if (errors.length) toast.error(errors.slice(0, 3).join(" • "));
    onDone();
    refreshAppData();
    submitting.current = false;
    if (errors.length === 0) { reset(); setOpen(false); }
    else {
      // Keep only the failed rows: retrying used to re-submit the rows that
      // had already been saved, doubling their stock and purchase cost.
      setRows((rs) => {
        const left = rs.filter((r) => !saved.has(r));
        return left.length ? left : [emptyRow()];
      });
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild><Button variant="outline"><PackagePlus className="h-4 w-4" /> Bulk purchase</Button></DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>Bulk stock purchase</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2 mb-3">
          <div className="space-y-2">
            <Label>Supplier (applies to all rows)</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Choose supplier (optional)" /></SelectTrigger>
              <SelectContent>{suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes (applies to all)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="border rounded-md max-h-[50vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Product</TableHead>
                <TableHead className="w-24">Qty</TableHead>
                <TableHead className="w-28">Cost ৳</TableHead>
                <TableHead className="w-28">New Sell ৳</TableHead>
                <TableHead className="w-32">Batch #</TableHead>
                <TableHead className="w-36">Expiry</TableHead>
                <TableHead className="w-24 text-right">Line ৳</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const line = (Number(r.quantity) || 0) * (Number(r.purchase_price) || 0);
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <Select value={r.product_id} onValueChange={(v) => updateRow(i, { product_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Choose product" /></SelectTrigger>
                        <SelectContent>{products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" value={r.quantity} onChange={(e) => updateRow(i, { quantity: e.target.value })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={r.purchase_price} onChange={(e) => updateRow(i, { purchase_price: e.target.value })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" placeholder="—" value={r.new_selling_price} onChange={(e) => updateRow(i, { new_selling_price: e.target.value })} /></TableCell>
                    <TableCell><Input value={r.batch_no} onChange={(e) => updateRow(i, { batch_no: e.target.value })} /></TableCell>
                    <TableCell><Input type="date" value={r.expiry_date} onChange={(e) => updateRow(i, { expiry_date: e.target.value })} /></TableCell>
                    <TableCell className="text-right text-sm">{line.toFixed(2)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>✕</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between mt-3">
          <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
            <Plus className="h-4 w-4" /> Add row
          </Button>
          <div className="text-sm">
            <span className="text-muted-foreground">Valid rows: </span><b>{validRows.length}</b>
            <span className="ml-4 text-muted-foreground">Grand total: </span><b>৳ {grandTotal.toFixed(2)}</b>
          </div>
        </div>

        {progress && (
          <div className="text-sm text-muted-foreground mt-2">Saving {progress.done} / {progress.total}...</div>
        )}

        <DialogFooter>
          <Button onClick={submit} disabled={validRows.length === 0 || !!progress}>
            {progress ? `Saving ${progress.done}/${progress.total}...` : `Save ${validRows.length} purchase${validRows.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

