import { useQuery } from "@tanstack/react-query";
import { Bike, MessageCircle, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchActiveDelivery, type Delivery } from "@/lib/deliveries";
import { buildLocalDeliveryInvoice, printDeliveryInvoice, shareDeliveryInvoiceOnWhatsApp } from "@/lib/delivery-invoice";

const fmt = (n: number) => `৳ ${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Local delivery invoice: preview, print and send to the customer on WhatsApp.
 * Pass either a delivery row or a sale id (its active delivery is used).
 */
export function DeliveryInvoiceDialog({
  delivery,
  saleId,
  open,
  onOpenChange,
}: {
  delivery?: Delivery | null;
  saleId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const key = delivery?.id ?? saleId ?? null;
  const { data: inv, isLoading, error } = useQuery({
    queryKey: ["delivery-invoice", key, delivery?.updated_at ?? null],
    enabled: open && !!key,
    staleTime: 0,
    queryFn: async () => {
      const d = delivery ?? (saleId ? await fetchActiveDelivery(saleId) : null);
      if (!d) throw new Error("This invoice has no active delivery.");
      return buildLocalDeliveryInvoice(d);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bike className="h-4 w-4" /> Delivery invoice {inv ? `— ${inv.invoice_no}` : ""}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : error || !inv ? (
          <p className="py-6 text-center text-sm text-destructive">{(error as any)?.message ?? "Could not load the invoice."}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-2.5">
                <p className="text-[11px] text-muted-foreground">Deliver to</p>
                <p className="font-semibold">{inv.customer.name}</p>
                {inv.customer.phone && <p className="text-xs">{inv.customer.phone}</p>}
                <p className="text-xs text-muted-foreground">{inv.customer.address || "No address"}</p>
              </div>
              <div className="rounded-lg border p-2.5">
                <p className="text-[11px] text-muted-foreground">Delivery man</p>
                <p className="font-semibold">{inv.rider?.name}</p>
                {inv.rider?.phone && <p className="text-xs">{inv.rider.phone}</p>}
                <p className="text-xs capitalize text-muted-foreground">{String(inv.status ?? "").replace(/_/g, " ")}</p>
              </div>
            </div>
            <ul className="divide-y rounded-lg border">
              {inv.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-2 px-2.5 py-1.5">
                  <span className="min-w-0 truncate">{it.name} × {it.quantity}</span>
                  <span className="shrink-0 tabular-nums">{fmt(it.line_total)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1 rounded-lg border bg-muted/30 p-2.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Product total</span><span className="tabular-nums">{fmt(inv.product_total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Delivery charge</span><span className="tabular-nums">{fmt(inv.delivery_charge)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total bill</span><span className="tabular-nums">{fmt(inv.product_total + inv.delivery_charge)}</span></div>
              {inv.paid > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Paid at shop</span><span className="tabular-nums">− {fmt(inv.paid)}</span></div>}
              <div className="flex justify-between border-t pt-1 text-base font-bold"><span>To collect</span><span className="tabular-nums">{fmt(inv.to_collect)}</span></div>
            </div>
          </div>
        )}
        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" disabled={!inv} onClick={() => inv && shareDeliveryInvoiceOnWhatsApp(inv)}>
            <MessageCircle className="h-4 w-4" /> Send to customer
          </Button>
          <Button disabled={!inv} onClick={() => inv && printDeliveryInvoice(inv)}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
