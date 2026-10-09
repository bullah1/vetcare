import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Receipt, Printer, Search, Bike } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { printInvoice, printThermal, type Receipt as PrintReceipt } from "@/lib/invoice-print";
import { useWhatsAppInvoice } from "@/lib/use-whatsapp-invoice";
import { DeliveryDialog } from "@/components/DeliveryDialog";
import { deliveryForReceipt, fetchActiveDelivery, DELIVERY_STATUS_LABEL } from "@/lib/deliveries";

type SaleRow = {
  id: string;
  invoice_no: string;
  created_at: string;
  total: number;
  paid: number;
  due: number;
  status: string;
  owner: { full_name: string; phone: string | null } | null;
};

type SaleDetail = SaleRow & {
  subtotal: number;
  discount: number;
  tax: number;
  notes: string | null;
  sale_items: {
    id: string; name: string; quantity: number; unit_price: number;
    discount: number; tax: number; line_total: number; returned_quantity: number;
  }[];
  payments: { id: string; method: string; amount: number; reference: string | null }[];
};

const statusColor: Record<string, string> = {
  completed: "bg-primary/10 text-primary",
  partially_returned: "bg-amber-500/10 text-amber-700",
  refunded: "bg-destructive/10 text-destructive",
  pending: "bg-muted text-muted-foreground",
};

function toReceipt(d: SaleDetail): PrintReceipt {
  return {
    invoice_no: d.invoice_no,
    subtotal: Number(d.subtotal),
    tax: Number(d.tax),
    discount: Number(d.discount),
    total: Number(d.total),
    paid: Number(d.paid),
    due: Number(d.due),
    method: d.payments[0]?.method ?? "—",
    issued_at: d.created_at,
    owner: d.owner,
    status: d.status,
    notes: d.notes,
    items: d.sale_items.map((it) => ({
      name: it.name,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      discount: Number(it.discount),
      tax: Number(it.tax),
      line_total: Number(it.line_total),
    })),
    payments: d.payments.map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
  };
}

export function SalesHistory({ trigger }: { trigger?: React.ReactNode }) {
  const sendWhatsApp = useWhatsAppInvoice();
  const [deliveryFor, setDeliveryFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: sales = [], isFetching } = useQuery({
    queryKey: ["sales-history", q],
    enabled: open,
    queryFn: async () => {
      let query = supabase
        .from("sales")
        .select("id,invoice_no,created_at,total,paid,due,status, owner:pet_owners(full_name,phone)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (q.trim()) query = query.ilike("invoice_no", `%${q.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as SaleRow[];
    },
  });

  const { data: detail } = useQuery({
    queryKey: ["sale-detail", detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,invoice_no,created_at,total,paid,due,status,subtotal,discount,tax,notes, owner:pet_owners(full_name,phone), sale_items(id,name,quantity,unit_price,discount,tax,line_total,returned_quantity), payments(id,method,amount,reference)")
        .eq("id", detailId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SaleDetail;
    },
  });

  // Active delivery of the open invoice: its charge is printed on the invoice
  // (shown separately — never added to the sale).
  const { data: detailDelivery, refetch: refetchDetailDelivery } = useQuery({
    queryKey: ["delivery-active", detail?.id],
    enabled: !!detail?.id,
    queryFn: () => fetchActiveDelivery(detail!.id),
  });
  const withDelivery = (r: PrintReceipt): PrintReceipt => ({ ...r, delivery: deliveryForReceipt(detailDelivery) });

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          {trigger ?? <Button variant="outline" size="sm"><History className="h-4 w-4" /> Sales History</Button>}
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Sales History</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by invoice no (e.g. INV-...)" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isFetching && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading...</TableCell></TableRow>}
                  {!isFetching && sales.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No sales found.</TableCell></TableRow>}
                  {sales.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => setDetailId(s.id)}>
                      <TableCell>
                        <div className="font-medium">{s.invoice_no}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(s.created_at), "dd MMM yyyy, hh:mm a")}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.owner?.full_name ?? <span className="text-muted-foreground">Walk-in</span>}
                        {s.owner?.phone && <div className="text-xs text-muted-foreground">{s.owner.phone}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ৳ {Number(s.total).toFixed(2)}
                        {Number(s.due) > 0 && <div className="text-xs text-destructive">Due ৳ {Number(s.due).toFixed(2)}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={statusColor[s.status] ?? ""}>{s.status.replace("_", " ")}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDetailId(s.id); }}>
                          <Receipt className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-lg print:max-w-full print:shadow-none">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>Invoice {detail?.invoice_no}</span>
              <div className="flex gap-2 print:hidden">
                <Button size="sm" variant="outline" onClick={() => detail && printThermal(withDelivery(toReceipt(detail)))}>
                  <Printer className="h-4 w-4" /> Thermal
                </Button>
                <Button size="sm" onClick={() => detail && printInvoice(withDelivery(toReceipt(detail)))}>
                  <Printer className="h-4 w-4" /> A4 Print
                </Button>
                <Button size="sm" variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" onClick={() => detail && sendWhatsApp(withDelivery(toReceipt(detail)), detail.id)}>
                  WhatsApp
                </Button>
                {detail && detail.status !== "void" && (
                  <Button size="sm" variant="outline" onClick={() => setDeliveryFor(detail.id)} title="Send for delivery">
                    <Bike className="h-4 w-4" />
                    {detailDelivery ? `Delivery · ${DELIVERY_STATUS_LABEL[detailDelivery.status]}` : "Delivery"}
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

          {detail && (
            <div id="invoice-print" className="space-y-3 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{format(new Date(detail.created_at), "dd MMM yyyy, hh:mm a")}</span>
                <Badge variant="secondary" className={statusColor[detail.status] ?? ""}>{detail.status.replace("_", " ")}</Badge>
              </div>

              <div className="border rounded p-2 text-sm">
                <div className="font-medium">{detail.owner?.full_name ?? "Walk-in customer"}</div>
                {detail.owner?.phone && <div className="text-xs text-muted-foreground">{detail.owner.phone}</div>}
              </div>

              <div className="rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.sale_items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>
                          {it.name}
                          {it.returned_quantity > 0 && <div className="text-xs text-destructive">Returned: {it.returned_quantity}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">৳ {Number(it.unit_price).toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">৳ {Number(it.line_total).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">৳ {Number(detail.subtotal).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">৳ {Number(detail.tax).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">- ৳ {Number(detail.discount).toFixed(2)}</span></div>
                <div className="flex justify-between font-semibold text-base border-t pt-1"><span>Total</span><span className="tabular-nums">৳ {Number(detail.total).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums">৳ {Number(detail.paid).toFixed(2)}</span></div>
                {Number(detail.due) > 0 && <div className="flex justify-between text-destructive font-medium"><span>Due</span><span className="tabular-nums">৳ {Number(detail.due).toFixed(2)}</span></div>}
              </div>

              {detail.payments.length > 0 && (
                <div className="border rounded p-2 text-xs space-y-1">
                  <div className="font-medium text-sm">Payments</div>
                  {detail.payments.map((p) => (
                    <div key={p.id} className="flex justify-between">
                      <span className="capitalize">{p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                      <span className="tabular-nums">৳ {Number(p.amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              {detail.notes && <div className="text-xs text-muted-foreground border-t pt-2">Note: {detail.notes}</div>}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <DeliveryDialog
        saleId={deliveryFor}
        open={!!deliveryFor}
        onOpenChange={(o) => !o && setDeliveryFor(null)}
        onCreated={() => void refetchDetailDelivery()}
      />
    </>
  );
}
