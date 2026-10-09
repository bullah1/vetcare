import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const METHODS = ["cash", "bkash", "nagad", "rocket", "card", "bank"] as const;
const LABELS: Record<(typeof METHODS)[number], string> = {
  cash: "Cash",
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  card: "Card",
  bank: "Bank",
};

export type DueSale = { id: string; invoice_no: string; due: number; owner?: { full_name: string } | null };

const fmt = (n: number) => `৳ ${n.toFixed(2)}`;

export function CollectDueDialog({
  sale,
  open,
  onOpenChange,
  onCollected,
}: {
  sale: DueSale | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCollected?: () => void;
}) {
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("cash");
  const [reference, setReference] = useState("");

  // Reset only when the dialog opens for a (different) invoice. Depending on the
  // `sale` object itself wiped what the cashier typed on every list refetch.
  const saleId = sale?.id;
  const saleDue = Number(sale?.due ?? 0);
  useEffect(() => {
    if (open && saleId) {
      setAmount(Number(saleDue.toFixed(2)));
      setMethod("cash");
      setReference("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saleId]);

  const due = Number(sale?.due ?? 0);
  const pay = amount === "" ? 0 : Number(amount);
  const remaining = Math.max(due - pay, 0);

  const { data: shift } = useQuery({
    queryKey: ["open-shift-summary"],
    staleTime: 0,
    refetchOnMount: "always",
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("cash_shift_summary", { _shift_id: null });
      if (error) throw error;
      return data as any;
    },
  });
  const shiftOpen = !!shift && shift.status === "open";
  const cashBlocked = method === "cash" && !shiftOpen;

  const collect = useMutation({
    mutationFn: async () => {
      if (!sale) throw new Error("No sale selected");
      if (pay <= 0) throw new Error("Amount must be greater than 0");
      if (cashBlocked) throw new Error("No cash drawer shift is open — open a shift first");
      if (pay > due + 0.009) throw new Error("Amount cannot exceed the due balance");
      const { data, error } = await (supabase.rpc as any)("collect_sale_due", {
        _sale_id: sale.id,
        _amount: pay,
        _method: method,
        _reference: reference.trim() || null,
      });
      if (error) throw error;
      return data as { paid: number; due: number };
    },
    onSuccess: (res) => {
      toast.success(
        method === "cash"
          ? `${fmt(pay)} added to cash drawer. Due: ${fmt(Number(res.due))}`
          : `${fmt(pay)} ${method} payment received. Due: ${fmt(Number(res.due))}`,
      );
      onOpenChange(false);
      onCollected?.();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to collect payment"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Collect due — {sale?.invoice_no}</DialogTitle>
        </DialogHeader>

        {sale && (
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer</span>
                <span>{sale.owner?.full_name ?? "Walk-in"}</span>
              </div>
              <div className="flex justify-between font-medium text-destructive">
                <span>Outstanding due</span>
                <span className="tabular-nums">{fmt(due)}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Payment method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => <SelectItem key={m} value={m}>{LABELS[m]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {METHODS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={method === m ? "default" : "outline"}
                  onClick={() => setMethod(m)}
                >
                  {LABELS[m]}
                </Button>
              ))}
            </div>


            <div className="space-y-2">
              <Label>Reference (optional)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="trx id / note" />
            </div>

            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remaining due after payment</span>
                <span className="tabular-nums">{fmt(remaining)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Saved as</span>
                <span>{LABELS[method]} payment</span>
              </div>
              {method === "cash" && pay > 0 && shiftOpen && (
                <p className="text-xs text-muted-foreground">
                  This {fmt(pay)} will be added as cash in to the open cash drawer shift.
                </p>
              )}
              {cashBlocked && (
                <p className="text-xs text-destructive">
                  No cash drawer shift is open — open a shift from the Cash Drawer page, or pick a digital method.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => collect.mutate()} disabled={collect.isPending || pay <= 0 || cashBlocked}>
            {collect.isPending ? "Saving..." : `Collect ${fmt(pay)} — ${LABELS[method]}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
