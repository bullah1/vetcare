import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ClipboardEdit, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { refreshAppData } from "@/lib/refresh-data";

export const Route = createFileRoute("/_authenticated/adjustments")({
  head: () => ({ meta: [{ title: "Stock Adjustments — Pet Care Vet ERP" }] }),
  component: AdjustmentsPage,
});

type Reason = "damage" | "loss" | "found" | "correction" | "expired" | "other";

const REASON_META: Record<Reason, { label: string; color: string }> = {
  damage: { label: "Damaged / Broken", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  loss: { label: "Lost / Missing", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  found: { label: "Found / Extra", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  correction: { label: "Manual Correction", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  expired: { label: "Expired", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  other: { label: "Other", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

function AdjustmentsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: adjustments = [], isLoading } = useQuery({
    queryKey: ["stock-adjustments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_adjustments" as never)
        .select("*, products(name, unit, sku)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return adjustments;
    return adjustments.filter((a: any) =>
      a.products?.name?.toLowerCase().includes(q) ||
      a.products?.sku?.toLowerCase().includes(q) ||
      a.notes?.toLowerCase().includes(q) ||
      a.reason?.toLowerCase().includes(q)
    );
  }, [adjustments, search]);

  const stats = useMemo(() => {
    let inc = 0, dec = 0, count = adjustments.length;
    adjustments.forEach((a: any) => {
      const c = Number(a.quantity_change);
      if (c > 0) inc += c; else dec += Math.abs(c);
    });
    return { inc, dec, count };
  }, [adjustments]);

  async function onDelete(id: string) {
    if (!confirm("Delete this adjustment log? (stock will not be reverted)")) return;
    const { error } = await supabase.from("stock_adjustments" as never).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    refreshAppData();
    qc.invalidateQueries({ queryKey: ["stock-adjustments"] });
  }

  return (
    <div className="p-0 sm:p-2">
      <PageHeader
        title="Stock Adjustments"
        description="Damaged, lost, expired, or manual stock correction"
        icon={ClipboardEdit}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Adjustment
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Entries</div><div className="text-xl sm:text-2xl font-semibold">{stats.count}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Added</div><div className="text-xl sm:text-2xl font-semibold text-emerald-600">+{stats.inc.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Removed</div><div className="text-xl sm:text-2xl font-semibold text-destructive">-{stats.dec.toLocaleString()}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search product / reason / notes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Before → After</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>}
              {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No adjustments</TableCell></TableRow>}
              {filtered.map((a: any) => {
                const c = Number(a.quantity_change);
                const meta = REASON_META[a.reason as Reason] || REASON_META.other;
                return (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="font-medium">{a.products?.name || "—"}</div>
                      {a.products?.sku && <div className="text-xs text-muted-foreground">{a.products.sku}</div>}
                    </TableCell>
                    <TableCell><Badge variant="secondary" className={meta.color}>{meta.label}</Badge></TableCell>
                    <TableCell className={`text-right font-semibold ${c > 0 ? "text-emerald-600" : "text-destructive"}`}>
                      {c > 0 ? "+" : ""}{c} {a.products?.unit || ""}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{a.before_qty} → {a.after_qty}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-sm">{a.notes || "—"}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => onDelete(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <NewAdjustmentDialog open={open} onOpenChange={setOpen} onDone={() => qc.invalidateQueries({ queryKey: ["stock-adjustments"] })} />
    </div>
  );
}

function NewAdjustmentDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [productId, setProductId] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [mode, setMode] = useState<"set" | "adjust">("set");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [qty, setQty] = useState<string>("");
  const [reason, setReason] = useState<Reason>("damage");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["adj-products", productSearch],
    enabled: open,
    queryFn: async () => {
      let q = supabase.from("products").select("id, name, sku, unit, stock_quantity").order("name").limit(30);
      if (productSearch.trim()) q = q.ilike("name", `%${productSearch.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const selected = products.find((p: any) => p.id === productId);
  const current = Number(selected?.stock_quantity ?? 0);
  const entered = Number(qty);
  const validQty = qty !== "" && !Number.isNaN(entered);
  const change = mode === "set" ? entered - current : direction === "in" ? entered : -entered;
  const after = mode === "set" ? entered : current + change;

  function reset() {
    setProductId(""); setProductSearch(""); setMode("set"); setDirection("out"); setQty(""); setReason("damage"); setNotes("");
  }

  async function submit() {
    if (!productId) return toast.error("Select a product");
    if (!validQty) return toast.error("Enter quantity");
    if (mode === "set" && entered < 0) return toast.error("Quantity must be 0 or more");
    if (mode === "adjust" && entered <= 0) return toast.error("Quantity must be greater than 0");
    if (change === 0) return toast.error("Stock is unchanged — nothing to update");
    if (notes.length > 500) return toast.error("Keep notes under 500 characters");

    setSaving(true);
    const { error } = await supabase.rpc("adjust_stock" as never, {
      _product_id: productId,
      _quantity_change: change,
      _reason: reason,
      _notes: (mode === "set"
        ? `Set to ${entered}${notes.trim() ? ` — ${notes.trim()}` : ""}`
        : notes.trim()) || null,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Stock updated → ${after} ${selected?.unit ?? ""}`);
    refreshAppData();
    reset();
    onOpenChange(false);
    onDone();
  }


  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New Stock Adjustment</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Product</Label>
            <Input placeholder="Search product..." value={productSearch} onChange={e => { setProductSearch(e.target.value); setProductId(""); }} className="mb-2" />
            <div className="max-h-48 overflow-auto rounded border">
              {products.length === 0 && <div className="p-3 text-sm text-muted-foreground text-center">No products</div>}
              {products.map((p: any) => (
                <button key={p.id} type="button" onClick={() => setProductId(p.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent border-b last:border-b-0 ${productId === p.id ? "bg-accent" : ""}`}>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">Stock: {p.stock_quantity} {p.unit} {p.sku && `• ${p.sku}`}</div>
                </button>
              ))}
            </div>
            {selected && <div className="mt-2 text-xs text-muted-foreground">Current stock: <b>{selected.stock_quantity} {selected.unit}</b></div>}
          </div>

          <div>
            <Label>Adjustment type</Label>
            <Select value={mode} onValueChange={(v: "set" | "adjust") => setMode(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="set">🎯 Set exact stock (final stock equals entered value)</SelectItem>
                <SelectItem value="adjust">➕➖ Add / Remove quantity</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className={mode === "set" ? "" : "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
            {mode === "adjust" && (
              <div>
                <Label>Direction</Label>
                <Select value={direction} onValueChange={(v: "in" | "out") => setDirection(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="out">➖ Decrease (Remove)</SelectItem>
                    <SelectItem value="in">➕ Increase (Add)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>{mode === "set" ? "New stock quantity" : "Quantity"}</Label>
              <Input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v: Reason) => setReason(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_META).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notes (optional, max 500)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value.slice(0, 500))} placeholder="Batch #, cause, reference..." rows={2} />
          </div>

          {selected && validQty && (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <div>Current: <b>{current} {selected.unit}</b> → After: <b>{after} {selected.unit}</b></div>
              <div className="text-xs text-muted-foreground">
                {change === 0 ? "No change" : `Logged change: ${change > 0 ? "+" : ""}${change}`}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !productId || !validQty || change === 0}>{saving ? "Saving..." : "Save Adjustment"}</Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
