import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Search, Wallet, Printer, Truck, Store } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollectDueDialog } from "@/components/CollectDueDialog";
import { BillStatusBadge, type BillStatus } from "@/components/BillStatusBadge";
import { printInvoice, type Receipt as PrintReceipt } from "@/lib/invoice-print";

export type DueSale = {
  id: string;
  invoice_no: string;
  created_at: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  due: number;
  status: string;
  notes: string | null;
  owner: { id: string; full_name: string; phone: string | null } | null;
  sale_items: { id: string; name: string; quantity: number; unit_price: number; discount: number; tax: number; line_total: number }[];
  payments: { id: string; method: string; amount: number; reference: string | null }[];
  courier: CourierInfo | CourierInfo[] | null;
};

type CourierInfo = { courier: string; status: string; consignment_id: string | null; tracking_code: string | null };

/** The courier order of a sale, ignoring ones that failed to reach the courier. */
function courierOf(s: DueSale): CourierInfo | null {
  const c = Array.isArray(s.courier) ? s.courier[0] : s.courier;
  if (!c || c.status === "failed") return null;
  return c;
}

const COURIER_NAMES: Record<string, string> = { steadfast: "Steadfast" };
const COURIER_STATUS: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  in_review: "In review",
  picked_up: "Picked up",
  in_transit: "In transit",
  hold: "On hold",
  delivered: "Delivered",
  partial_delivered: "Partly delivered",
  cancelled: "Cancelled",
};

function CourierBadge({ c }: { c: CourierInfo }) {
  const name = COURIER_NAMES[c.courier] ?? c.courier;
  const status = COURIER_STATUS[c.status] ?? c.status.replace(/_/g, " ");
  const tone =
    c.status === "delivered"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : c.status === "cancelled"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-sky-300 bg-sky-50 text-sky-700";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
      title={c.tracking_code ? `Tracking: ${c.tracking_code}` : undefined}
    >
      <Truck className="h-3 w-3" /> {name} Courier · {status}
    </span>
  );
}

const fmt = (n: number) =>
  `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Filter = "shop" | "courier" | "paid" | "all";

function billStatus(s: DueSale): BillStatus {
  if (Number(s.due) <= 0.009) return "paid";
  if (Number(s.paid) > 0.009) return "partial";
  return "due";
}

function toReceipt(s: DueSale): PrintReceipt {
  return {
    invoice_no: s.invoice_no,
    subtotal: Number(s.subtotal),
    tax: Number(s.tax),
    discount: Number(s.discount),
    total: Number(s.total),
    paid: Number(s.paid),
    due: Number(s.due),
    method: s.payments[0]?.method ?? "due",
    issued_at: s.created_at,
    owner: s.owner ? { full_name: s.owner.full_name, phone: s.owner.phone } : null,
    status: s.status,
    notes: s.notes,
    items: s.sale_items.map((it) => ({
      name: it.name,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      discount: Number(it.discount),
      tax: Number(it.tax),
      line_total: Number(it.line_total),
    })),
    payments: s.payments.map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
  };
}

export function DueBillsList() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("shop");
  const [collect, setCollect] = useState<DueSale | null>(null);

  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ["due-bills"],
    queryFn: async () => {
      // Page through everything: a hard .limit() silently dropped the oldest
      // outstanding invoices, so the header totals never matched Receivables.
      const rows = await fetchAll<DueSale>(() =>
        supabase
          .from("sales")
          .select(
            "id,invoice_no,created_at,subtotal,discount,tax,total,paid,due,status,notes, owner:pet_owners(id,full_name,phone), sale_items(id,name,quantity,unit_price,discount,tax,line_total), payments(id,method,amount,reference), courier:courier_orders(courier,status,consignment_id,tracking_code)",
          )
          .neq("status", "void")
          .order("created_at", { ascending: false }),
      );
      return rows;
    },
  });


  const rows = useMemo(() => {
    let list = data;
    // Shop due = counter sales still unpaid; courier due = COD orders with the
    // courier. Kept apart so courier money is followed up with the courier and
    // shop due with the customer.
    if (filter === "shop") list = list.filter((s) => Number(s.due) > 0.009 && !courierOf(s));
    if (filter === "courier") list = list.filter((s) => Number(s.due) > 0.009 && !!courierOf(s));
    if (filter === "paid") list = list.filter((s) => Number(s.due) <= 0.009);
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (s) =>
        s.invoice_no.toLowerCase().includes(term) ||
        (s.owner?.full_name ?? "walk-in").toLowerCase().includes(term) ||
        (s.owner?.phone ?? "").includes(term),
    );
  }, [data, filter, q]);

  const report = useMemo(() => {
    const due = data.filter((s) => Number(s.due) > 0.009);
    const shop = due.filter((s) => !courierOf(s));
    const courier = due.filter((s) => !!courierOf(s));
    const sum = (list: DueSale[]) => list.reduce((a, s) => a + Number(s.due), 0);
    return {
      totalDue: sum(due),
      totalCount: due.length,
      shopDue: sum(shop),
      shopCount: shop.length,
      courierDue: sum(courier),
      courierCount: courier.length,
      collected: due.reduce((a, s) => a + Number(s.paid), 0),
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button type="button" className="text-left" onClick={() => setFilter("shop")}>
          <Card className={filter === "shop" ? "ring-2 ring-primary" : ""}><CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Store className="h-3.5 w-3.5" /> Shop due</div>
            <div className="text-2xl font-semibold tabular-nums text-destructive">{fmt(report.shopDue)}</div>
            <div className="text-xs text-muted-foreground">{report.shopCount} bill{report.shopCount === 1 ? "" : "s"} · collect from customer</div>
          </CardContent></Card>
        </button>
        <button type="button" className="text-left" onClick={() => setFilter("courier")}>
          <Card className={filter === "courier" ? "ring-2 ring-sky-500" : ""}><CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Truck className="h-3.5 w-3.5" /> Courier due</div>
            <div className="text-2xl font-semibold tabular-nums text-sky-700">{fmt(report.courierDue)}</div>
            <div className="text-xs text-muted-foreground">{report.courierCount} bill{report.courierCount === 1 ? "" : "s"} · with the courier</div>
          </CardContent></Card>
        </button>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total outstanding</div>
          <div className="text-2xl font-semibold tabular-nums">{fmt(report.totalDue)}</div>
          <div className="text-xs text-muted-foreground">{report.totalCount} due bills</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Already collected</div>
          <div className="text-2xl font-semibold tabular-nums">{fmt(report.collected)}</div>
          <div className="text-xs text-muted-foreground">part payments on due bills</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search invoice no, customer or phone"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8"
              />
            </div>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="shop">Shop due ({report.shopCount})</TabsTrigger>
                <TabsTrigger value="courier">Courier due ({report.courierCount})</TabsTrigger>
                <TabsTrigger value="paid">Paid / Completed</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="-mx-3 overflow-x-auto sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice No</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
                )}
                {!isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No bills found.</TableCell></TableRow>
                )}
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.invoice_no}</div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(s.created_at), "dd MMM yyyy, hh:mm a")}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.owner?.full_name ?? <span className="text-muted-foreground">Walk-in</span>}
                      {s.owner?.phone && <div className="text-xs text-muted-foreground">{s.owner.phone}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.paid)}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {Number(s.due) > 0.009 ? fmt(s.due) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <BillStatusBadge status={billStatus(s)} />
                        {courierOf(s) && <CourierBadge c={courierOf(s)!} />}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => printInvoice(toReceipt(s))}>
                          <Printer className="h-4 w-4" />
                        </Button>
                        {Number(s.due) > 0.009 && (
                          <Button size="sm" onClick={() => setCollect(s)}>
                            <Wallet className="h-4 w-4" /> Collect
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <CollectDueDialog
        sale={collect}
        open={!!collect}
        onOpenChange={(o) => !o && setCollect(null)}
        onCollected={() => { setCollect(null); refetch(); }}
      />
    </div>
  );
}
