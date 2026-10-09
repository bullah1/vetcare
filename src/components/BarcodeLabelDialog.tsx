import { useEffect, useMemo, useState } from "react";
import { Printer, FileDown, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { printLabelsBatch, downloadLabelsPdf, type LabelItem } from "@/lib/barcode-labels";

export type LabelProduct = {
  id: string;
  name: string;
  selling_price: number;
  barcode: string | null;
  sku?: string | null;
  /** shown as a small badge, e.g. current stock or purchased qty */
  badge?: { label: string; tone?: "default" | "secondary" | "outline" | "destructive" };
  /** default copies when the dialog opens */
  defaultCopies?: number;
};

export function BarcodeLabelDialog({
  open, onOpenChange, products, title, hint, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: LabelProduct[];
  title?: string;
  hint?: string;
  onDone?: () => void;
}) {
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [dq, setDq] = useState("");
  const [focused, setFocused] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      const init: Record<string, number> = {};
      products.forEach((p) => { init[p.id] = Math.max(0, Math.floor(Number(p.defaultCopies) || 0)); });
      setCopies(init);
      setDq("");
    }
  }, [open, products]);

  const visible = useMemo(() => {
    const s = dq.trim().toLowerCase();
    if (!s) return products;
    return products.filter((p) =>
      p.name.toLowerCase().includes(s) ||
      (p.sku ?? "").toLowerCase().includes(s) ||
      (p.barcode ?? "").toLowerCase().includes(s),
    );
  }, [products, dq]);

  const total = products.reduce((s, p) => s + Math.max(0, Number(copies[p.id] || 0)), 0);

  function applyAll(n: number) {
    const next: Record<string, number> = {};
    products.forEach((p) => { next[p.id] = n; });
    setCopies(next);
  }

  function useDefaults() {
    const next: Record<string, number> = {};
    products.forEach((p) => { next[p.id] = Math.max(0, Math.floor(Number(p.defaultCopies) || 0)); });
    setCopies(next);
  }

  function bump(id: string, delta: number) {
    setCopies((prev) => ({ ...prev, [id]: Math.max(0, (Number(prev[id]) || 0) + delta) }));
  }

  function buildItems(): LabelItem[] {
    return products.map((p) => ({
      name: p.name,
      selling_price: Number(p.selling_price),
      barcode: p.barcode,
      copies: Math.max(0, Number(copies[p.id] || 0)),
    }));
  }

  function doPrint() {
    const items = buildItems();
    if (items.every((it) => it.copies === 0)) { toast.error("Set at least 1 copy"); return; }
    printLabelsBatch(items);
    onDone?.();
  }

  async function doPdf() {
    const items = buildItems();
    if (items.every((it) => it.copies === 0)) { toast.error("Set at least 1 copy"); return; }
    await downloadLabelsPdf(items);
    onDone?.();
  }

  const hasDefaults = products.some((p) => Number(p.defaultCopies) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[calc(100vw-1.5rem)] sm:w-auto max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">
            {title ?? "Print Barcode Labels"} — {products.length} product{products.length === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Quick set copies:</span>
          {[1, 2, 5, 10, 20].map((n) => (
            <Button key={n} variant="outline" size="sm" onClick={() => applyAll(n)}>{n}×</Button>
          ))}
          {hasDefaults && <Button variant="secondary" size="sm" onClick={useDefaults}>Reset</Button>}
          <Button variant="ghost" size="sm" onClick={() => applyAll(0)}>Clear</Button>
          <div className="w-full sm:w-auto sm:ml-auto text-sm">
            Total labels: <b>{total}</b>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={dq}
            onChange={(e) => setDq(e.target.value)}
            placeholder="Search product, SKU or barcode…"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {hint ?? "Use the +/− buttons or quick-set rows to choose how many labels to print. Stock is never changed by printing."}
        </p>
        <div className="max-h-[50vh] overflow-y-auto overflow-x-hidden border rounded-md divide-y">
          {visible.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground">No product found</div>
          )}
          {visible.map((p) => {
            const qty = copies[p.id] ?? 0;
            return (
              <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm break-words">{p.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{p.barcode ?? "no barcode"}</span>
                    <span>৳ {Number(p.selling_price).toFixed(2)}</span>
                    {p.badge && (
                      <Badge variant={p.badge.tone ?? "outline"} className="px-1.5 py-0 text-[10px]">
                        {p.badge.label}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => bump(p.id, -1)}>−</Button>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={qty === 0 && (focused[p.id] ?? false) ? "" : String(qty)}
                    onFocus={(e) => { setFocused((f) => ({ ...f, [p.id]: true })); e.currentTarget.select(); }}
                    onBlur={() => setFocused((f) => ({ ...f, [p.id]: false }))}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^0-9]/g, "");
                      setCopies((prev) => ({ ...prev, [p.id]: digits === "" ? 0 : Math.min(9999, parseInt(digits, 10)) }));
                    }}
                    className="h-8 w-14 px-1 text-center"
                  />
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => bump(p.id, 1)}>+</Button>
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={doPdf} disabled={total === 0}>
            <FileDown className="h-4 w-4" /> Download PDF
          </Button>
          <Button className="w-full sm:w-auto" onClick={doPrint} disabled={total === 0}>
            <Printer className="h-4 w-4" /> Print {total} label{total === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
