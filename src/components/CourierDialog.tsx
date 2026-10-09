import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Truck, RefreshCw, CheckCircle2, XCircle, Printer, FileText, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sendCourierOrder, refreshCourierStatus } from "@/lib/courier.functions";
import { printCourierLabel, type CourierLabelData } from "@/lib/courier-label";
import { printInvoice, shareInvoiceOnWhatsApp, courierTrackingUrl } from "@/lib/invoice-print";
import { fetchSaleReceipt } from "@/lib/sale-receipt";
import { DeliveryRiskBadge } from "@/lib/customer-risk";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

export const COURIERS = [{ value: "steadfast", label: "Steadfast Courier" }];

export const courierStatusColor: Record<string, string> = {
  sent: "bg-blue-500/10 text-blue-700",
  pending: "bg-amber-500/10 text-amber-700",
  in_review: "bg-amber-500/10 text-amber-700",
  hold: "bg-amber-500/10 text-amber-700",
  picked_up: "bg-indigo-500/10 text-indigo-700",
  in_transit: "bg-indigo-500/10 text-indigo-700",
  delivered: "bg-emerald-500/10 text-emerald-700",
  partial_delivered: "bg-emerald-500/10 text-emerald-700",
  cancelled: "bg-destructive/10 text-destructive",
  failed: "bg-destructive/10 text-destructive",
};

type Props = {
  saleId: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

export function CourierDialog({ saleId, onClose, onSaved }: Props) {
  const send = useServerFn(sendCourierOrder);
  const refresh = useServerFn(refreshCourierStatus);

  const [courier, setCourier] = useState("steadfast");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [charge, setCharge] = useState("0");
  const [paidBy, setPaidBy] = useState<"customer" | "shop">("customer");
  const [note, setNote] = useState("");
  // Steadfast keeps 1% of the cash it collects, so it is added to the COD.
  const [codPct, setCodPct] = useState("1");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const [result, setResult] = useState<{ ok: boolean; message?: string; consignment_id?: string | null; tracking_code?: string | null; status?: string | null; cod_amount?: number } | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["courier-sale", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const { data: sale, error } = await supabase
        .from("sales")
        .select("id,invoice_no,total,due,created_at, owner:pet_owners(full_name,phone,address), sale_items(name,quantity)")
        .eq("id", saleId!)
        .maybeSingle();
      if (error) throw error;
      const { data: order, error: oErr } = await supabase
        .from("courier_orders")
        .select("*")
        .eq("sale_id", saleId!)
        .maybeSingle();
      if (oErr) throw oErr;
      return { sale: sale as any, order: order as any };
    },
  });

  const sale = data?.sale;
  const order = data?.order;

  useEffect(() => {
    if (!sale) return;
    setResult(null);
    setCourier(order?.courier ?? "steadfast");
    setName(order?.recipient_name ?? sale.owner?.full_name ?? "");
    setPhone(order?.recipient_phone ?? sale.owner?.phone ?? "");
    setAddress(order?.recipient_address ?? sale.owner?.address ?? "");
    setCharge(String(order?.courier_charge ?? 0));
    setPaidBy((order?.paid_by as any) ?? "customer");
    setNote(order?.note ?? "");
    if (order && order.paid_by !== "shop") {
      const base = Number(order.sales_total) + Number(order.courier_charge);
      const extra = Number(order.cod_amount) - base;
      setCodPct(base > 0 && extra > 0 ? String(Math.round((extra / base) * 1000) / 10) : "0");
    } else setCodPct("1");
  }, [sale?.id, order?.id]);

  const items: { name: string; quantity: number }[] = sale?.sale_items ?? [];
  const itemDescription = useMemo(
    () => items.map((i) => `${i.name} x${Number(i.quantity)}`).join(", "),
    [items],
  );
  const quantity = useMemo(() => items.reduce((a, i) => a + Number(i.quantity || 0), 0) || 1, [items]);

  const salesTotal = Number(sale?.total ?? 0);
  const chargeNum = Number(charge) || 0;
  const pctNum = Math.min(10, Math.max(0, Number(codPct) || 0));
  // Rounded up to a whole taka so the shop never falls short.
  const codCharge = paidBy === "customer" ? Math.ceil(((salesTotal + chargeNum) * pctNum) / 100) : 0;
  const cod = paidBy === "customer" ? salesTotal + chargeNum + codCharge : salesTotal;

  // Ready-made customer invoice (products + courier + tracking) once sent.
  const { data: invoice } = useQuery({
    queryKey: ["courier-invoice", saleId, order?.status, order?.consignment_id, order?.cod_amount],
    enabled: !!saleId && !!order && !["failed", "cancelled"].includes(order.status),
    staleTime: 0,
    queryFn: () => fetchSaleReceipt(saleId!),
  });

  const alreadySent = !!order && !["failed", "cancelled"].includes(order.status);

  const doSend = async (resend = false) => {
    if (!saleId || !sale) return;
    setBusy(true);
    setResult(null);
    try {
      const res: any = await send({
        data: {
          saleId,
          courier,
          recipient_name: name,
          recipient_phone: phone,
          recipient_address: address,
          invoice_no: sale.invoice_no,
          item_description: itemDescription,
          quantity,
          sales_total: salesTotal,
          courier_charge: chargeNum,
          cod_charge: codCharge,
          paid_by: paidBy,
          note: note || null,
          resend,
        },
      });
      setResult(res);
      if (res.ok) toast.success("Courier order sent successfully");
      else toast.error(res.message ?? "Courier order failed");
      await refetch();
      qc.invalidateQueries({ queryKey: ["receipt-delivery"] });
      onSaved?.();
    } catch (e: any) {
      const msg = e?.message ?? "Courier order failed";
      setResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const doTrack = async () => {
    if (!saleId) return;
    setBusy(true);
    try {
      const res: any = await refresh({ data: { saleId } });
      if (res.ok) toast.success(`Status: ${String(res.status).replace(/_/g, " ")}`);
      else toast.error(res.message ?? "Could not fetch status");
      await refetch();
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not fetch status");
    } finally {
      setBusy(false);
    }
  };

  const doPrintLabel = () => {
    if (!order) return;
    const label: CourierLabelData = {
      invoice_no: sale?.invoice_no ?? order.invoice_no ?? "",
      courier: order.courier ?? "steadfast",
      consignment_id: order.consignment_id ?? null,
      tracking_code: order.tracking_code ?? null,
      recipient_name: order.recipient_name ?? name,
      recipient_phone: order.recipient_phone ?? phone,
      recipient_address: order.recipient_address ?? address,
      item_description: order.item_description ?? itemDescription,
      quantity: Number(order.quantity ?? quantity),
      sales_total: Number(order.sales_total ?? salesTotal),
      courier_charge: Number(order.courier_charge ?? chargeNum),
      paid_by: (order.paid_by as any) ?? paidBy,
      cod_amount: Number(order.cod_amount ?? cod),
      note: order.note ?? null,
      sent_at: order.sent_at ?? null,
    };
    printCourierLabel(label);
  };

  return (
    <Dialog open={!!saleId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[92vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" /> Send to Courier
            {order && (
              <Badge variant="secondary" className={`capitalize ${courierStatusColor[order.status] ?? ""}`}>
                {String(order.status).replace(/_/g, " ")}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isFetching && !sale ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading sale…</div>
        ) : !sale ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Sale not found.</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1.5">
              <div className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">Invoice</span><span className="min-w-0 break-all text-right font-medium">{sale.invoice_no}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">Items</span><span className="min-w-0 truncate text-right" title={itemDescription}>{itemDescription || "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">Quantity</span><span>{quantity}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">Sales total</span><span className="font-semibold tabular-nums">{fmt(salesTotal)}</span></div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">Courier service</Label>
                <Select value={courier} onValueChange={setCourier}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COURIERS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Recipient name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
              </div>
              <div>
                <Label className="text-xs">Phone (11 digits)</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" className="h-10" />
              </div>
              <DeliveryRiskBadge phone={phone} className="sm:col-span-2" />
              <div className="sm:col-span-2">
                <Label className="text-xs">Delivery address</Label>
                <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
              </div>
              <div>
                <Label className="text-xs">Courier charge</Label>
                <Input value={charge} onChange={(e) => setCharge(e.target.value)} inputMode="decimal" className="h-10" />
              </div>
              <div>
                <Label className="text-xs">Charge paid by</Label>
                <Select value={paidBy} onValueChange={(v) => setPaidBy(v as any)}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="shop">Shop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {paidBy === "customer" && (
                <div>
                  <Label className="text-xs">COD charge %</Label>
                  <Input value={codPct} onChange={(e) => setCodPct(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-10" />
                </div>
              )}
              <div className={paidBy === "customer" ? "" : "sm:col-span-2"}>
                <Label className="text-xs">COD amount (auto)</Label>
                <Input value={cod.toFixed(2)} readOnly className="h-10 bg-muted font-semibold tabular-nums" />
              </div>
              <div className="sm:col-span-2 rounded-lg border p-2.5 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Product amount</span><span className="tabular-nums">{fmt(salesTotal)}</span></div>
                {paidBy === "customer" && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Delivery charge</span><span className="tabular-nums">{fmt(chargeNum)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">COD charge ({pctNum}%)</span><span className="tabular-nums">{fmt(codCharge)}</span></div>
                  </>
                )}
                <div className="flex justify-between border-t pt-1 font-semibold"><span>Customer pays (COD)</span><span className="tabular-nums">{fmt(cod)}</span></div>
                <p className="text-[11px] text-muted-foreground">
                  {paidBy === "customer" ? "Delivery + COD charge are added to the COD only" : "Shop pays the charges"} — never added to sales.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-10" />
              </div>
            </div>

            {order?.consignment_id && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1.5">
                <div className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">Consignment ID</span><span className="min-w-0 break-all text-right font-medium">{order.consignment_id}</span></div>
                {order.tracking_code && <div className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">Tracking code</span><span className="min-w-0 break-all text-right font-medium">{order.tracking_code}</span></div>}
                {courierTrackingUrl(order.courier, order.tracking_code) && (
                  <div className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">Tracking link</span><a href={courierTrackingUrl(order.courier, order.tracking_code)!} target="_blank" rel="noreferrer" className="min-w-0 break-all text-right font-medium text-primary underline">Open</a></div>
                )}
                {order.sent_at && <div className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">Sent at</span><span className="min-w-0 text-right">{new Date(order.sent_at).toLocaleString()}</span></div>}
                <div className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">COD sent</span><span className="tabular-nums font-semibold">{fmt(Number(order.cod_amount))}</span></div>
              </div>
            )}

            {result && (
              <div className={`rounded-lg border p-3 text-sm ${result.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
                {result.ok ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Courier Order Sent Successfully</div>
                    <div>Consignment ID: <span className="font-medium">{result.consignment_id}</span></div>
                    <div>COD Amount: <span className="font-medium">{fmt(Number(result.cod_amount))}</span></div>
                    <div className="capitalize">Status: {String(result.status ?? "sent").replace(/_/g, " ")}</div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium text-destructive"><XCircle className="h-4 w-4" /> Courier Order Failed</div>
                    <div className="text-muted-foreground break-words">{result.message}</div>
                  </div>
                )}
              </div>
            )}

            {order?.last_error && !result && order.status === "failed" && (
              <p className="text-xs text-destructive break-words">Last error: {order.last_error}</p>
            )}
          </div>
        )}

        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          {order && (
            <Button variant="secondary" onClick={doPrintLabel} disabled={busy}>
              <Printer className="h-4 w-4" /> Print Label
            </Button>
          )}
          {invoice && (
            <>
              <Button variant="outline" onClick={() => printInvoice(invoice)} disabled={busy}>
                <FileText className="h-4 w-4" /> Invoice
              </Button>
              <Button
                variant="outline"
                className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                onClick={() => shareInvoiceOnWhatsApp(invoice, order?.recipient_phone ?? undefined)}
                disabled={busy}
                title="Send the invoice with tracking number to the customer"
              >
                <MessageCircle className="h-4 w-4" /> Send to customer
              </Button>
            </>
          )}
          {alreadySent ? (
            <>
              <Button variant="outline" onClick={doTrack} disabled={busy}>
                <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Track
              </Button>
              <Button variant="secondary" onClick={() => doSend(true)} disabled={busy}>Resend as new order</Button>
            </>
          ) : (
            <Button onClick={() => doSend(false)} disabled={busy || !sale}>
              <Truck className="h-4 w-4" /> {busy ? "Sending…" : order ? "Retry send" : "Send to Courier"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
