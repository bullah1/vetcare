import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, Pencil, Save, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NewCustomerDialog } from "@/components/NewCustomerDialog";
import { refreshAppData } from "@/lib/refresh-data";
import { fetchAll } from "@/lib/fetch-all";

const PAYMENT_METHODS = ["cash", "bkash", "nagad", "rocket", "card", "bank", "due"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];
const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  card: "Card",
  bank: "Bank",
  due: "Due (remove payment)",
};

export type EditableSale = {
  id: string;
  invoice_no: string;
  discount: number;
  tax: number;
  total?: number;
  paid: number;
  due?: number;
  notes: string | null;
  owner_id?: string | null;
  sale_items: {
    id: string; name: string; quantity: number; unit_price: number;
    discount: number; tax: number; returned_quantity: number;
  }[];
};

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

type LineDraft = { id: string; name: string; quantity: string; unit_price: string; discount: string; tax: number; returned_quantity: number };

export function SaleEditDialog({
  sale,
  open,
  onOpenChange,
  onSaved,
}: {
  sale: EditableSale | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState("0");
  const [notes, setNotes] = useState("");

  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: customers = [], refetch: refetchCustomers } = useQuery({
    queryKey: ["sale-edit-customers"],
    enabled: open,
    queryFn: async () => {
      // All customers (was capped at 500, so the invoice's own customer often
      // showed as "Walk-in" and later customers could not be picked).
      return fetchAll<{ id: string; full_name: string; phone: string | null }>(
        () => supabase.from("pet_owners").select("id,full_name,phone").order("full_name").order("id"),
        200000,
      );
    },
  });

  const { data: payments = [], refetch: refetchPayments } = useQuery({
    queryKey: ["sale-edit-payments", sale?.id],
    enabled: open && !!sale?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id,method,amount,reference,received_at")
        .eq("sale_id", sale!.id)
        .order("received_at");
      if (error) throw error;
      return (data ?? []) as { id: string; method: PaymentMethod; amount: number; reference: string | null; received_at: string }[];
    },
  });

  const [methodSavingId, setMethodSavingId] = useState<string | null>(null);

  const changeMethod = async (paymentId: string, method: PaymentMethod) => {
    // Turning a payment into "due" deletes it. If money was already paid back on
    // this invoice (a return), the due then comes out too low — tested: paid
    // 200, refunded 100, payment → due left due 100 instead of 200.
    if (method === "due" && payments.some((p) => Number(p.amount) < 0)) {
      toast.error("This invoice has a refund — it can't be moved to due. Use Cancel or Return instead.");
      return;
    }
    setMethodSavingId(paymentId);
    try {
      const { error } = await supabase.rpc("change_payment_method", {
        _payment_id: paymentId,
        _method: method,
      } as any);
      if (error) throw error;
      toast.success(method === "due" ? "Payment removed, invoice moved to due" : `Payment method changed to ${METHOD_LABEL[method]}`);
      await refetchPayments();
      refreshAppData();
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change the payment method");
    } finally {
      setMethodSavingId(null);
    }
  };

  useEffect(() => {
    if (!sale || !open) return;
    setLines(
      sale.sale_items.map((it) => ({
        id: it.id,
        name: it.name,
        quantity: String(Number(it.quantity)),
        unit_price: String(Number(it.unit_price)),
        discount: String(Number(it.discount)),
        tax: Number(it.tax),
        returned_quantity: Number(it.returned_quantity),
      })),
    );
    setInvoiceDiscount(String(Number(sale.discount)));
    setNotes(sale.notes ?? "");
    setOwnerId(sale.owner_id ?? null);
    // Only when a different invoice is opened — a background refetch of the
    // same invoice used to wipe the note/customer being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id, open]);

  const originalTotal = useMemo(() => {
    if (!sale) return 0;
    const sub = sale.sale_items.reduce(
      (a, it) => a + Number(it.quantity) * Number(it.unit_price) - Number(it.discount),
      0,
    );
    const tax = sale.sale_items.reduce((a, it) => a + Number(it.tax), 0);
    return Math.max(sub + tax - Number(sale.discount || 0), 0);
  }, [sale]);

  const totals = useMemo(() => {
    const subtotal =
      lines.reduce(
        (a, l) => a + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0) - (Number(l.discount) || 0),
        0,
      ) +
      0;
    const tax = lines.reduce((a, l) => a + (l.tax || 0), 0);
    const total = Math.max(subtotal + tax - (Number(invoiceDiscount) || 0), 0);
    const paid = Number(sale?.paid ?? 0);
    // The server's due already accounts for returns; the gross line total
    // minus paid overstated the due on partly returned invoices.
    const due = sale?.due != null ? Number(sale.due) : Math.max(total - paid, 0);
    return { subtotal, tax, total, paid, due };
  }, [lines, invoiceDiscount, sale?.paid, sale?.due]);

  const selectedCustomer = customers.find((c) => c.id === ownerId);

  const save = async () => {
    if (!sale) return;
    for (const l of lines) {
      const q = Number(l.quantity);
      if (!Number.isFinite(q) || q < 0) return toast.error(`Invalid quantity for ${l.name}`);
      if (q < l.returned_quantity) return toast.error(`${l.name}: quantity cannot be below returned qty (${l.returned_quantity})`);
    }
    if (!ownerId && Number(sale.due ?? 0) > 0.009) {
      return toast.error("This invoice has a due — it must stay assigned to a customer.");
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_sale", {
        _sale_id: sale.id,
        _items: lines.map((l) => ({
          sale_item_id: l.id,
          quantity: Number(l.quantity) || 0,
          unit_price: Number(l.unit_price) || 0,
          discount: Number(l.discount) || 0,
        })),
        _new_items: [],
        _owner_id: ownerId,
        _set_owner: true,
        _discount: Number(invoiceDiscount) || 0,
        _notes: notes || null,
        _extra_payment: null,
        _refund_method_in: null,

      } as any);
      if (error) throw error;
      toast.success(`Invoice ${sale.invoice_no} updated`);
      refreshAppData();
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update this invoice");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit Invoice {sale?.invoice_no}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border p-3">
          <Label className="flex items-center gap-2 text-xs"><User className="h-3.5 w-3.5" /> Customer</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="min-w-[14rem] flex-1 justify-between font-normal">
                  <span className="truncate">
                    {selectedCustomer
                      ? `${selectedCustomer.full_name}${selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}`
                      : <span className="text-muted-foreground">Walk-in customer</span>}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(24rem,90vw)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search name or phone…" />
                  <CommandList>
                    <CommandEmpty>No customer found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="walk-in" onSelect={() => { setOwnerId(null); setCustomerOpen(false); }}>
                        Walk-in customer
                      </CommandItem>
                      {customers.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={`${c.full_name} ${c.phone ?? ""}`}
                          onSelect={() => { setOwnerId(c.id); setCustomerOpen(false); }}
                        >
                          <div className="min-w-0">
                            <div className="truncate">{c.full_name}</div>
                            {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <NewCustomerDialog
              onCreated={async (id) => {
                await refetchCustomers();
                setOwnerId(id);
              }}
            />
          </div>
        </div>

        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-24 text-right">Qty</TableHead>
                <TableHead className="w-28 text-right">Rate</TableHead>
                <TableHead className="w-28 text-right">Discount</TableHead>
                <TableHead className="w-28 text-right">Line total</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm">
                    {l.name}
                    {l.returned_quantity > 0 && (
                      <div className="text-xs text-destructive">Returned: {l.returned_quantity}</div>
                    )}
                  </TableCell>
                  <TableCell>
                     <Input inputMode="decimal" className="h-8 text-right" value={l.quantity} disabled />
                  </TableCell>
                  <TableCell>
                     <Input inputMode="decimal" className="h-8 text-right" value={l.unit_price} disabled />
                  </TableCell>
                  <TableCell>
                     <Input inputMode="decimal" className="h-8 text-right" value={l.discount} disabled />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) - (Number(l.discount) || 0) + l.tax)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <Label className="flex items-center gap-2 text-xs"><CreditCard className="h-3.5 w-3.5" /> Payments</Label>
          {payments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No payment recorded on this invoice.</p>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                  <div className="min-w-0 text-sm">
                    <div className="tabular-nums font-medium">{fmt(Number(p.amount))}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(p.received_at).toLocaleString("en-BD")}
                      {Number(p.amount) < 0 ? " · refund" : ""}
                    </div>
                  </div>
                  <Select
                    value={p.method}
                    onValueChange={(v) => changeMethod(p.id, v as PaymentMethod)}
                    disabled={methodSavingId === p.id}
                  >
                    <SelectTrigger className="h-8 w-[11rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Changing the method moves the amount to that account and fixes the cash drawer. Amounts stay the same; choose Due to remove the payment.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
               <Label className="text-xs">Invoice discount (locked)</Label>
               <Input inputMode="decimal" value={invoiceDiscount} disabled />
            </div>
             <p className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">Financial fields are locked. Use Return for selected items, Cancel for the whole invoice, or Collect Due for a payment.</p>



            <div>
              <Label className="text-xs">Note</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="rounded border p-3 space-y-1 text-sm h-fit">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{fmt(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{fmt(totals.tax)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Invoice discount</span><span className="tabular-nums">- {fmt(Number(invoiceDiscount) || 0)}</span></div>
            <div className="flex justify-between font-semibold text-base border-t pt-1"><span>Total</span><span className="tabular-nums">{fmt(totals.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums">{fmt(totals.paid)}</span></div>
            <div className={`flex justify-between font-medium ${totals.due > 0 ? "text-destructive" : "text-emerald-600"}`}><span>Due</span><span className="tabular-nums">{fmt(totals.due)}</span></div>
             <p className="text-xs text-muted-foreground pt-2">Original quantities, prices, discounts and payments cannot be edited.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
