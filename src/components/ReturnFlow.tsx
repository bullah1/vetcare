import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Undo2, CheckCircle2, Plus, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const METHODS = ["cash", "bkash", "nagad", "rocket", "card", "bank"] as const;

type SaleItem = {
  id: string;
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  returned_quantity: number;
};

export function ReturnFlow({ trigger, invoiceNo }: { trigger?: React.ReactNode; invoiceNo?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [invoice, setInvoice] = useState("");
  const [searched, setSearched] = useState("");
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState<(typeof METHODS)[number] | "none">("cash");
  const [restock, setRestock] = useState(true);
  const [done, setDone] = useState<{ return_no: string; refund_amount: number; refund_paid: number; due_reduction: number } | null>(null);
  const requestId = useRef(crypto.randomUUID());

  // Opened from a specific invoice row: load that invoice straight away.
  useEffect(() => {
    if (open && invoiceNo) {
      setInvoice(invoiceNo);
      setSearched(invoiceNo);
    }
  }, [open, invoiceNo]);

  // Cash paid back must come out of an open drawer shift, otherwise it is not
  // recorded in any shift and the drawer shows more cash than it really has.
  const { data: shift } = useQuery({
    queryKey: ["open-shift-summary"],
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("cash_shift_summary", { _shift_id: null });
      if (error) throw error;
      return data as any;
    },
  });
  const shiftOpen = !!shift && shift.status === "open";

  const { data: sale, isFetching, error } = useQuery({
    queryKey: ["return-sale", searched],
    enabled: !!searched,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,invoice_no,total,paid,due,discount,status,created_at, owner:pet_owners(full_name,phone), items:sale_items(id,product_id,name,quantity,unit_price,line_total,returned_quantity), payments(method,amount)")
        // Invoice numbers are stored in capitals; the box only LOOKS uppercase,
        // so "inv-…" typed in lower case used to come back "Invoice not found".
        .eq("invoice_no", searched.trim().toUpperCase())
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Invoice not found");
      return data as any;
    },
  });

  const items: SaleItem[] = sale?.items ?? [];

  // Bill-level discount is shared proportionally across every line
  const discountFactor = useMemo(() => {
    const gross = items.reduce((s, it) => s + Number(it.line_total || 0), 0);
    const billDiscount = Number(sale?.discount ?? 0);
    if (gross <= 0 || billDiscount <= 0) return 1;
    return Math.max(0, 1 - billDiscount / gross);
  }, [items, sale?.discount]);

  function setQty(id: string, delta: number, max: number) {
    setQtyMap((m) => {
      const next = Math.max(0, Math.min(max, (m[id] ?? 0) + delta));
      return { ...m, [id]: next };
    });
  }

  const refundTotal = useMemo(() => {
    return items.reduce((sum, it) => {
      const q = qtyMap[it.id] ?? 0;
      if (q <= 0) return sum;
      const unit = (Number(it.line_total) / Number(it.quantity || 1)) * discountFactor;
      return sum + q * unit;
    }, 0);
  }, [items, qtyMap, discountFactor]);

  // Same rule as the server (create_return): a return first reduces the open
  // due; only the rest is paid back to the customer.
  const dueNow = Math.max(0, Number(sale?.due || 0));
  const dueCut = Math.min(refundTotal, dueNow);
  const cashBack = Math.max(0, refundTotal - dueCut);

  // How the customer actually paid, so the refund goes back the same way.
  const paidByMethod = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of (sale?.payments ?? []) as { method: string; amount: number }[]) {
      m[p.method] = (m[p.method] ?? 0) + Number(p.amount || 0);
    }
    return Object.entries(m).filter(([, v]) => v > 0.004).sort((x, y) => y[1] - x[1]);
  }, [sale?.payments]);

  useEffect(() => {
    const main = paidByMethod[0]?.[0];
    if (main && (METHODS as readonly string[]).includes(main)) setRefund(main as (typeof METHODS)[number]);
  }, [sale?.id, paidByMethod]);

  const closed = sale && (sale.status === "void" || sale.status === "refunded");
  const cashBlocked = refund === "cash" && cashBack > 0.004 && !shiftOpen;
  const methodBlocked = refund === "none" && cashBack > 0.004;


  const totalReturning = Object.values(qtyMap).reduce((s, n) => s + n, 0);

  const process = useMutation({
    mutationFn: async () => {
      const payload = items
        .map((it) => ({ sale_item_id: it.id, quantity: qtyMap[it.id] ?? 0 }))
        .filter((r) => r.quantity > 0);
      if (payload.length === 0) throw new Error("Choose at least one item to return");
      if (!reason.trim()) throw new Error("Reason is required");
      if (cashBlocked) throw new Error("No cash drawer shift is open — open a shift before paying cash back");
      const { data, error } = await (supabase.rpc as any)("create_return", {
        _sale_id: sale.id,
        _items: payload,
        _reason: reason.trim().slice(0, 500),
        _refund_method: refund === "none" ? null : refund,
        _restock: restock,
        _client_request_id: requestId.current,
      });
      if (error) throw error;
      return data as { return_no: string; refund_amount: number; refund_paid: number; due_reduction: number };
    },
    onSuccess: (r) => {
      setDone({ return_no: r.return_no, refund_amount: Number(r.refund_amount), refund_paid: Number(r.refund_paid || 0), due_reduction: Number(r.due_reduction || 0) });
      toast.success(`Return ${r.return_no} processed`);
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["return-sale", searched] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["sales-history"] });
      qc.invalidateQueries({ queryKey: ["due-bills"] });
      qc.invalidateQueries({ queryKey: ["cash-shift"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function reset() {
    requestId.current = crypto.randomUUID();
    setInvoice(""); setSearched(""); setQtyMap({}); setReason("");
    setRefund("cash"); setRestock(true); setDone(null);
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <SheetTrigger asChild>
        {trigger ?? <Button variant="outline"><Undo2 className="h-4 w-4" /> Return</Button>}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-auto rounded-t-2xl p-4 sm:p-6 sm:max-w-2xl sm:mx-auto">
        <SheetHeader className="text-left mb-3">
          <SheetTitle className="flex items-center gap-2"><Undo2 className="h-4 w-4" /> Return &amp; Refund</SheetTitle>
        </SheetHeader>

        {done ? (
          <div className="space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Return</span><span className="font-mono font-medium">{done.return_no}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Refund amount</span><span className="font-semibold tabular-nums">৳ {done.refund_amount.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Money paid back</span><span className="tabular-nums">৳ {done.refund_paid.toFixed(2)}</span></div>
               <div className="flex justify-between"><span className="text-muted-foreground">Due reduced</span><span className="tabular-nums">৳ {done.due_reduction.toFixed(2)}</span></div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button variant="outline" className="w-full sm:w-auto" onClick={reset}>New return</Button>
              <Button className="w-full sm:flex-1" onClick={() => setOpen(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); setSearched(invoice); setQtyMap({}); }}
            >
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Invoice number, e.g. INV-202607-00001"
                  value={invoice}
                  onChange={(e) => setInvoice(e.target.value)}
                  className="pl-8 uppercase"
                  maxLength={40}
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={!invoice.trim() || isFetching}>Find</Button>
            </form>

            {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

            {closed && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                This invoice is already {sale.status === "void" ? "cancelled" : "fully returned"} — nothing left to return.
              </p>
            )}

            {sale && !closed && (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/30 p-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-mono font-medium">{sale.invoice_no}</span>
                  <span className="text-muted-foreground">{new Date(sale.created_at).toLocaleString()}</span>
                  {sale.owner?.full_name && <span className="text-muted-foreground">· {sale.owner.full_name}</span>}
                  <Badge variant="outline" className="ml-auto">{sale.status}</Badge>
                </div>

                <div className="divide-y rounded-lg border">
                  {items.map((it) => {
                    const max = Number(it.quantity) - Number(it.returned_quantity);
                    const q = qtyMap[it.id] ?? 0;
                    const disabled = max <= 0;
                    return (
                      <div key={it.id} className="p-3 flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{it.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Sold {Number(it.quantity)} · Returned {Number(it.returned_quantity)} · Remaining {max}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={disabled || q <= 0} onClick={() => setQty(it.id, -1, max)}><Minus className="h-3 w-3" /></Button>
                          <span className="w-6 text-center text-sm tabular-nums">{q}</span>
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={disabled || q >= max} onClick={() => setQty(it.id, 1, max)}><Plus className="h-3 w-3" /></Button>
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && <p className="p-4 text-sm text-muted-foreground text-center">No items on this invoice.</p>}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Refund method</Label>
                    <Select value={refund} onValueChange={(v) => setRefund(v as typeof refund)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Adjust unpaid due only</SelectItem>
                        {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {paidByMethod.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Paid by: {paidByMethod.map(([m, v]) => `${m} ৳${v.toFixed(2)}`).join(", ")}
                      </p>
                    )}
                    {cashBlocked && (
                      <p className="text-xs text-destructive">
                        No cash drawer shift is open — open a shift from Cash Drawer to pay cash back.
                      </p>
                    )}
                  </div>
                  <div className="flex items-end gap-3 pb-1">
                    <div className="flex-1">
                      <Label htmlFor="restock" className="mb-2 block">Restock items</Label>
                      <div className="flex items-center gap-2">
                        <Switch id="restock" checked={restock} onCheckedChange={setRestock} />
                        <span className="text-sm text-muted-foreground">{restock ? "Add back to inventory" : "Damaged / discard"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Reason <span className="text-destructive">*</span></Label>
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    placeholder="e.g. Wrong item, expired product, customer request"
                  />
                </div>

                <div className="rounded-lg border bg-primary/5 p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Refund total ({totalReturning} item{totalReturning !== 1 ? "s" : ""})</span>
                    <span className="text-lg font-semibold tabular-nums">৳ {refundTotal.toFixed(2)}</span>
                  </div>
                  {discountFactor < 1 && (
                    <p className="text-xs text-muted-foreground">
                      Bill discount ৳ {Number(sale.discount).toFixed(2)} shared across all items — refund is {(discountFactor * 100).toFixed(1)}% of original price.
                    </p>
                  )}
                  {refundTotal > 0 && (() => {
                    const netTotal = Math.max(0, Number(sale.paid || 0) + dueNow - refundTotal);
                    return (
                      <div className="space-y-0.5 border-t pt-2 text-xs">
                        {refund === "none" && cashBack > 0.004 && (
                          <p className="pb-1 text-destructive">
                            ৳ {cashBack.toFixed(2)} must be paid back — choose a refund method.
                          </p>
                        )}
                        <div className="flex justify-between"><span className="text-muted-foreground">Net invoice after refund</span><span className="tabular-nums">৳ {netTotal.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Money to pay back</span><span className="tabular-nums">৳ {cashBack.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Remaining due reduced by</span><span className="tabular-nums">৳ {dueCut.toFixed(2)}</span></div>
                      </div>
                    );
                  })()}
                </div>



                <Button
                  className="w-full"
                  size="lg"
                  disabled={totalReturning === 0 || !reason.trim() || process.isPending || methodBlocked || cashBlocked}
                  onClick={() => process.mutate()}
                >
                  {process.isPending ? "Processing..." : `Process return · ৳ ${refundTotal.toFixed(2)}`}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
