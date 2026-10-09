import { MobileFilterBar } from "@/components/MobileFilterBar";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Receipt, Printer, Search, RotateCcw, Pencil, Wallet, Ban, Truck, Bike } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { printInvoice, printThermal, type Receipt as PrintReceipt } from "@/lib/invoice-print";
import { printCourierLabel, type CourierLabelData } from "@/lib/courier-label";
import ThermalPrinterSettings from "@/components/ThermalPrinterSettings";
import { SaleEditDialog, type EditableSale } from "@/components/SaleEditDialog";
import { CollectDueDialog } from "@/components/CollectDueDialog";
import { ReturnFlow } from "@/components/ReturnFlow";
import { CourierDialog, courierStatusColor } from "@/components/CourierDialog";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import { grossOf, reversalAmount, dayRangeISO, VALID_STATUSES, deadSaleIds, monthStartDhaka, todayDhaka } from "@/lib/sales-ledger";
import { useWhatsAppInvoice } from "@/lib/use-whatsapp-invoice";
import { DeliveryDialog } from "@/components/DeliveryDialog";
import { deliveryForReceipt, fetchActiveDelivery, fetchReceiptDelivery, DELIVERY_STATUS_LABEL } from "@/lib/deliveries";


export const Route = createFileRoute("/_authenticated/sales-history")({
  head: () => ({ meta: [{ title: "Sales History — Pet Care Vet ERP" }] }),
  component: SalesHistoryPage,
});

type SaleRow = {
  id: string;
  invoice_no: string;
  created_at: string;
  total: number;
  paid: number;
  due: number;
  status: string;
  owner: { full_name: string; phone: string | null } | null;
  payments: { method: string; amount: number; received_at: string }[];
};

type RangePayment = {
  id: string;
  sale_id: string | null;
  method: string;
  amount: number;
  received_at: string;
};

const methodColor: Record<string, string> = {
  cash: "bg-emerald-500/10 text-emerald-700",
  bkash: "bg-pink-500/10 text-pink-700",
  nagad: "bg-orange-500/10 text-orange-700",
  rocket: "bg-purple-500/10 text-purple-700",
  card: "bg-blue-500/10 text-blue-700",
  bank: "bg-slate-500/10 text-slate-700",
  due: "bg-destructive/10 text-destructive",
};
const ALL_METHODS = ["cash", "bkash", "nagad", "rocket", "card", "bank"] as const;


type SaleDetail = Omit<SaleRow, "payments"> & {
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
  partial_refund: "bg-amber-500/10 text-amber-700",
  refunded: "bg-destructive/10 text-destructive",
  pending: "bg-muted text-muted-foreground",
  void: "bg-destructive/10 text-destructive line-through",
};

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
// Dhaka calendar dates — the UTC date is a day behind before 6 AM.
const startOfMonth = monthStartDhaka;
const today = todayDhaka;

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

function SalesHistoryPage() {
  const sendWhatsApp = useWhatsAppInvoice();
  const [deliveryFor, setDeliveryFor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState<string>("all");
  const [method, setMethod] = useState<string>("all");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [dueSaleId, setDueSaleId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelRequestId, setCancelRequestId] = useState(() => crypto.randomUUID());
  const [courierSaleId, setCourierSaleId] = useState<string | null>(null);
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");


  // Same Dhaka business-day window + full pagination as Dashboard/Reports.
  // The old 500-row cap silently dropped invoices and made Revenue disagree
  // with Reports — never limit this query.
  const { data: allSales = [], isFetching, refetch } = useQuery({
    queryKey: ["sales-history-page", q, from, to, status],
    queryFn: async () => {
      const { fromISO, toISO } = dayRangeISO(from, to);
      const rows = await fetchAll<SaleRow>(() => {
        let query = supabase
          .from("sales")
          .select("id,invoice_no,created_at,total,paid,due,status, owner:pet_owners(full_name,phone), payments(method,amount,received_at)")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .order("created_at", { ascending: false });
        if (q.trim()) query = query.ilike("invoice_no", `%${q.trim()}%`);
        if (status !== "all") query = query.eq("status", status as any);
        return query as any;
      });
      return rows;
    },
  });

  // Collection totals are cash-basis: each payment belongs to the Dhaka day on
  // which it was actually received, regardless of when its invoice was raised.
  const { data: rangePayments = [] } = useQuery({
    queryKey: ["sales-history-payments", from, to],
    queryFn: async () => {
      const { fromISO, toISO } = dayRangeISO(from, to);
      return await fetchAll<RangePayment>(() =>
        supabase
          .from("payments")
          .select("id,sale_id,method,amount,received_at")
          .gte("received_at", fromISO)
          .lte("received_at", toISO)
          .order("received_at", { ascending: false }) as any,
      );
    },
  });

  // Refunds/cancellations processed in the same window — Net Sales must subtract
  // them exactly like Reports does (cancelled invoice = full-value reversal).
  const { data: rangeReturns = [] } = useQuery({
    queryKey: ["sales-history-returns", from, to],
    queryFn: async () => {
      const { fromISO, toISO } = dayRangeISO(from, to);
      return await fetchAll<any>(() =>
        supabase
          .from("sale_returns")
          .select("sale_id,refund_amount,created_at, sales(id,status,total,subtotal,discount,created_at)")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .order("created_at") as any,
      );
    },
  });

  // Reversal rows for THESE invoices whenever they were processed (an invoice
  // sold today can be refunded a later day). Needed so such an invoice is not
  // mistaken for an old un-reversed cancellation and dropped from Invoice Sales.
  const { data: reversalRows = [] } = useQuery({
    queryKey: ["sales-history-reversals", allSales.map((s) => s.id).join(",")],
    enabled: allSales.length > 0,
    queryFn: async () => {
      // Chunked: a month of invoice ids in one URL is too long and the request
      // failed, which made valid invoices look "dead" and dropped them.
      return fetchAllIn<{ sale_id: string }>(allSales.map((s) => s.id), (c) =>
        supabase.from("sale_returns").select("sale_id").in("sale_id", c).order("id") as any,
      );
    },
  });

  const { data: courierOrders = {}, refetch: refetchCouriers } = useQuery({
    queryKey: ["sales-courier-orders", allSales.map((s) => s.id).join(",")],
    enabled: allSales.length > 0,
    queryFn: async () => {
      const data = await fetchAllIn<any>(allSales.map((s) => s.id), (c) =>
        supabase
          .from("courier_orders")
          .select("sale_id,status,consignment_id,tracking_code,courier,recipient_name,recipient_phone,recipient_address,item_description,quantity,sales_total,courier_charge,paid_by,cod_amount,note,sent_at")
          .in("sale_id", c)
          .order("id") as any,
      );
      return Object.fromEntries((data ?? []).map((o: any) => [o.sale_id, o])) as Record<string, CourierLabelData & { status: string }>;
    },
  });

  const { data: detail } = useQuery({
    queryKey: ["sale-detail-page", detailId],
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
  // Courier parcel (tracking no., COD) or local delivery (rider) for the invoice.
  const { data: detailShip } = useQuery({
    queryKey: ["receipt-delivery", detail?.id, detailDelivery?.id ?? null, detailDelivery?.status ?? null],
    enabled: !!detail?.id,
    staleTime: 0,
    queryFn: () => fetchReceiptDelivery(detail!.id),
  });
  const withDelivery = (r: PrintReceipt): PrintReceipt => ({
    ...r,
    sale_id: detail?.id,
    delivery: detailShip !== undefined ? detailShip : deliveryForReceipt(detailDelivery),
  });

  const { data: editSale } = useQuery({
    queryKey: ["sale-edit", editId],
    enabled: !!editId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,invoice_no,discount,tax,total,paid,due,notes,owner_id, sale_items(id,name,quantity,unit_price,discount,tax,returned_quantity)")
        .eq("id", editId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as EditableSale;
    },
  });


  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const reprint = async (id: string) => {
    setReprintingId(id);
    try {
      const { data, error } = await supabase
        .from("sales")
        .select("id,invoice_no,created_at,total,paid,due,status,subtotal,discount,tax,notes, owner:pet_owners(full_name,phone), sale_items(id,name,quantity,unit_price,discount,tax,line_total,returned_quantity), payments(id,method,amount,reference)")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) throw error ?? new Error("Invoice not found");
      printInvoice(toReceipt(data as unknown as SaleDetail));
    } finally {
      setReprintingId(null);
    }
  };

  const cancelSaleRow = allSales.find((s) => s.id === cancelId) ?? null;
  // Cash given back on cancel must come out of an open drawer shift.
  const { data: cancelShift } = useQuery({
    queryKey: ["open-shift-summary"],
    enabled: !!cancelId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("cash_shift_summary", { _shift_id: null });
      if (error) throw error;
      return data as any;
    },
  });
  const cancelCashBack = (cancelSaleRow?.payments ?? [])
    .filter((p: any) => p.method === "cash")
    .reduce((a: number, p: any) => a + Number(p.amount || 0), 0);
  const cancelCashBlocked = cancelCashBack > 0.004 && cancelShift?.status !== "open";
  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (cancelCashBlocked) throw new Error("No cash drawer shift is open — open a shift before refunding cash");
      const { data, error } = await (supabase.rpc as any)("cancel_sale", {
        _sale_id: cancelId,
        _reason: cancelReason.trim() || null,
        _client_request_id: cancelRequestId,
      });
      if (error) throw error;
      return data as { refunded: number };
    },
    onSuccess: (res) => {
      toast.success(
        Number(res?.refunded) > 0
          ? `Sale cancelled — ${fmt(Number(res.refunded))} refunded and stock restored`
          : "Sale cancelled — stock restored",
      );
      setCancelId(null);
      setCancelReason("");
      setDetailId(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Cancel failed"),
  });

  const sales = useMemo(
    () =>
      method === "all"
        ? allSales
        : allSales.filter((s) =>
            method === "due"
              ? Number(s.due) > 0.004
              : rangePayments.some((p) => p.sale_id === s.id && p.method === method && Number(p.amount) > 0),
          ),
    [allSales, method, rangePayments],
  );

  const totals = useMemo(() => {
    // Same status logic as Dashboard & Reports: only valid sales count towards money.
    const VALID = VALID_STATUSES;
    const valid = sales.filter((s) => VALID.has(s.status));
    const excluded = sales.filter((s) => !VALID.has(s.status));
    // Invoice Sales matches Reports exactly: every invoice raised in the range
    // except fully-reversed ("refunded") rows — cancelled (void) invoices stay
    // on their original day and are reversed at full value on the day they were
    // cancelled (below), so nothing is silently dropped.
    const dead = deadSaleIds(sales as any[], [...(rangeReturns as any[]), ...reversalRows] as any[]);
    const live = sales.filter((s) => !dead.has(s.id));
    const rev = live.reduce((a, s) => a + grossOf(s), 0);
    const paid = valid.reduce((a, s) => a + Number(s.paid), 0);
    const due = valid.reduce((a, s) => a + Number(s.due), 0);
    const excludedTotal = excluded.reduce((a, s) => a + Number(s.total), 0);
    const byMethod: Record<string, number> = {};
    // Do not group these rows under sales.created_at: later due collections,
    // split tenders and refunds must affect the date of payments.received_at.
    for (const p of rangePayments) {
      byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount);
    }
    // Net Sales = Invoice Sales − refunds/cancellations processed in this range.
    // A reversal only counts when the invoice it belongs to is actually part of
    // Invoice Sales here, or was raised BEFORE this range (previous-period
    // invoice → the reversal legitimately reduces this period). Reversals of
    // in-range invoices that are excluded (cancelled rows, status filter) must
    // NOT be subtracted — their value was never added in the first place.
    const { fromISO } = dayRangeISO(from, to);
    const liveIds = new Set(live.map((s) => s.id));
    const seen = new Set<string>();
    const refunds = (rangeReturns ?? []).reduce((a: number, r: any) => {
      const sale = r.sales;
      const raisedInRange = sale?.created_at ? sale.created_at >= fromISO : false;
      if (raisedInRange && !liveIds.has(r.sale_id)) return a;
      return a + reversalAmount(r, sale, seen);
    }, 0);
    const validRev = valid.reduce((a, s) => a + grossOf(s), 0);
    return { count: valid.length, rev, validRev, paid, due, refunds, net: rev - refunds, excludedCount: excluded.length, excludedTotal, byMethod };
  }, [sales, rangeReturns, reversalRows, rangePayments, from, to]);




  return (
    <div className="p-0 sm:p-2">
      <PageHeader
        title="Sales History"
        description="Search, filter and view every invoice"
        icon={History}
        actions={
          <div className="flex items-center gap-2">
            <ThermalPrinterSettings />
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RotateCcw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card className="border-2 border-primary"><CardContent className="p-4"><div className="text-xs font-semibold text-primary">Net Sales</div><div className={`text-xl sm:text-2xl font-bold ${totals.net >= 0 ? "text-primary" : "text-destructive"}`}>{fmt(totals.net)}</div><div className="text-[11px] text-muted-foreground mt-1">Invoice sales − refund {fmt(totals.refunds)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Valid invoices</div><div className="text-xl sm:text-2xl font-semibold">{totals.count}</div>{totals.excludedCount > 0 && <div className="text-[11px] text-muted-foreground mt-1">+{totals.excludedCount} cancelled/refunded ({fmt(totals.excludedTotal)}) excluded</div>}</CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Invoice Sales</div><div className="text-xl sm:text-2xl font-semibold">{fmt(totals.rev)}</div><div className="text-[11px] text-muted-foreground mt-1">valid {fmt(totals.validRev)} = paid {fmt(totals.paid)} + due {fmt(totals.due)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Paid</div><div className="text-xl sm:text-2xl font-semibold text-emerald-600">{fmt(totals.paid)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Due</div><div className={`text-xl sm:text-2xl font-semibold ${totals.due > 0 ? "text-destructive" : ""}`}>{fmt(totals.due)}</div></CardContent></Card>
      </div>

      <Card className="mb-4">
        <CardContent className="p-3 sm:p-4">
          <div className="text-xs text-muted-foreground mb-2">Actual payments received in selected date range</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {ALL_METHODS.map((m) => (
              <div key={m} className="rounded-lg border p-2">
                <Badge variant="secondary" className={`capitalize ${methodColor[m] ?? ""}`}>{m}</Badge>
                <div className="mt-1 text-sm font-semibold tabular-nums">{fmt(totals.byMethod[m] ?? 0)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>



      <Card className="mb-4">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <MobileFilterBar
            search={{ value: q, onChange: setQ, placeholder: "Search invoice no (INV-…)" }}
            groups={[
              {
                key: "status",
                label: "Status",
                value: status,
                onChange: setStatus,
                options: [
                  { value: "all", label: "All statuses" },
                  { value: "completed", label: "Completed" },
                  { value: "partial_refund", label: "Partially returned" },
                  { value: "refunded", label: "Refunded" },
                  { value: "pending", label: "Pending" },
                  { value: "void", label: "Cancelled" },
                ],
              },
              {
                key: "method",
                label: "Payment",
                value: method,
                onChange: setMethod,
                options: [
                  { value: "all", label: "All payments" },
                  ...ALL_METHODS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) })),
                  { value: "due", label: "Has due" },
                ],
              },
            ]}
            onClear={() => { setQ(""); setFrom(startOfMonth()); setTo(today()); setStatus("all"); setMethod("all"); }}
          />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 min-w-0 rounded-xl sm:h-9 sm:w-40" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 min-w-0 rounded-xl sm:h-9 sm:w-40" />
          </div>
        </CardContent>
      </Card>



      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isFetching && sales.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No sales found in this range.</TableCell></TableRow>}
              {sales.map((s) => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailId(s.id)}>
                  <TableCell>
                    <div className="font-medium">{s.invoice_no}</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(s.created_at), "dd MMM yyyy, hh:mm a")}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {s.owner?.full_name ?? <span className="text-muted-foreground">Walk-in</span>}
                    {s.owner?.phone && <div className="text-xs text-muted-foreground">{s.owner.phone}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(Number(s.total))}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600">{fmt(Number(s.paid))}</TableCell>
                  <TableCell className={`text-right tabular-nums ${Number(s.due) > 0 ? "text-destructive" : "text-muted-foreground"}`}>{fmt(Number(s.due))}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(s.payments ?? []).filter((p) => Number(p.amount) > 0).map((p, i) => (
                        <Badge key={i} variant="secondary" className={`capitalize text-[11px] ${methodColor[p.method] ?? ""}`}>
                          {p.method} {fmt(Number(p.amount))}
                        </Badge>
                      ))}
                      {Number(s.due) > 0 && (
                        <Badge variant="secondary" className="text-[11px] bg-destructive/10 text-destructive">Due {fmt(Number(s.due))}</Badge>
                      )}
                      {Number(s.due) > 0 && courierOrders[s.id] && courierOrders[s.id].status !== "failed" && (
                        <Badge variant="secondary" className="text-[11px] bg-sky-50 text-sky-700">
                          <Truck className="h-3 w-3" /> {courierOrders[s.id].courier === "steadfast" ? "Steadfast" : courierOrders[s.id].courier} Courier
                        </Badge>
                      )}
                      {s.status !== "void" && s.status !== "refunded" && (
                        // stopPropagation: the row click opened the invoice details
                        // behind the return sheet; invoiceNo pre-loads this invoice.
                        <span onClick={(e) => e.stopPropagation()}>
                          <ReturnFlow
                            invoiceNo={s.invoice_no}
                            trigger={<Button size="sm" variant="ghost" title="Return items"><RotateCcw className="h-4 w-4" /></Button>}
                          />
                        </span>
                      )}
                      {(s.payments ?? []).length === 0 && Number(s.due) <= 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>

                    <Badge variant="secondary" className={statusColor[s.status] ?? ""}>{s.status.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setDetailId(s.id)} title="View">
                        <Receipt className="h-4 w-4" />
                      </Button>
                      {Number(s.due) > 0 && (
                        <Button size="sm" variant="ghost" className="text-emerald-600" onClick={() => setDueSaleId(s.id)} title="Collect due payment">
                          <Wallet className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => reprint(s.id)} disabled={reprintingId === s.id} title="Reprint invoice">
                        <Printer className="h-4 w-4" />
                      </Button>
                      {isAdmin && s.status !== "void" && (
                        <Button size="sm" variant="ghost" onClick={() => setEditId(s.id)} title="Edit customer / note">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {isAdmin && s.status !== "void" && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setCancelId(s.id); setCancelReason(""); setCancelRequestId(crypto.randomUUID()); }} title="Cancel sale">
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                      {s.status !== "void" && (
                        <Button size="sm" variant="ghost" className={courierOrders[s.id] ? (courierStatusColor[courierOrders[s.id].status] ?? "text-blue-600") : "text-blue-600"} onClick={() => setCourierSaleId(s.id)} title={courierOrders[s.id] ? `Courier: ${courierOrders[s.id].status.replace(/_/g, " ")}` : "Send via courier"}>
                          <Truck className="h-4 w-4" />
                          {courierOrders[s.id] && <span className="ml-1 text-[11px] capitalize">{courierOrders[s.id].status.replace(/_/g, " ")}</span>}
                        </Button>
                      )}


                    </div>

                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
                {detail && courierOrders[detail.id] && (
                  <Button size="sm" variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" onClick={() => printCourierLabel(courierOrders[detail.id])}>
                    <Truck className="h-4 w-4" /> Label
                  </Button>
                )}
                <Button size="sm" variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" onClick={() => detail && sendWhatsApp(withDelivery(toReceipt(detail)), detail.id)}>
                  WhatsApp
                </Button>
                {detail && detail.status !== "void" && (
                  <Button size="sm" variant="outline" onClick={() => setDeliveryFor(detail.id)} title="Send for delivery">
                    <Bike className="h-4 w-4" />
                    {detailDelivery ? `Delivery · ${DELIVERY_STATUS_LABEL[detailDelivery.status]}` : "Delivery"}
                  </Button>
                )}
                {isAdmin && detail && (
                  <Button size="sm" variant="outline" onClick={() => setEditId(detail.id)}>
                    <Pencil className="h-4 w-4" /> Edit
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
                        <TableCell className="text-right tabular-nums">{fmt(Number(it.unit_price))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(Number(it.line_total))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{fmt(Number(detail.subtotal))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{fmt(Number(detail.tax))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">- {fmt(Number(detail.discount))}</span></div>
                <div className="flex justify-between font-semibold text-base border-t pt-1"><span>Total</span><span className="tabular-nums">{fmt(Number(detail.total))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums">{fmt(Number(detail.paid))}</span></div>
                {Number(detail.due) > 0 && <div className="flex justify-between text-destructive font-medium"><span>Due</span><span className="tabular-nums">{fmt(Number(detail.due))}</span></div>}
              </div>

              {detail.payments.length > 0 && (
                <div className="border rounded p-2 text-xs space-y-1">
                  <div className="font-medium text-sm">Payments</div>
                  {detail.payments.map((p) => (
                    <div key={p.id} className="flex justify-between">
                      <span className="capitalize">{p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                      <span className="tabular-nums">{fmt(Number(p.amount))}</span>
                    </div>
                  ))}
                </div>
              )}

              {detail.notes && <div className="text-xs text-muted-foreground border-t pt-2">Note: {detail.notes}</div>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SaleEditDialog
        sale={editSale ?? null}
        open={!!editId}
        onOpenChange={(o) => !o && setEditId(null)}
        onSaved={() => { refetch(); setDetailId(null); }}
      />

      <CollectDueDialog
        sale={dueSaleId ? (() => { const s = sales.find((x) => x.id === dueSaleId); return s ? { id: s.id, invoice_no: s.invoice_no, due: Number(s.due), owner: s.owner } : null; })() : null}
        open={!!dueSaleId}
        onOpenChange={(o) => !o && setDueSaleId(null)}
        onCollected={() => { refetch(); setDueSaleId(null); }}
      />

      <Dialog open={!!cancelId} onOpenChange={(o) => { if (!o) { setCancelId(null); setCancelReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel sale — {cancelSaleRow?.invoice_no}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span>{cancelSaleRow?.owner?.full_name ?? "Walk-in"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="tabular-nums">{fmt(Number(cancelSaleRow?.total ?? 0))}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid (will be refunded)</span><span className="tabular-nums text-destructive">{fmt(Number(cancelSaleRow?.paid ?? 0))}</span></div>
            </div>
            <p className="text-xs text-muted-foreground">
              Cancelling returns all remaining items to stock, refunds each collected payment to its original method, clears unpaid due and marks the invoice as cancelled. This cannot be undone.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium">Reason (optional)</label>
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. wrong entry / customer returned" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCancelId(null)}>Back</Button>
            {cancelCashBlocked && (
              <p className="mr-auto self-center text-xs text-destructive">Open a cash drawer shift first — ৳{cancelCashBack.toFixed(2)} cash will be paid back.</p>
            )}
            <Button variant="destructive" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending || cancelCashBlocked}>
              {cancelMutation.isPending ? "Cancelling…" : "Cancel sale"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CourierDialog
        saleId={courierSaleId}
        onClose={() => setCourierSaleId(null)}
        onSaved={() => refetchCouriers()}
      />


      <DeliveryDialog
        saleId={deliveryFor}
        open={!!deliveryFor}
        onOpenChange={(o) => !o && setDeliveryFor(null)}
        onCreated={() => void refetchDetailDelivery()}
      />
    </div>
  );
}

