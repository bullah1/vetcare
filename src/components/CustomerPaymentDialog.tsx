import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const METHODS = ["cash", "bkash", "nagad", "rocket", "card", "bank"] as const;
type Method = (typeof METHODS)[number];

export type OpenInvoice = { id: string; invoice_no: string; due: number; created_at: string };

const fmt = (n: number) => `৳ ${Number(n || 0).toFixed(2)}`;

export function CustomerPaymentDialog({
  open,
  onOpenChange,
  customerName,
  invoices,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerName: string;
  invoices: OpenInvoice[];
  onRecorded?: () => void;
}) {
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<Method>("cash");
  const [reference, setReference] = useState("");

  // oldest invoice first so the earliest due clears first
  const openInvoices = useMemo(
    () =>
      [...invoices]
        .filter((i) => Number(i.due) > 0.004)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [invoices],
  );

  const totalDue = openInvoices.reduce((a, i) => a + Number(i.due), 0);

  // Prefill with the full due once the invoices are known. Invoices often load
  // after the dialog opens, which used to leave the amount stuck at 0.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!open) {
      prefilled.current = false;
      return;
    }
    if (prefilled.current) return;
    setMethod("cash");
    setReference("");
    setAmount(totalDue > 0 ? Number(totalDue.toFixed(2)) : "");
    if (totalDue > 0) prefilled.current = true;
  }, [open, totalDue]);

  const pay = amount === "" ? 0 : Number(amount);

  const allocation = useMemo(() => {
    let left = pay;
    const rows: { invoice: OpenInvoice; amount: number }[] = [];
    for (const inv of openInvoices) {
      if (left <= 0.004) break;
      const take = Math.min(left, Number(inv.due));
      rows.push({ invoice: inv, amount: Number(take.toFixed(2)) });
      left -= take;
    }
    return { rows, unallocated: Math.max(Number(left.toFixed(2)), 0) };
  }, [openInvoices, pay]);

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

  const record = useMutation({
    mutationFn: async () => {
      if (pay <= 0) throw new Error("Amount must be greater than 0");
      if (cashBlocked) throw new Error("No cash drawer shift is open — open a shift first");
      if (pay > totalDue + 0.009) throw new Error("Amount cannot exceed total outstanding due");

      let collected = 0;
      for (const row of allocation.rows) {
        if (row.amount <= 0) continue;
        const { error } = await (supabase.rpc as any)("collect_sale_due", {
          _sale_id: row.invoice.id,
          _amount: row.amount,
          _method: method,
          _reference: reference.trim() || `Payment from ${customerName}`,
        });
        if (error) {
          // Earlier invoices are already saved — say so, so nobody re-enters them.
          throw new Error(
            collected > 0
              ? `${fmt(collected)} was recorded, but ${row.invoice.invoice_no} failed: ${error.message}. Re-open to collect the rest.`
              : error.message,
          );
        }
        collected += row.amount;
      }
    },
    onSuccess: () => {
      toast.success(
        method === "cash"
          ? `${fmt(pay)} added to cash drawer. Due: ${fmt(totalDue - pay)}`
          : `${fmt(pay)} ${method} payment recorded. Due: ${fmt(totalDue - pay)}`,
      );
      onOpenChange(false);
      onRecorded?.();
    },
    onError: (e: any) => {
      toast.error(e.message ?? "Failed to record payment");
      onRecorded?.();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-4 w-4" /> Receive payment — {customerName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-3 text-sm flex justify-between font-medium">
            <span className="text-muted-foreground">Total outstanding due</span>
            <span className={`tabular-nums ${totalDue > 0 ? "text-destructive" : ""}`}>{fmt(totalDue)}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Reference (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="trx id / note" />
          </div>

          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <div className="font-medium mb-1">Allocation (oldest invoice first)</div>
            {allocation.rows.length === 0 ? (
              <div className="text-muted-foreground text-xs">No outstanding invoice.</div>
            ) : (
              allocation.rows.map((r) => (
                <div key={r.invoice.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{r.invoice.invoice_no}</span>
                  <span className="tabular-nums">
                    {fmt(r.amount)} <span className="text-muted-foreground">/ {fmt(Number(r.invoice.due))}</span>
                  </span>
                </div>
              ))
            )}
            {allocation.unallocated > 0 && (
              <div className="text-xs text-destructive pt-1">
                {fmt(allocation.unallocated)} could not be allocated — cannot exceed the total due.
              </div>
            )}
            {method === "cash" && pay > 0 && shiftOpen && (
              <p className="text-xs text-muted-foreground pt-1">
                This {fmt(pay)} will be added as cash in to the open cash drawer shift.
              </p>
            )}
            {cashBlocked && (
              <p className="text-xs text-destructive pt-1">
                No cash drawer shift is open — open a shift from the Cash Drawer page to accept cash.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => record.mutate()}
            disabled={record.isPending || pay <= 0 || allocation.unallocated > 0 || cashBlocked}
          >

            {record.isPending ? "Saving..." : `Receive ${fmt(pay)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
