import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { exportToExcel } from "@/lib/export-excel";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { CustomerMixReport } from "@/components/CustomerMixReport";
import { RevenueGrowthReport } from "@/components/RevenueGrowthReport";
import { DueLedgerReport } from "@/components/DueLedgerReport";
import { AuditReport } from "@/components/AuditReport";
import { fetchAll } from "@/lib/fetch-all";
import { dayRangeISO } from "@/lib/sales-ledger";
import { dhakaDayKey, shiftDay, summarizeSales } from "@/lib/sales-summary";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [
    { title: "Reports — Pet Care Vet ERP" },
    { name: "description", content: "Date-based sales, returns, profit and monthly exports for Pet Care Vet." },
    { property: "og:title", content: "Reports — Pet Care Vet ERP" },
    { property: "og:description", content: "Date-based sales, returns, profit and monthly exports for Pet Care Vet." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ReportsPage,
});

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const dayKey = dhakaDayKey;
const today = () => dayKey(new Date());
const startOfMonth = () => `${today().slice(0, 7)}-01`;
const RANGE_PRESETS: { label: string; get: () => { from: string; to: string } }[] = [
  { label: "Today", get: () => ({ from: today(), to: today() }) },
  { label: "Last 7 days", get: () => ({ from: shiftDay(today(), -6), to: today() }) },
  { label: "This month", get: () => ({ from: startOfMonth(), to: today() }) },
  { label: "Last month", get: () => { const last = shiftDay(startOfMonth(), -1); return { from: `${last.slice(0, 7)}-01`, to: last }; } },
  { label: "Last 90 days", get: () => ({ from: shiftDay(today(), -89), to: today() }) },
  { label: "This year", get: () => ({ from: `${today().slice(0, 4)}-01-01`, to: today() }) },
];

function ReportsPage() {
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());
  const [sales, setSales] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [appts, setAppts] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierPayments, setSupplierPayments] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const { fromISO, toISO } = dayRangeISO(from, to);
      const [s, si, e, a, r, sp] = await Promise.all([
        fetchAll(() => supabase.from("sales").select("id,subtotal,discount,total,status,created_at").gte("created_at", fromISO).lte("created_at", toISO).order("created_at")),
        fetchAll(() => supabase.from("sale_items").select("*, products(purchase_price), sales!inner(created_at,status)").gte("sales.created_at", fromISO).lte("sales.created_at", toISO).order("id")),
        fetchAll(() => supabase.from("expenses").select("*").gte("expense_date", from).lte("expense_date", to).order("id")),
        fetchAll(() => supabase.from("appointments").select("*").gte("scheduled_at", fromISO).lte("scheduled_at", toISO).order("scheduled_at")),
        fetchAll(() => supabase.from("sale_returns").select("id,sale_id,refund_amount,created_at,sale_return_items(quantity,sale_items(cost_price,products(purchase_price)))").gte("created_at", fromISO).lte("created_at", toISO).order("created_at")),
        fetchAll(() => supabase.from("supplier_payments").select("amount,paid_at").gte("paid_at", from).lte("paid_at", to).order("id")),
      ]);
      if (!active) return;
      setSales(s); setItems(si); setExpenses(e); setAppts(a); setReturns(r);
      setSupplierPayments(sp);
    })().catch((error) => {
      if (active) toast.error(error instanceof Error ? error.message : "Could not load report");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);

  const summary = useMemo(() => summarizeSales(sales, items, returns, from, to), [sales, items, returns, from, to]);
  const liveItems = items;

  // Invoice-level discount is not stored on the line items, so spread it across
  // the lines proportionally. Without this, per-product revenue/profit is inflated.
  const discountFactor = useMemo(() => {
    const m = new Map<string, number>();
    sales.forEach(s => {
      const sub = Number(s.subtotal || 0);
      // Use the invoice total as the source of truth (it already reflects any
      // bill-level discount) so line revenue always sums back to the invoice.
      const total = s.total != null ? Number(s.total) : sub - Number(s.discount || 0);
      m.set(s.id, sub > 0 ? Math.max(0, Math.min(1, total / sub)) : 1);
    });
    return m;
  }, [sales]);

  const netQty = (it: any) => Number(it.quantity || 0) - Number(it.returned_quantity || 0);
  const netLine = (it: any) => {
    const q = Number(it.quantity || 0);
    if (q <= 0) return 0;
    const factor = discountFactor.get(it.sale_id) ?? 1;
    return Number(it.line_total || 0) * (netQty(it) / q) * factor;
  };
  // Cost snapshot taken at sale time; fall back to the product's current purchase price for legacy rows.
  const unitCost = (it: any) =>
    Number(it.cost_price || 0) > 0 ? Number(it.cost_price) : Number(it.products?.purchase_price || 0);
  const lineCost = (it: any) => netQty(it) * unitCost(it);
  const daily = useMemo(() => {
    const m = new Map<string, { gross: number; refund: number; rev: number; cogs: number; purch: number; opex: number }>();
    const blank = () => ({ gross: 0, refund: 0, rev: 0, cogs: 0, purch: 0, opex: 0 });
    summary.daily.forEach((v, day) => m.set(day, { ...v, purch: 0, opex: 0 }));
    expenses.forEach(e => {
      if (e.expense_date < from || e.expense_date > to) return;
      const cur = m.get(e.expense_date) || blank();
      cur.opex += Number(e.amount); m.set(e.expense_date, cur);
    });
    supplierPayments.forEach(p => {
      if (p.paid_at < from || p.paid_at > to) return;
      const cur = m.get(p.paid_at) || blank();
      cur.purch += Number(p.amount); m.set(p.paid_at, cur);
    });
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [summary, expenses, supplierPayments, from, to]);

  const expenseByCategory = useMemo(() => {
    const m = new Map<string, number>();
    expenses.forEach(e => m.set(e.category, (m.get(e.category) || 0) + Number(e.amount)));
    return Array.from(m.entries()).map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  const topProducts = useMemo(() => {
    // Cancelled sales are excluded here entirely (their reversal is day-based,
    // not product-based), so product rankings aren't distorted.
    const voidIds = new Set(sales.filter(s => s.status === "void").map(s => s.id));
    const m = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
    liveItems.filter((it: any) => !voidIds.has(it.sale_id)).forEach((it: any) => {
      const key = it.product_id || it.name;
      const cur = m.get(key) || { name: it.name, qty: 0, revenue: 0, cost: 0 };
      cur.qty += netQty(it);
      cur.revenue += netLine(it);
      cur.cost += lineCost(it);
      m.set(key, cur);
    });
    return Array.from(m.values()).filter(p => p.qty > 0)
      .map(p => ({ ...p, profit: p.revenue - p.cost }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  }, [liveItems, sales]);

  const apptStats = useMemo(() => {
    const total = appts.length;
    const byStatus: Record<string, number> = {};
    appts.forEach(a => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });
    return { total, byStatus };
  }, [appts]);

  const totals = useMemo(() => {
    const { gross: grossSell, refund: refunds, rev, cogs } = summary.totals;
    const purch = daily.reduce((a, [, row]) => a + row.purch, 0);
    const opex = daily.reduce((a, [, row]) => a + row.opex, 0);
    return { grossSell, rev, refunds, cogs, purch, opex, gross: rev - cogs, profit: rev - cogs - opex };
  }, [summary, daily]);

  // Monthly aggregation of the same day rows the P&L uses — identical logic,
  // just bucketed by calendar month (oldest first).
  const monthly = useMemo(() => {
    const m = new Map<string, { gross: number; refund: number; cogs: number; purch: number; opex: number }>();
    daily.forEach(([day, v]) => {
      const key = day.slice(0, 7); // YYYY-MM
      const cur = m.get(key) || { gross: 0, refund: 0, cogs: 0, purch: 0, opex: 0 };
      cur.gross += v.gross; cur.refund += v.refund; cur.cogs += v.cogs;
      cur.purch += v.purch; cur.opex += v.opex;
      m.set(key, cur);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => {
      const rev = v.gross - v.refund;
      const grossProfit = rev - v.cogs;
      const label = new Date(`${key}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      return { key, label, ...v, rev, grossProfit, profit: grossProfit - v.opex };
    });
  }, [daily]);

  const exportMonthly = () => {
    const rows = monthly.map((r) => ({
      Month: r.label,
      "Invoice Sales": Math.round(r.gross * 100) / 100,
      Refunds: Math.round(r.refund * 100) / 100,
      "Net Sales": Math.round(r.rev * 100) / 100,
      "COGS": Math.round(r.cogs * 100) / 100,
      "Gross Profit": Math.round(r.grossProfit * 100) / 100,
      "Expenses": Math.round(r.opex * 100) / 100,
      "Supplier Payments": Math.round(r.purch * 100) / 100,
      "Net Profit": Math.round(r.profit * 100) / 100,
      "Gross Margin %": r.rev > 0 ? Math.round((r.grossProfit / r.rev) * 1000) / 10 : 0,
      "Net Margin %": r.rev > 0 ? Math.round((r.profit / r.rev) * 1000) / 10 : 0,
    }));
    const t = monthly.reduce((a, r) => ({
      gross: a.gross + r.gross, refund: a.refund + r.refund, rev: a.rev + r.rev,
      cogs: a.cogs + r.cogs, grossProfit: a.grossProfit + r.grossProfit,
      opex: a.opex + r.opex, purch: a.purch + r.purch, profit: a.profit + r.profit,
    }), { gross: 0, refund: 0, rev: 0, cogs: 0, grossProfit: 0, opex: 0, purch: 0, profit: 0 });
    rows.push({
      Month: "TOTAL",
      "Invoice Sales": Math.round(t.gross * 100) / 100,
      Refunds: Math.round(t.refund * 100) / 100,
      "Net Sales": Math.round(t.rev * 100) / 100,
      "COGS": Math.round(t.cogs * 100) / 100,
      "Gross Profit": Math.round(t.grossProfit * 100) / 100,
      "Expenses": Math.round(t.opex * 100) / 100,
      "Supplier Payments": Math.round(t.purch * 100) / 100,
      "Net Profit": Math.round(t.profit * 100) / 100,
      "Gross Margin %": t.rev > 0 ? Math.round((t.grossProfit / t.rev) * 1000) / 10 : 0,
      "Net Margin %": t.rev > 0 ? Math.round((t.profit / t.rev) * 1000) / 10 : 0,
    });
    exportToExcel(rows, `monthly-report-${from}-to-${to}`, "Monthly Report");
  };




  return (
    <div className="min-w-0 p-0 sm:p-2">
      <PageHeader title="Reports" description="Sales, profit & operational insights" icon={BarChart3}
        actions={
          <div className="w-full min-w-0 space-y-2">
            <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full min-w-0 sm:w-40" />
              <span className="text-sm text-muted-foreground">→</span>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full min-w-0 sm:w-40" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RANGE_PRESETS.map(p => {
                const r = p.get();
                const active = r.from === from && r.to === to;
                return (
                  <Button
                    key={p.label}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => { setFrom(r.from); setTo(r.to); }}
                  >
                    {p.label}
                  </Button>
                );
              })}
            </div>
            <div>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={loading || monthly.length === 0} onClick={exportMonthly}>
                <Download className="h-3.5 w-3.5" /> Monthly Report (Excel)
              </Button>
            </div>
          </div>


        }
      />

      {loading && <p role="status" className="mb-3 text-sm text-muted-foreground">Loading report…</p>}
      <div aria-busy={loading} className="mb-6 grid min-w-0 grid-cols-2 gap-2 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Card className="border-2 border-primary"><CardContent className="p-3 sm:p-4"><div className="text-xs font-semibold text-primary">Net Sales</div><div className={`break-words text-xl font-bold sm:text-3xl ${totals.rev >= 0 ? "text-primary" : "text-destructive"}`}>{fmt(totals.rev)}</div><div className="mt-1 text-[11px] text-muted-foreground">refund-এর পর যা আছে (sales − refund)</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Invoice Sales</div><div className="break-words text-lg font-semibold sm:text-2xl">{fmt(totals.grossSell)}</div><div className="mt-1 text-[11px] text-muted-foreground">invoices raised in range</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Refund</div><div className="break-words text-lg font-semibold text-destructive sm:text-2xl">−{fmt(totals.refunds)}</div><div className="mt-1 text-[11px] text-muted-foreground">returns processed in range</div></CardContent></Card>

        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Purchase Cost (sold)</div><div className="break-words text-lg font-semibold text-amber-600 sm:text-2xl">{fmt(totals.cogs)}</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Gross Profit</div><div className={`break-words text-lg font-semibold sm:text-2xl ${totals.gross >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(totals.gross)}</div><div className="mt-1 text-[11px] text-muted-foreground">sell − purchase cost</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Avg Gross Margin</div><div className={`break-words text-lg font-semibold sm:text-2xl ${totals.gross >= 0 ? "text-emerald-600" : "text-destructive"}`}>{totals.rev > 0 ? `${((totals.gross / totals.rev) * 100).toFixed(1)}%` : "—"}</div><div className="mt-1 text-[11px] text-muted-foreground">gross profit / sell value</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Operating Exp.</div><div className="break-words text-lg font-semibold text-destructive sm:text-2xl">{fmt(totals.opex)}</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Net Profit</div><div className={`break-words text-lg font-semibold sm:text-2xl ${totals.profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(totals.profit)}</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Avg Net Margin</div><div className={`break-words text-lg font-semibold sm:text-2xl ${totals.profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{totals.rev > 0 ? `${((totals.profit / totals.rev) * 100).toFixed(1)}%` : "—"}</div><div className="mt-1 text-[11px] text-muted-foreground">net profit / sell value</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Purchases (stock in)</div><div className="break-words text-lg font-semibold sm:text-2xl">{fmt(totals.purch)}</div><div className="mt-1 text-[11px] text-muted-foreground">not counted in profit</div></CardContent></Card>
      </div>



      <Tabs defaultValue="daily" className="min-w-0">
        <TabsList className="mb-1 flex w-full overflow-x-auto sm:inline-flex sm:w-auto">
          <TabsTrigger value="daily">Daily P&L</TabsTrigger>
          <TabsTrigger value="growth">Revenue Growth %</TabsTrigger>
          <TabsTrigger value="products">Top Products</TabsTrigger>
          <TabsTrigger value="expcat">Expense Breakdown</TabsTrigger>
          <TabsTrigger value="customers">New vs Repeat</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="due">Due Ledger</TabsTrigger>
          <TabsTrigger value="audit">Full Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="due">
          <DueLedgerReport from={from} to={to} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditReport from={from} to={to} />
        </TabsContent>

        <TabsContent value="growth">
          <RevenueGrowthReport daily={daily} from={from} to={to} />
        </TabsContent>

        <TabsContent value="customers">
          <CustomerMixReport from={from} to={to} />
        </TabsContent>

        <TabsContent value="expcat">
          <Card><CardHeader><CardTitle>Expenses by Category</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {expenseByCategory.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No expenses in range</TableCell></TableRow>}
                  {expenseByCategory.map(c => {
                    const total = totals.purch + totals.opex;
                    const pct = total > 0 ? (c.amount / total) * 100 : 0;
                    return (
                      <TableRow key={c.category}>
                        <TableCell>{c.category}{c.category === "Purchase" && <span className="ml-2 text-xs text-muted-foreground">(auto from Inventory)</span>}</TableCell>
                        <TableCell className="text-right">{fmt(c.amount)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="daily">
          <Card><CardHeader><CardTitle>Daily Profit & Loss</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Invoice Sales</TableHead>
                  <TableHead className="text-right">Refund</TableHead>
                  <TableHead className="text-right font-semibold text-primary">Net Sales</TableHead>
                  <TableHead className="text-right">Purchase Cost</TableHead>
                  <TableHead className="text-right">Gross Profit</TableHead>
                  <TableHead className="text-right">Gross Margin</TableHead>
                  <TableHead className="text-right">Op. Exp.</TableHead>
                  <TableHead className="text-right">Net Profit</TableHead>
                  <TableHead className="text-right">Net Margin</TableHead>
                  <TableHead className="text-right">Purchases</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {daily.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>}
                  {daily.map(([d, v]) => {
                    const gross = v.rev - v.cogs;
                    const net = gross - v.opex;
                    const grossMargin = v.rev > 0 ? (gross / v.rev) * 100 : 0;
                    const netMargin = v.rev > 0 ? (net / v.rev) * 100 : 0;
                    return (
                      <TableRow key={d}>
                        <TableCell>{d}</TableCell>
                        <TableCell className="text-right">{fmt(v.gross)}</TableCell>
                        <TableCell className="text-right text-destructive">{v.refund === 0 ? "—" : `−${fmt(v.refund)}`}</TableCell>
                        <TableCell className={`text-right font-bold ${v.rev >= 0 ? "text-primary" : "text-destructive"}`}>{fmt(v.rev)}</TableCell>
                        <TableCell className="text-right text-amber-600">{fmt(v.cogs)}</TableCell>

                        <TableCell className={`text-right ${gross >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(gross)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${gross >= 0 ? "text-emerald-600" : "text-destructive"}`}>{grossMargin.toFixed(1)}%</TableCell>
                        <TableCell className="text-right text-destructive">{fmt(v.opex)}</TableCell>
                        <TableCell className={`text-right font-medium ${net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(net)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{netMargin.toFixed(1)}%</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmt(v.purch)}</TableCell>
                      </TableRow>
                    );
                  })}

                </TableBody>

              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products">
          <Card><CardHeader><CardTitle>Best-selling Products</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Product</TableHead><TableHead className="text-right">Qty Sold</TableHead>
                  <TableHead className="text-right">Sell Value</TableHead>
                  <TableHead className="text-right">Purchase Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {topProducts.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No sales</TableCell></TableRow>}
                  {topProducts.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="text-right">{p.qty}</TableCell>
                      <TableCell className="text-right">{fmt(p.revenue)}</TableCell>
                      <TableCell className="text-right text-amber-600">{fmt(p.cost)}</TableCell>
                      <TableCell className={`text-right font-medium ${p.profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(p.profit)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{p.revenue > 0 ? `${((p.profit / p.revenue) * 100).toFixed(1)}%` : "—"}</TableCell>
                    </TableRow>
                  ))}

                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appointments">
          <Card><CardHeader><CardTitle>Appointment Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold mb-4">{apptStats.total}<span className="text-sm text-muted-foreground ml-2">total</span></div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(apptStats.byStatus).map(([k, v]) => (
                  <div key={k} className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground capitalize">{k.replace("_", " ")}</div>
                    <div className="text-xl font-semibold">{v}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
