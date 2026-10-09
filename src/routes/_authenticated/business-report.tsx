import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Download, Info, LineChart, Printer, XCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/report/DataTable";
import { monthStartDhaka, todayDhaka } from "@/lib/sales-ledger";
import { shiftDay } from "@/lib/sales-summary";
import {
  METHOD_LABEL,
  buildInsights,
  changePct,
  computePeriod,
  computeSnapshot,
  loadPeriod,
  loadSnapshot,
  previousPeriod,
  type Computed,
} from "@/lib/business-report";
import { PROFIT_NOTES, exportBusinessExcel, printBusinessReport, profitLines } from "@/lib/business-report-export";
import type { Shipment } from "@/lib/shipments";

export const Route = createFileRoute("/_authenticated/business-report")({
  head: () => ({
    meta: [
      { title: "Business Report — Profit, Stock, Delivery & Clinic | Pet Care Vet ERP" },
      { name: "description", content: "Monthly business performance: sales, net profit, stock value, delivery, clinic revenue, expenses and cash." },
      { property: "og:title", content: "Business Report | Pet Care Vet ERP" },
      { property: "og:description", content: "Complete monthly business report from real transactions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BusinessReportPage,
});

const fmt = (v: number) => { const x = Math.round(Number(v) || 0); return `${x < 0 ? "−" : ""}৳${Math.abs(x).toLocaleString("en-BD")}`; };
const fmt2 = (v: number) => { const x = Number(v) || 0; return `${x < 0 ? "−" : ""}৳${Math.abs(x).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`; };
const pctTxt = (v: number) => `${(Number(v) || 0).toFixed(1)}%`;

type Preset = "today" | "week" | "month" | "lastMonth" | "year" | "custom";
function rangeFor(p: Preset): { from: string; to: string } {
  const t = todayDhaka();
  if (p === "today") return { from: t, to: t };
  if (p === "week") return { from: shiftDay(t, -6), to: t };
  if (p === "year") return { from: `${t.slice(0, 4)}-01-01`, to: t };
  if (p === "lastMonth") {
    const end = shiftDay(monthStartDhaka(), -1);
    return { from: `${end.slice(0, 7)}-01`, to: end };
  }
  return { from: monthStartDhaka(), to: t };
}

// ---------------------------------------------------------------------------

function Change({ cur, prev, invert = false }: { cur: number; prev?: number; invert?: boolean }) {
  if (prev == null) return null;
  const ch = changePct(cur, prev);
  if (ch == null) return <span className="text-[11px] text-muted-foreground">prev {fmt(prev)}</span>;
  const good = invert ? ch <= 0 : ch >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${good ? "text-emerald-700" : "text-destructive"}`} title={`Previous: ${fmt2(prev)}`}>
      {ch >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(ch).toFixed(1)}%
    </span>
  );
}

function Kpi({ label, value, prev, sub, tone = "", invert, onClick, raw }: { label: string; value: number; prev?: number; sub?: ReactNode; tone?: string; invert?: boolean; onClick?: () => void; raw?: string }) {
  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} className={`rounded-xl border bg-card p-3.5 text-left ${onClick ? "transition-colors hover:border-primary/50 hover:bg-primary/[0.03]" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums tracking-tight sm:text-xl ${tone}`}>{raw ?? fmt(value)}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
        <Change cur={value} prev={prev} invert={invert} />
        {sub}
      </div>
    </Comp>
  );
}

function Section({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Lines({ rows }: { rows: { label: string; value: number; strong?: boolean; hint?: string }[] }) {
  return (
    <div className="divide-y text-sm">
      {rows.map((l, i) => (
        <div key={i} className={`flex items-baseline justify-between gap-3 py-1.5 ${l.strong ? "font-semibold" : ""}`}>
          <span className={l.strong ? "" : "text-muted-foreground"}>{l.label}{l.hint && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{l.hint}</span>}</span>
          <span className={`tabular-nums ${l.value < 0 ? "text-destructive" : ""}`}>{fmt2(l.value)}</span>
        </div>
      ))}
    </div>
  );
}

type Detail = { title: string; rows: any[]; columns: Column<any>[] } | null;

// ---------------------------------------------------------------------------

function BusinessReportPage() {
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(rangeFor("month"));
  const [compare, setCompare] = useState(true);
  const [detail, setDetail] = useState<Detail>(null);
  const prev = useMemo(() => previousPeriod(range), [range]);

  const curQ = useQuery({ queryKey: ["business-report", range.from, range.to], queryFn: () => loadPeriod(range), staleTime: 60_000 });
  const prevQ = useQuery({ queryKey: ["business-report", prev.from, prev.to], queryFn: () => loadPeriod(prev), enabled: compare, staleTime: 5 * 60_000 });
  const snapQ = useQuery({ queryKey: ["business-snapshot"], queryFn: loadSnapshot, staleTime: 60_000 });

  const c = useMemo(() => (curQ.data ? computePeriod(curQ.data) : null), [curQ.data]);
  const p = useMemo(() => (compare && prevQ.data ? computePeriod(prevQ.data) : null), [compare, prevQ.data]);
  const s = useMemo(() => (snapQ.data ? computeSnapshot(snapQ.data) : null), [snapQ.data]);
  const insights = useMemo(() => (c ? buildInsights(c, p, s) : []), [c, p, s]);

  const choose = (k: Preset) => { setPreset(k); if (k !== "custom") setRange(rangeFor(k)); };
  const chip = (on: boolean) => `h-8 rounded-md border px-3 text-xs font-medium transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;
  const loading = curQ.isLoading || snapQ.isLoading;
  const error = curQ.error || snapQ.error;

  return (
    <div className="min-w-0">
      <PageHeader
        title="Business Report"
        description="Sales, profit, stock, delivery, clinic and cash — from real transactions."
        icon={LineChart}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!c} onClick={() => c && printBusinessReport(c, p, s, insights)}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            <Button variant="outline" disabled={!c} onClick={() => c && exportBusinessExcel(c, p, s)}>
              <Download className="h-4 w-4" /> Excel
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
          {([["today", "Daily"], ["week", "Weekly"], ["month", "Monthly"], ["lastMonth", "Last month"], ["year", "Yearly"], ["custom", "Custom"]] as [Preset, string][]).map(([k, l]) => (
            <button key={k} type="button" className={chip(preset === k)} onClick={() => choose(k)}>{l}</button>
          ))}
          <div className="flex items-center gap-1.5">
            <Input type="date" value={range.from} max={range.to} onChange={(e) => { if (e.target.value) { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); } }} className="h-8 w-[9.5rem] text-xs" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={range.to} min={range.from} onChange={(e) => { if (e.target.value) { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); } }} className="h-8 w-[9.5rem] text-xs" />
          </div>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-[var(--primary)]" />
            Compare with {format(new Date(`${prev.from}T12:00:00`), "d MMM")} – {format(new Date(`${prev.to}T12:00:00`), "d MMM yyyy")}
          </label>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load the report: {(error as any)?.message ?? String(error)}
        </div>
      ) : loading || !c ? (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <Tabs defaultValue="summary" className="min-w-0">
          <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
            <TabsList className="mb-3 w-max">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="sales">Sales & Profit</TabsTrigger>
              <TabsTrigger value="stock">Inventory</TabsTrigger>
              <TabsTrigger value="delivery">Delivery</TabsTrigger>
              <TabsTrigger value="clinic">Clinic</TabsTrigger>
              <TabsTrigger value="returns">Returns</TabsTrigger>
              <TabsTrigger value="cash">Expenses & Cash</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="summary"><SummaryTab c={c} p={p} s={s} insights={insights} setDetail={setDetail} /></TabsContent>
          <TabsContent value="sales"><SalesTab c={c} p={p} s={s} setDetail={setDetail} /></TabsContent>
          <TabsContent value="stock"><StockTab c={c} s={s} /></TabsContent>
          <TabsContent value="delivery"><DeliveryTab c={c} p={p} /></TabsContent>
          <TabsContent value="clinic"><ClinicTab c={c} p={p} /></TabsContent>
          <TabsContent value="returns"><ReturnsTab c={c} p={p} /></TabsContent>
          <TabsContent value="cash"><CashTab c={c} p={p} s={s} /></TabsContent>
        </Tabs>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>{detail?.title}</DialogTitle></DialogHeader>
          {detail && <DataTable rows={detail.rows} columns={detail.columns} pageSize={20} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail views (click a number to see the transactions behind it)

const invoiceCols: Column<any>[] = [
  { key: "created_at", label: "Date", render: (r) => format(new Date(r.created_at), "d MMM yyyy"), value: (r) => r.created_at },
  { key: "invoice_no", label: "Invoice" },
  { key: "customer", label: "Customer", value: (r) => r.owner?.full_name ?? "Walk-in" },
  { key: "status", label: "Status", render: (r) => <span className="capitalize">{String(r.status).replace(/_/g, " ")}</span> },
  { key: "total", label: "Total", align: "right", value: (r) => Number(r.total), render: (r) => fmt2(r.total) },
  { key: "paid", label: "Paid", align: "right", value: (r) => Number(r.paid), render: (r) => fmt2(r.paid) },
  { key: "due", label: "Due", align: "right", value: (r) => Number(r.due), render: (r) => fmt2(r.due) },
];
const returnCols: Column<any>[] = [
  { key: "date", label: "Date", render: (r) => format(new Date(r.date), "d MMM yyyy"), value: (r) => r.date },
  { key: "returnNo", label: "Return" },
  { key: "invoiceNo", label: "Invoice" },
  { key: "type", label: "Type" },
  { key: "value", label: "Value", align: "right", render: (r) => fmt2(r.value) },
  { key: "refundPaid", label: "Refunded", align: "right", render: (r) => fmt2(r.refundPaid) },
  { key: "dueReduction", label: "Due reduced", align: "right", render: (r) => fmt2(r.dueReduction) },
  { key: "restock", label: "Restocked", value: (r) => (r.restock ? "Yes" : "No") },
  { key: "reason", label: "Reason" },
];
const expenseCols: Column<any>[] = [
  { key: "expense_date", label: "Date" },
  { key: "category", label: "Category" },
  { key: "paid_to", label: "Paid to" },
  { key: "method", label: "Method", value: (r) => METHOD_LABEL[r.method] ?? r.method },
  { key: "amount", label: "Amount", align: "right", value: (r) => Number(r.amount), render: (r) => fmt2(r.amount) },
  { key: "notes", label: "Notes" },
];
const purchaseCols: Column<any>[] = [
  { key: "invoice_date", label: "Date" },
  { key: "invoice_no", label: "Purchase" },
  { key: "supplier", label: "Supplier", value: (r) => r.suppliers?.name ?? "—" },
  { key: "total", label: "Total", align: "right", value: (r) => Number(r.total), render: (r) => fmt2(r.total) },
  { key: "paid", label: "Paid", align: "right", value: (r) => Number(r.paid), render: (r) => fmt2(r.paid) },
  { key: "due", label: "Due", align: "right", value: (r) => Number(r.due), render: (r) => fmt2(r.due) },
];
const parcelCols: Column<Shipment>[] = [
  { key: "at", label: "Date", render: (r) => format(new Date(r.at), "d MMM"), value: (r) => r.at },
  { key: "invoiceNo", label: "Invoice" },
  { key: "customer", label: "Customer", render: (r) => <span>{r.customer}<span className="block text-[11px] text-muted-foreground">{r.phone}</span></span> },
  { key: "kind", label: "Type", value: (r) => (r.kind === "courier" ? "Courier" : "Local") },
  { key: "agent", label: "Rider / Courier", render: (r) => <span>{r.agent}{r.tracking && <span className="block text-[11px] text-muted-foreground">#{r.tracking}</span>}</span> },
  { key: "statusLabel", label: "Status" },
  { key: "charge", label: "Charge", align: "right", value: (r) => r.chargeIncome, render: (r) => fmt(r.chargeIncome) },
  { key: "cost", label: "Actual cost", align: "right", value: (r) => r.cost ?? -1, render: (r) => (r.cost == null ? <span className="text-amber-700">not entered</span> : fmt(r.cost)) },
  { key: "collect", label: "COD / collect", align: "right", render: (r) => fmt(r.collect) },
  { key: "pay", label: "Payment", value: (r) => (r.kind === "courier" ? (r.codReceived != null ? "COD received" : "Pending") : r.cashReceived ? "Cash received" : "Pending") },
];

// ---------------------------------------------------------------------------

function SummaryTab({ c, p, s, insights, setDetail }: { c: Computed; p: Computed | null; s: ReturnType<typeof computeSnapshot> | null; insights: ReturnType<typeof buildInsights>; setDetail: (d: Detail) => void }) {
  const bal = s?.balances ?? {};
  const toneIcon = { good: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, warn: <AlertTriangle className="h-4 w-4 text-amber-600" />, bad: <XCircle className="h-4 w-4 text-destructive" />, info: <Info className="h-4 w-4 text-sky-600" /> };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total sales" value={c.sales.invoiceSales} prev={p?.sales.invoiceSales} sub={`${c.sales.count} invoices`} onClick={() => setDetail({ title: "Invoices in this period", rows: c.raw.live, columns: invoiceCols })} />
        <Kpi label="Net sales" value={c.sales.netSales} prev={p?.sales.netSales} sub="after returns" />
        <Kpi label="Total purchase" value={c.purchases.total} prev={p?.purchases.total} invert sub={`${c.purchases.count} bills`} onClick={() => setDetail({ title: "Purchases in this period", rows: c.raw.purchases, columns: purchaseCols })} />
        <Kpi label="Gross profit" value={c.grossProfit} prev={p?.grossProfit} sub={pctTxt(c.grossMargin)} tone="text-emerald-700" />
        <Kpi label="Net profit" value={c.netProfit} prev={p?.netProfit} sub={pctTxt(c.netMargin)} tone={c.netProfit < 0 ? "text-destructive" : "text-emerald-700"} />
        <Kpi label="Total expenses" value={c.opex} prev={p?.opex} invert sub="operating" onClick={() => setDetail({ title: "Expenses in this period", rows: c.opexRows, columns: expenseCols })} />
        <Kpi label="Current stock value" value={s?.stockValue ?? 0} sub="at cost, today" />
        <Kpi label="Returns & refunds" value={c.sales.reversals} prev={p?.sales.reversals} invert sub={`${c.returns.count} returns`} onClick={() => setDetail({ title: "Returns & cancellations", rows: c.returns.rows, columns: returnCols })} />
        <Kpi label="Cancelled orders" value={c.sales.cancelledValue} raw={String(c.sales.cancelledInvoices + c.delivery.cancelledDeliveries)} sub={`${c.sales.cancelledInvoices} invoices · ${c.delivery.cancelledDeliveries} parcels`} />
        <Kpi label="Customer due" value={s?.receivable ?? 0} sub="receivable, today" onClick={() => s && setDetail({ title: "Unpaid invoices", rows: s.dueRows, columns: invoiceCols })} />
        <Kpi label="Supplier payable" value={s?.payable ?? 0} sub="today" />
        <Kpi label="Delivery charges collected" value={c.delivery.income} prev={p?.delivery.income} sub="delivered parcels" />
        <Kpi label="Delivery expenses" value={c.delivery.cost} prev={p?.delivery.cost} invert sub={c.delivery.costMissing ? `${c.delivery.costMissing} not entered` : "rider + courier"} />
        <Kpi label="Doctor & clinic revenue" value={c.sales.clinicNet} prev={p?.sales.clinicNet} sub={`${c.clinic.consultations} consultations`} />
        <Kpi label="Cash balance" value={bal.cash ?? 0} sub="all time" />
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {(["bkash", "nagad", "rocket", "bank"] as const).map((m) => (
          <Kpi key={m} label={`${METHOD_LABEL[m]} balance`} value={bal[m] ?? 0} sub="all time" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Profit & loss">
          <Lines rows={profitLines(c)} />
          <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            {PROFIT_NOTES.map((t) => <li key={t}>• {t}</li>)}
          </ul>
        </Section>
        <div className="space-y-4">
          <Section title="Alerts & insights">
            <ul className="space-y-2">
              {insights.map((i, k) => (
                <li key={k} className="flex items-start gap-2 text-sm">{toneIcon[i.tone]}<span>{i.text}</span></li>
              ))}
              {!insights.length && <li className="text-sm text-muted-foreground">Nothing unusual in this period.</li>}
            </ul>
          </Section>
          <Section title="Collections by payment method">
            <Lines rows={[
              ...Object.entries(c.collected).sort((a, b) => b[1] - a[1]).map(([m, v]) => ({ label: METHOD_LABEL[m] ?? m, value: v })),
              { label: "Refunds paid out", value: -c.refundsPaid },
              { label: "Credit (due) sales this period", value: c.sales.creditSales, hint: "not yet collected" },
            ]} />
          </Section>
        </div>
      </div>

      <Section title="Daily net sales & gross profit">
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={c.daily.map((d) => ({ ...d, label: format(new Date(`${d.day}T12:00:00`), "d MMM") }))} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip formatter={(v: any) => fmt2(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="net" name="Net sales" fill="var(--primary)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="profit" name="Gross profit" fill="#059669" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Delivery">
          <Lines rows={[
            { label: `Local — ${c.delivery.local.delivered}/${c.delivery.local.total} delivered`, value: c.delivery.localMoney.net, hint: "net" },
            { label: `Courier — ${c.delivery.courier.delivered}/${c.delivery.courier.total} delivered`, value: c.delivery.courierMoney.net, hint: "net" },
            { label: "Charges collected", value: c.delivery.income },
            { label: "Actual delivery cost", value: -c.delivery.cost },
            { label: "Net delivery income", value: c.delivery.net, strong: true },
          ]} />
        </Section>
        <Section title="Clinic">
          <Lines rows={[
            { label: "Clinic revenue", value: c.clinic.revenue },
            { label: "Doctor & clinic expenses", value: -c.clinic.expenses },
            { label: "Net clinic income", value: c.clinic.net, strong: true },
            { label: "Shop net sales", value: c.sales.shopNet },
          ]} />
        </Section>
        <Section title="Cash position (today)">
          <Lines rows={[
            ...Object.entries(bal).map(([m, v]) => ({ label: METHOD_LABEL[m] ?? m, value: v })),
            { label: "Customer due", value: s?.receivable ?? 0 },
            { label: "Supplier payable", value: -(s?.payable ?? 0) },
          ]} />
          {s?.drawer?.expected_cash != null && (
            <p className="mt-2 text-[11px] text-muted-foreground">Cash drawer ({String(s.drawer.status)} shift): expected {fmt2(Number(s.drawer.expected_cash))}. Only cash is in the drawer — bKash, Nagad, Rocket and bank are separate balances.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function SalesTab({ c, p, s, setDetail }: { c: Computed; p: Computed | null; s: ReturnType<typeof computeSnapshot> | null; setDetail: (d: Detail) => void }) {
  const byRev = [...c.products].sort((a, b) => b.revenue - a.revenue);
  const slow = [...c.products].filter((x) => x.qty > 0 && !x.key.startsWith("svc:")).sort((a, b) => a.qty - b.qty).slice(0, 10);
  const prodCols: Column<(typeof c.products)[number]>[] = [
    { key: "name", label: "Product", render: (r) => <span>{r.name.trim()}<span className="block text-[11px] text-muted-foreground">{r.category}</span></span> },
    { key: "qty", label: "Qty", align: "right", render: (r) => Math.round(r.qty * 100) / 100 },
    { key: "revenue", label: "Revenue", align: "right", render: (r) => fmt(r.revenue) },
    { key: "cost", label: "COGS", align: "right", render: (r) => fmt(r.cost) },
    { key: "profit", label: "Gross profit", align: "right", render: (r) => <span className={r.profit < 0 ? "text-destructive" : ""}>{fmt(r.profit)}</span> },
    { key: "margin", label: "Margin", align: "right", render: (r) => pctTxt(r.margin) },
  ];
  const g = c.collectedGroups;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Sales before discount" value={c.sales.beforeDiscount} prev={p?.sales.beforeDiscount} />
        <Kpi label="Discounts" value={c.sales.discounts} prev={p?.sales.discounts} invert />
        <Kpi label="Net sales" value={c.sales.netSales} prev={p?.sales.netSales} />
        <Kpi label="Cost of goods sold" value={c.cogs} prev={p?.cogs} invert />
        <Kpi label="Cash collected" value={g.cash} prev={p?.collectedGroups.cash} />
        <Kpi label="Mobile banking" value={g.mobile} prev={p?.collectedGroups.mobile} sub="bKash · Nagad · Rocket" />
        <Kpi label="Bank & card" value={g.bank} prev={p?.collectedGroups.bank} />
        <Kpi label="Credit / due sales" value={c.sales.creditSales} prev={p?.sales.creditSales} invert onClick={() => setDetail({ title: "Invoices with due", rows: c.raw.live.filter((x: any) => Number(x.due) > 0.004), columns: invoiceCols })} />
      </div>

      <Section title="Day by day">
        <DataTable
          rows={c.daily}
          initialSort={{ key: "day", dir: "desc" }}
          columns={[
            { key: "day", label: "Date", render: (r) => format(new Date(`${r.day}T12:00:00`), "EEE, d MMM") },
            { key: "sales", label: "Invoice sales", align: "right", render: (r) => fmt(r.sales) },
            { key: "reversals", label: "Returns", align: "right", render: (r) => fmt(r.reversals) },
            { key: "net", label: "Net sales", align: "right", render: (r) => fmt(r.net) },
            { key: "cogs", label: "COGS", align: "right", render: (r) => fmt(r.cogs) },
            { key: "profit", label: "Gross profit", align: "right", render: (r) => fmt(r.profit) },
            { key: "clinic", label: "Clinic", align: "right", render: (r) => fmt(r.clinic) },
          ]}
        />
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Category-wise sales & margin">
          <DataTable rows={c.categories} searchable={false} initialSort={{ key: "revenue", dir: "desc" }} columns={[
            { key: "category", label: "Category" },
            { key: "revenue", label: "Revenue", align: "right", render: (r) => fmt(r.revenue) },
            { key: "profit", label: "Gross profit", align: "right", render: (r) => fmt(r.profit) },
            { key: "margin", label: "Margin", align: "right", render: (r) => pctTxt(r.margin) },
          ]} />
        </Section>
        <Section title="Purchases by supplier" action={<span className="text-xs text-muted-foreground">Net of returns {fmt(c.purchases.net)}</span>}>
          <DataTable rows={c.purchases.bySupplier} searchable={false} initialSort={{ key: "total", dir: "desc" }} columns={[
            { key: "supplier", label: "Supplier" },
            { key: "invoices", label: "Bills", align: "right" },
            { key: "total", label: "Total", align: "right", render: (r) => fmt(r.total) },
            { key: "due", label: "Still due", align: "right", render: (r) => fmt(r.due) },
          ]} />
          <p className="mt-2 text-[11px] text-muted-foreground">Purchases add stock — they are not an expense. Supplier payments this period: {fmt(c.purchases.supplierPaid)} · total payable today: {fmt(s?.payable ?? 0)}.</p>
        </Section>
      </div>

      <Section title="Product-wise sales, profit & margin">
        <DataTable rows={byRev} columns={prodCols} initialSort={{ key: "revenue", dir: "desc" }} />
      </Section>

      <Section title="Slow sellers (sold in this period)">
        <DataTable rows={slow} columns={prodCols} searchable={false} />
        <p className="mt-2 text-[11px] text-muted-foreground">Products with stock but no sale at all are in Inventory → stock list.</p>
      </Section>
    </div>
  );
}

function StockTab({ c, s }: { c: Computed; s: ReturnType<typeof computeSnapshot> | null }) {
  if (!s) return null;
  const adj = Object.entries(c.stockAdj.byReason).map(([reason, v]) => ({ reason, ...v }));
  const soldKeys = new Set(c.products.map((x) => x.key));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Stock value (at cost)" value={s.stockValue} sub="latest purchase cost" />
        <Kpi label="Stock at selling price" value={s.retailValue} sub={`potential margin ${fmt(s.retailValue - s.stockValue)}`} />
        <Kpi label="Units in stock" value={s.units} raw={Math.round(s.units).toLocaleString("en-BD")} sub={`${s.low} low · ${s.out} out`} />
        <Kpi label="Expired / expiring" value={s.expiredValue + s.expiringValue} sub={`expired ${fmt(s.expiredValue)} · 30 days ${fmt(s.expiringValue)}`} tone={s.expiredValue ? "text-destructive" : ""} />
        <Kpi label="Stock written off" value={c.stockAdj.loss} sub="damage · expired · loss (this period)" tone={c.stockAdj.loss ? "text-destructive" : ""} />
        <Kpi label="Stock found" value={c.stockAdj.found} sub="this period" />
        <Kpi label="Purchased this period" value={c.purchases.total} />
        <Kpi label="Sold at cost (COGS)" value={c.cogs} />
      </div>
      <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        Costing method: <b>latest purchase cost</b> per product (the cost the system records at every purchase and copies onto each sale line as COGS). Selling prices are never used for stock value.
        Products with negative stock ({s.negative}) count as zero — correct their stock with a Stock Adjustment.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Stock by category">
          <DataTable rows={s.categories} searchable={false} initialSort={{ key: "value", dir: "desc" }} columns={[
            { key: "category", label: "Category" },
            { key: "products", label: "Products", align: "right" },
            { key: "units", label: "Units", align: "right", render: (r) => Math.round(r.units) },
            { key: "value", label: "Value at cost", align: "right", render: (r) => fmt(r.value) },
            { key: "retail", label: "At selling price", align: "right", render: (r) => fmt(r.retail) },
          ]} />
        </Section>
        <Section title="Stock movement in this period">
          <Lines rows={[
            { label: "Purchased (bills)", value: c.purchases.total },
            { label: "Purchase returns", value: -c.purchases.returns },
            { label: "Sold (at cost)", value: -c.cogsSold },
            { label: "Customer returns back to stock (at cost)", value: c.cogsBack },
            ...adj.map((a) => ({ label: `Adjustment — ${a.reason} (${a.qty > 0 ? "+" : ""}${a.qty})`, value: a.value })),
          ]} />
          <p className="mt-2 text-[11px] text-muted-foreground">Closing stock value today: {fmt(s.stockValue)}.</p>
        </Section>
      </div>

      <Section title="Low, out of stock & negative">
        <DataTable rows={s.lowRows} columns={[
          { key: "name", label: "Product", value: (r: any) => String(r.name).trim() },
          { key: "category", label: "Category" },
          { key: "stock_quantity", label: "Stock", align: "right", value: (r: any) => Number(r.stock_quantity) },
          { key: "low_stock_threshold", label: "Reorder at", align: "right", value: (r: any) => Number(r.low_stock_threshold ?? 0) },
          { key: "state", label: "State", render: (r: any) => <span className={r.state === "Low" ? "text-amber-700" : "text-destructive"}>{r.state}</span> },
          { key: "sold", label: "Sold this period", value: (r: any) => (soldKeys.has(r.id) ? "Yes" : "—") },
        ]} empty="Every product is above its reorder level." />
      </Section>

      <Section title="Expired & expiring within 30 days">
        <DataTable rows={s.expiryRows} columns={[
          { key: "name", label: "Product", value: (r: any) => String(r.name).trim() },
          { key: "batch", label: "Batch" },
          { key: "expiry", label: "Expiry" },
          { key: "qty", label: "Qty", align: "right", render: (r: any) => Math.round(r.qty) },
          { key: "value", label: "Value", align: "right", render: (r: any) => fmt(r.value) },
          { key: "expired", label: "State", value: (r: any) => (r.expired ? "Expired" : "Expiring"), render: (r: any) => <span className={r.expired ? "text-destructive" : "text-amber-700"}>{r.expired ? "Expired" : "Expiring"}</span> },
        ]} empty="No batch expires within 30 days." />
        <p className="mt-2 text-[11px] text-muted-foreground">Batch quantity is capped at the product's current stock (sales are not tracked per batch).</p>
      </Section>
    </div>
  );
}

function DeliveryTab({ c, p }: { c: Computed; p: Computed | null }) {
  const d = c.delivery;
  const block = (title: string, st: typeof d.local, m: typeof d.localMoney, pm?: typeof d.localMoney, extra?: ReactNode) => (
    <Section title={title}>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Orders" value={st.total} raw={String(st.total)} />
        <Kpi label="Delivered" value={st.delivered} raw={String(st.delivered)} tone="text-emerald-700" />
        <Kpi label="In progress" value={st.progress} raw={String(st.progress)} tone="text-amber-700" sub={`${st.pending} pending · ${st.out} on the way`} />
        <Kpi label="Cancelled / returned" value={st.cancelled} raw={String(st.cancelled)} tone="text-destructive" />
      </div>
      <Lines rows={[
        { label: "Delivery charges collected", value: m.income },
        { label: "Actual delivery cost", value: -m.cost, hint: m.costMissing ? `${m.costMissing} not entered` : undefined },
        { label: "Net delivery income", value: m.net, strong: true },
      ]} />
      {pm && <div className="mt-1 text-[11px]"><Change cur={m.net} prev={pm.net} /> <span className="text-muted-foreground">vs previous period</span></div>}
      {extra}
    </Section>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {block("A. Local delivery", d.local, d.localMoney, p?.delivery.localMoney,
          <p className="mt-2 text-xs text-muted-foreground">Rider fees unpaid {fmt(d.localMoney.riderFeeUnpaid)} · cash still with riders {fmt(d.localMoney.cashPending)}</p>)}
        {block("B. Courier delivery", d.courier, d.courierMoney, p?.delivery.courierMoney,
          <p className="mt-2 text-xs text-muted-foreground">COD received {fmt(d.codCollected)} · courier deductions {fmt(d.courierDeductions)} · return charges {fmt(d.returnCost)} · COD settlement pending {fmt(d.courierMoney.codPending)}</p>)}
      </div>

      <Section title="Delivery man & courier performance" action={<Link to="/delivery-report" className="text-xs font-medium text-primary underline">Settle in Delivery Report</Link>}>
        <DataTable rows={d.agents} searchable={false} initialSort={{ key: "assigned", dir: "desc" }} columns={[
          { key: "name", label: "Name", render: (r: any) => <span>{r.name}<span className="block text-[11px] text-muted-foreground">{r.kind === "courier" ? "Courier company" : "Local rider"}</span></span> },
          { key: "assigned", label: "Assigned", align: "right" },
          { key: "delivered", label: "Delivered", align: "right" },
          { key: "cancelled", label: "Cancelled", align: "right" },
          { key: "income", label: "Charge collected", align: "right", render: (r: any) => fmt(r.income) },
          { key: "cost", label: "Actual cost", align: "right", render: (r: any) => fmt(r.cost) },
          { key: "net", label: "Net", align: "right", render: (r: any) => <span className={r.net < 0 ? "text-destructive" : ""}>{fmt(r.net)}</span> },
          { key: "feePaid", label: "Paid to rider", align: "right", render: (r: any) => (r.kind === "local" ? fmt(r.feePaid) : "—") },
          { key: "pending", label: "Pending", align: "right", value: (r: any) => r.feeUnpaid + r.cashPending + r.codPending, render: (r: any) => r.kind === "local" ? <span>fee {fmt(r.feeUnpaid)}<span className="block text-[11px] text-muted-foreground">cash {fmt(r.cashPending)}</span></span> : <span>COD {fmt(r.codPending)}</span> },
        ]} />
      </Section>

      <Section title="Every delivery record">
        <DataTable rows={c.raw.shipments} columns={parcelCols} />
        <p className="mt-2 text-[11px] text-muted-foreground">Delivery charge income counts only delivered parcels. Delivery records never change sales, stock or cash.</p>
      </Section>
    </div>
  );
}

function ClinicTab({ c, p }: { c: Computed; p: Computed | null }) {
  const k = c.clinic;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Clinic revenue" value={k.revenue} prev={p?.clinic.revenue} sub="consultation invoices" />
        <Kpi label="Fees collected" value={k.feeCollected} prev={p?.clinic.feeCollected} />
        <Kpi label="Doctor & clinic expenses" value={k.expenses} prev={p?.clinic.expenses} invert />
        <Kpi label="Net clinic income" value={k.net} prev={p?.clinic.net} tone={k.net < 0 ? "text-destructive" : "text-emerald-700"} />
        <Kpi label="Consultations" value={k.consultations} raw={String(k.consultations)} sub={`${k.paidConsult} paid · ${k.unpaidConsult} unpaid · ${k.freeConsult} free`} />
        <Kpi label="Cancelled / no-show" value={k.apptCancelled} raw={String(k.apptCancelled)} />
        <Kpi label="Clinical visits" value={k.visits} raw={String(k.visits)} />
        <Kpi label="Prescriptions" value={k.prescriptions} raw={String(k.prescriptions)} />
      </div>
      <Section title="Doctor-wise">
        <DataTable rows={k.doctors} searchable={false} initialSort={{ key: "count", dir: "desc" }} columns={[
          { key: "doctor", label: "Doctor" },
          { key: "count", label: "Appointments", align: "right" },
          { key: "completed", label: "Completed", align: "right" },
          { key: "paid", label: "Paid", align: "right" },
          { key: "unpaid", label: "Unpaid", align: "right" },
          { key: "free", label: "Free", align: "right" },
          { key: "fee", label: "Fee charged", align: "right", render: (r: any) => fmt(r.fee) },
          { key: "collected", label: "Collected", align: "right", render: (r: any) => fmt(r.collected) },
        ]} />
      </Section>
      <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        Consultation fees become invoices, so clinic revenue is part of Sales — shown here separately and never added twice. Surgery / procedures sold as invoice items appear under Sales → product-wise.
        Doctor payments and clinic costs come from Expenses with the categories <b>Doctor Fee</b> and <b>Clinic</b> — record them there to see Net Clinic Income. Commission per doctor is not tracked separately.
      </p>
    </div>
  );
}

function ReturnsTab({ c, p }: { c: Computed; p: Computed | null }) {
  const r = c.returns;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Returns" value={r.count} raw={String(r.count)} prev={p?.returns.count} invert />
        <Kpi label="Cancelled invoices" value={r.cancelCount} raw={String(r.cancelCount)} prev={p?.returns.cancelCount} invert />
        <Kpi label="Sales reversed" value={c.sales.reversals} prev={p?.sales.reversals} invert sub="returns + refunds + cancellations" />
        <Kpi label="Cash refunded" value={c.refundsPaid} prev={p?.refundsPaid} invert />
        <Kpi label="Goods restocked" value={r.restockedValue} />
        <Kpi label="Goods not restocked" value={r.notRestockedValue} sub="damaged / not returnable" tone={r.notRestockedValue ? "text-destructive" : ""} />
        <Kpi label="Cost returned to stock" value={c.cogsBack} sub="taken off COGS" />
        <Kpi label="Cancelled / failed deliveries" value={c.delivery.cancelledDeliveries} raw={String(c.delivery.cancelledDeliveries)} />
      </div>
      <Section title="Refunds by method">
        <Lines rows={Object.entries(r.refundByMethod).map(([m, v]) => ({ label: METHOD_LABEL[m] ?? m, value: v }))} />
        {!Object.keys(r.refundByMethod).length && <p className="text-sm text-muted-foreground">No cash refunds — returns reduced the customer's due instead.</p>}
      </Section>
      <Section title="Every return & cancellation">
        <DataTable rows={r.rows} columns={returnCols} initialSort={{ key: "date", dir: "desc" }} />
      </Section>
      <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        A cancelled invoice is reversed once at its full value on the cancellation day; a return reverses only the returned goods. Neither is counted twice in sales, profit or delivery counts.
        Exchanges are recorded as a return plus a new sale, so their price difference is already inside Net Sales — there is no separate exchange record.
      </p>
    </div>
  );
}

function CashTab({ c, p, s }: { c: Computed; p: Computed | null; s: ReturnType<typeof computeSnapshot> | null }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Operating expenses" value={c.opex} prev={p?.opex} invert />
        <Kpi label="Supplier payments" value={c.purchases.supplierPaid} prev={p?.purchases.supplierPaid} />
        <Kpi label="Doctor payments" value={c.doctorPay} prev={p?.doctorPay} sub="Expense: Doctor Fee" />
        <Kpi label="Delivery payments (expenses)" value={c.deliveryExp} prev={p?.deliveryExp} sub="Expense: Delivery / Courier" />
      </div>
      {c.deliveryExp > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          Delivery / Courier expenses are also inside operating expenses. If the same rider fees or courier charges are entered in Delivery Report settlement, they are counted twice — use one place only.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Expenses by category">
          <DataTable rows={c.expenseCategories} searchable={false} initialSort={{ key: "amount", dir: "desc" }} columns={[
            { key: "category", label: "Category" },
            { key: "amount", label: "Amount", align: "right", render: (r) => fmt2(r.amount) },
          ]} />
        </Section>
        <Section title="Money in & out by account (this period)">
          <DataTable rows={c.flows} searchable={false} columns={[
            { key: "method", label: "Account", value: (r) => METHOD_LABEL[r.method] ?? r.method },
            { key: "inflow", label: "In", align: "right", value: (r) => Number(r.inflow), render: (r) => fmt2(Number(r.inflow)) },
            { key: "outflow", label: "Out", align: "right", value: (r) => Number(r.outflow), render: (r) => fmt2(Number(r.outflow)) },
            { key: "balance", label: "Net", align: "right", value: (r) => Number(r.balance), render: (r) => fmt2(Number(r.balance)) },
          ]} />
          <p className="mt-2 text-[11px] text-muted-foreground">Sales payments, refunds, supplier payments, expenses and manual cash entries — same rules as the Accounts page.</p>
        </Section>
      </div>
      {s && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Section title="Balances today">
            <Lines rows={Object.entries(s.balances).map(([m, v]) => ({ label: METHOD_LABEL[m] ?? m, value: v }))} />
            {s.drawer?.expected_cash != null ? (
              <div className="mt-3 rounded-md border p-2 text-xs">
                <p className="font-medium">Cash drawer — {String(s.drawer.status)} shift</p>
                <Lines rows={[
                  { label: "Opening balance", value: Number(s.drawer.opening_balance || 0) },
                  { label: "Cash sales", value: Number(s.drawer.cash_sales || 0) },
                  { label: "Due collected (cash)", value: Number(s.drawer.cash_due_collections || 0) },
                  { label: "Cash refunds", value: -Number(s.drawer.cash_refunds || 0) },
                  { label: "Cash expenses", value: -Number(s.drawer.expenses || 0) },
                  { label: "Supplier payments (cash)", value: -Number(s.drawer.supplier_payments || 0) },
                  { label: "Expected closing cash", value: Number(s.drawer.expected_cash || 0), strong: true },
                ]} />
              </div>
            ) : <p className="mt-2 text-xs text-muted-foreground">No cash drawer shift found.</p>}
          </Section>
          <Section title="Customer receivables" className="xl:col-span-1">
            <DataTable rows={s.dueRows} pageSize={8} columns={[
              { key: "invoice_no", label: "Invoice" },
              { key: "customer", label: "Customer", value: (r: any) => r.owner?.full_name ?? "Walk-in" },
              { key: "due", label: "Due", align: "right", value: (r: any) => Number(r.due), render: (r: any) => fmt(r.due) },
            ]} empty="No customer owes money." />
          </Section>
          <Section title="Supplier payables">
            <DataTable rows={s.supplierRows} pageSize={8} columns={[
              { key: "name", label: "Supplier" },
              { key: "balance_due", label: "Payable", align: "right", value: (r: any) => Number(r.balance_due), render: (r: any) => fmt(r.balance_due) },
            ]} empty="Nothing owed to suppliers." />
          </Section>
        </div>
      )}
      <Section title="Expense ledger">
        <DataTable rows={c.opexRows} columns={expenseCols} initialSort={{ key: "expense_date", dir: "desc" }} />
      </Section>
    </div>
  );
}
