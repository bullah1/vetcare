import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { refreshAppData } from "@/lib/refresh-data";

export type CountableProduct = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  stock_quantity: number | string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: CountableProduct[];
};

export function StockCountDialog({ open, onOpenChange, products }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setValues({}); setQ(""); }
  }, [open]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(s) || (p.sku ?? "").toLowerCase().includes(s),
    );
  }, [products, q]);

  const changes = useMemo(() => {
    const out: { product: CountableProduct; current: number; final: number; delta: number }[] = [];
    for (const p of products) {
      const raw = values[p.id];
      if (raw === undefined || raw.trim() === "") continue;
      const final = Number(raw);
      if (Number.isNaN(final) || final < 0) continue;
      const current = Number(p.stock_quantity);
      if (final === current) continue;
      out.push({ product: p, current, final, delta: final - current });
    }
    return out;
  }, [products, values]);

  async function save() {
    setSaving(true);
    let ok = 0;
    const failed: string[] = [];
    for (const c of changes) {
      const { error } = await supabase.rpc("adjust_stock" as never, {
        _product_id: c.product.id,
        _quantity_change: c.delta,
        _reason: "correction",
        _notes: `Physical count: set to ${c.final} (was ${c.current})${user?.email ? ` by ${user.email}` : ""}`,
      } as never);
      if (error) failed.push(`${c.product.name}: ${error.message}`);
      else ok++;
    }
    setSaving(false);
    setConfirmOpen(false);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["products"] }),
      qc.invalidateQueries({ queryKey: ["stock-adjustments"] }),
    ]);
    refreshAppData();
    if (ok) toast.success(`Stock updated for ${ok} product${ok > 1 ? "s" : ""}`);
    if (failed.length) toast.error(failed.slice(0, 3).join(" • "));
    if (!failed.length) onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Stock Adjustment (Physical Count)
            </DialogTitle>
            <DialogDescription>
              Enter the actual counted quantity in Final Stock. Blank or equal values stay unchanged.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search product / SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right w-28">Current</TableHead>
                  <TableHead className="text-right w-32">Final Stock</TableHead>
                  <TableHead className="text-right w-24">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No products</TableCell></TableRow>
                )}
                {list.map((p) => {
                  const current = Number(p.stock_quantity);
                  const raw = values[p.id] ?? "";
                  const final = raw.trim() === "" ? null : Number(raw);
                  const delta = final === null || Number.isNaN(final) ? null : final - current;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        {p.sku && <div className="text-xs text-muted-foreground">{p.sku}</div>}
                      </TableCell>
                      <TableCell className="text-right">{current} {p.unit ?? ""}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          className="h-9 text-right"
                          placeholder={String(current)}
                          value={raw}
                          onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {delta === null || Number.isNaN(delta) || delta === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Badge variant="secondary" className={delta > 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"}>
                            {delta > 0 ? "+" : ""}{delta}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {changes.length} product{changes.length === 1 ? "" : "s"} will be updated
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={changes.length === 0 || saving} onClick={() => setConfirmOpen(true)}>
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm stock update</AlertDialogTitle>
            <AlertDialogDescription>
              {changes.length} product{changes.length === 1 ? "" : "s"} will be set to the counted quantity. Each change is logged with date, time and your user.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-56 overflow-auto rounded-md border p-3 text-sm space-y-1">
            {changes.map((c) => (
              <div key={c.product.id} className="flex justify-between gap-3">
                <span className="truncate">{c.product.name}</span>
                <span className="whitespace-nowrap text-muted-foreground">
                  {c.current} → <b className="text-foreground">{c.final}</b> ({c.delta > 0 ? "+" : ""}{c.delta})
                </span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void save(); }}
              disabled={saving}
            >
              {saving ? "Saving…" : "Confirm & save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
