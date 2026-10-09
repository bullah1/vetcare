import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { CustomerMixCard } from "@/components/CustomerMixCard";
import { fetchAll } from "@/lib/fetch-all";
import { dayRangeISO } from "@/lib/sales-ledger";
import { dhakaDayKey, shiftDay, summarizeSales } from "@/lib/sales-summary";
import {
  CalendarDays,
  PawPrint,
  ShoppingCart,
  Package,
  TrendingUp,
  AlertTriangle,
  Wallet,
  Calculator,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Stethoscope,
  Clock,
  FileWarning,
  Bell,
  Truck,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [
    { title: "Dashboard — Pet Care Vet ERP" },
    { name: "description", content: "Daily and monthly net sales, returns, profit and clinic activity for Pet Care Vet." },
    { property: "og:title", content: "Dashboard — Pet Care Vet ERP" },
    { property: "og:description", content: "Daily and monthly net sales, returns, profit and clinic activity for Pet Care Vet." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Dashboard,
});

function money(n: number) {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}
function moneyShort(n: number) {
  if (Math.abs(n) >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}
function pct(curr: number, prev: number) {
  if (!prev) return curr > 0 ? 100 : 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}
const dayKey = dhakaDayKey;

const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--muted-foreground))"];

function Dashboard() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const now = new Date();
  const todayDate = dayKey(now);
  const monthDate = `${todayDate.slice(0, 7)}-01`;
  const lastMonthEnd = shiftDay(monthDate, -1);
  const lastMonthDate = `${lastMonthEnd.slice(0, 7)}-01`;
  const startOfToday = new Date(dayRangeISO(todayDate, todayDate).fromISO);
  const start30Date = shiftDay(todayDate, -29);
  const start30 = new Date(dayRangeISO(start30Date, start30Date).fromISO);
  const rangeStartDate = monthDate < start30Date ? monthDate : start30Date;
  const { fromISO: rangeStartISO, toISO: rangeEndISO } = dayRangeISO(rangeStartDate, todayDate);

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats-v3", todayDate],
    refetchInterval: 30000,
    queryFn: async () => {
      const [
        salesRange,
        appts,
        pendingAppts,
        allProducts,
        saleItems30,
        todayPayments,
        returns30,
        todayExpenses,
        expenses30,
        unpaidSales,
        pendingList,
        supplierDues,
        batches,
      ] = await Promise.all([
        fetchAll(() => supabase.from("sales").select("id,subtotal,total,paid,due,discount,status,created_at,owner_id,pet_owners(full_name,phone)").gte("created_at", rangeStartISO).lte("created_at", rangeEndISO).order("created_at", { ascending: false })).then(data => ({ data })),
        supabase.from("appointments").select("id", { count: "exact", head: true }).gte("scheduled_at", startOfToday.toISOString()).lt("scheduled_at", new Date(startOfToday.getTime() + 86400000).toISOString()),
        supabase.from("appointments").select("id,scheduled_at,reason,status,pets(name),pet_owners(full_name)").eq("status", "pending").order("scheduled_at", { ascending: true }).limit(10),
        fetchAll(() => supabase.from("products").select("id,name,category,stock_quantity,low_stock_threshold,purchase_price,selling_price,is_active").order("id")).then(data => ({ data })),
        fetchAll(() => supabase.from("sale_items").select("sale_id,product_id,name,quantity,returned_quantity,cost_price,line_total,products(purchase_price),sales!inner(created_at,owner_id,pet_owners(full_name),status)").gte("sales.created_at", rangeStartISO).lte("sales.created_at", rangeEndISO).order("id")).then(data => ({ data })),
        supabase.from("payments").select("id,amount,method,reference,received_at,sale_id,sales(invoice_no)").gte("received_at", startOfToday.toISOString()).lte("received_at", rangeEndISO).order("received_at", { ascending: false }),
        fetchAll(() => supabase.from("sale_returns").select("id,sale_id,refund_amount,created_at,sales(status),sale_return_items(quantity,sale_items(cost_price,products(purchase_price)))").gte("created_at", rangeStartISO).lte("created_at", rangeEndISO).order("created_at")).then(data => ({ data })),
        supabase.from("expenses").select("id,amount,category,paid_to,method,notes,expense_date").eq("expense_date", todayDate).order("created_at", { ascending: false }),
        supabase.from("expenses").select("amount,expense_date,category").gte("expense_date", rangeStartDate).lte("expense_date", todayDate),
        supabase.from("sales").select("id,invoice_no,total,paid,due,created_at,pet_owners(full_name)").gt("due", 0).not("status", "in", "(refunded,void)").order("created_at", { ascending: false }).limit(10),
        supabase.from("appointments").select("id,scheduled_at,status").in("status", ["pending", "confirmed"]).gte("scheduled_at", startOfToday.toISOString()),
        supabase.from("suppliers").select("id,name,balance_due").gt("balance_due", 0).order("balance_due", { ascending: false }).limit(10),
        fetchAll(() => supabase.from("stock_batches").select("product_id,quantity,expiry_date,products(name)").gt("quantity", 0).not("expiry_date", "is", null).order("id")).then(data => ({ data })),
      ]);

      const sales = salesRange.data ?? [];
      const items = saleItems30.data ?? [];
      const products = allProducts.data ?? [];
      const prodMap = new Map(products.map((p: any) => [p.id, p]));

      const summary = summarizeSales(sales, items, returns30.data ?? [], rangeStartDate, todayDate);
      const completedSaleIds = new Set(sales.map((s: any) => s.id));
      const byDay: Record<string, { day: string; gross: number; refund: number; sales: number; profit: number; expense: number; orders: number; due: number; paid: number }> = {};
      for (let i = 0; i < 30; i++) {
        const k = shiftDay(start30Date, i);
        const row = summary.daily.get(k);
        byDay[k] = { day: k.slice(5), gross: row?.gross ?? 0, refund: row?.refund ?? 0,
          sales: row?.rev ?? 0, profit: (row?.rev ?? 0) - (row?.cogs ?? 0),
          expense: 0, orders: 0, due: 0, paid: 0 };
      }
      sales.forEach((s: any) => {
        const row = byDay[dayKey(s.created_at)];
        if (!row) return;
        row.orders += 1; row.due += Number(s.due || 0); row.paid += Number(s.paid || 0);
      });
      (expenses30.data ?? []).forEach((e: any) => {
        if (byDay[e.expense_date]) byDay[e.expense_date].expense += Number(e.amount);
      });
      const series = Object.values(byDay);
      const todayKey = todayDate;
      const yKey = shiftDay(todayDate, -1);
      const todayGross = byDay[todayKey]?.gross ?? 0;
      const todayRefund = byDay[todayKey]?.refund ?? 0;
      const todaySales = byDay[todayKey]?.sales ?? 0;
      const todayDue = byDay[todayKey]?.due ?? 0;
      const todayPaid = byDay[todayKey]?.paid ?? 0;
      const yestSales = byDay[yKey]?.sales ?? 0;
      const todayProfit = byDay[todayKey]?.profit ?? 0;
      const yestProfit = byDay[yKey]?.profit ?? 0;
      const todayExp = byDay[todayKey]?.expense ?? 0;
      const yestExp = byDay[yKey]?.expense ?? 0;
      const todayOrders = byDay[todayKey]?.orders ?? 0;
      const yestOrders = byDay[yKey]?.orders ?? 0;
      const monthTotal = summarizeSales(sales, items, returns30.data ?? [], monthDate, todayDate).totals.rev;

      const previousRange = dayRangeISO(lastMonthDate, lastMonthEnd);
      const [lastMonthSales, lastMonthReturns, lastMonthExp] = await Promise.all([
        fetchAll(() => supabase.from("sales").select("id,total,created_at").gte("created_at", previousRange.fromISO).lte("created_at", previousRange.toISO).order("id")),
        fetchAll(() => supabase.from("sale_returns").select("id,refund_amount,created_at").gte("created_at", previousRange.fromISO).lte("created_at", previousRange.toISO).order("id")),
        fetchAll(() => supabase.from("expenses").select("amount").gte("expense_date", lastMonthDate).lte("expense_date", lastMonthEnd).order("id")),
      ]);
      const lastMonthTotal = summarizeSales(lastMonthSales, [], lastMonthReturns, lastMonthDate, lastMonthEnd).totals.rev;
      const monthExp = (expenses30.data ?? []).filter((e: any) => e.expense_date >= monthDate).reduce((s: number, e: any) => s + Number(e.amount), 0);
      const lastMonthExpense = lastMonthExp.reduce((s: number, r: any) => s + Number(r.amount), 0);

      // Top customers (30d)
      const custTally: Record<string, { name: string; total: number; orders: number }> = {};
      sales.forEach((s: any) => {
        if (s.status === "refunded" || s.status === "void") return;
        const name = s.pet_owners?.full_name ?? "Walk-in";
        const key = s.owner_id ?? "walkin";
        if (!custTally[key]) custTally[key] = { name, total: 0, orders: 0 };
        custTally[key].total += Number(s.total);
        custTally[key].orders += 1;
      });
      const topCustomers = Object.values(custTally).sort((a, b) => b.total - a.total).slice(0, 5);

      // Category-wise sales (30d, completed)
      const catTally: Record<string, number> = {};
      items.forEach((it: any) => {
        if (!completedSaleIds.has(it.sale_id)) return;
        const p: any = it.product_id ? prodMap.get(it.product_id) : null;
        const cat = p?.category ?? "service";
        catTally[cat] = (catTally[cat] ?? 0) + Number(it.line_total);
      });
      const categoryPie = Object.entries(catTally).map(([name, value]) => ({ name, value: Math.round(value) }));

      // Top products
      const prodTally: Record<string, number> = {};
      items.forEach((it: any) => {
        if (!completedSaleIds.has(it.sale_id)) return;
        prodTally[it.name] = (prodTally[it.name] ?? 0) + Number(it.quantity);
      });
      const topProducts = Object.entries(prodTally).sort(([, a], [, b]) => b - a).slice(0, 5);

      // Top pets & top doctors — via appointments
      const [apptStats, appts30] = await Promise.all([
        fetchAll(() => supabase.from("appointments").select("pet_id,doctor_id,pets(name,species),doctors(full_name)").gte("scheduled_at", start30.toISOString()).order("id")).then(data => ({ data })),
        Promise.resolve(null),
      ]);
      const petTally: Record<string, { name: string; species: string; count: number }> = {};
      const docTally: Record<string, { name: string; count: number }> = {};
      (apptStats.data ?? []).forEach((a: any) => {
        if (a.pet_id && a.pets) {
          const k = a.pet_id;
          if (!petTally[k]) petTally[k] = { name: a.pets.name, species: a.pets.species, count: 0 };
          petTally[k].count += 1;
        }
        if (a.doctor_id && a.doctors) {
          const k = a.doctor_id;
          if (!docTally[k]) docTally[k] = { name: a.doctors.full_name, count: 0 };
          docTally[k].count += 1;
        }
      });
      const topPets = Object.values(petTally).sort((a, b) => b.count - a.count).slice(0, 5);
      const topDoctors = Object.values(docTally).sort((a, b) => b.count - a.count).slice(0, 5);

      // Alerts
      const low = products.filter((p: any) => p.is_active && Number(p.stock_quantity) <= Number(p.low_stock_threshold));
      const in30 = new Date(startOfToday); in30.setDate(in30.getDate() + 30);
      const nearExpiry = (batches.data ?? [])
        .filter((b: any) => b.expiry_date && new Date(b.expiry_date) <= in30)
        .map((b: any) => ({ name: b.products?.name ?? "Product", expiry: b.expiry_date, qty: Number(b.quantity) }))
        .sort((a: any, b: any) => a.expiry.localeCompare(b.expiry))
        .slice(0, 10);

      // Cashflow today (kept from previous)
      const inflow = (todayPayments.data ?? []).reduce((s, r) => s + Math.max(Number(r.amount), 0), 0);
      const refunds = (todayPayments.data ?? []).reduce((s, r) => s + Math.min(Number(r.amount), 0), 0);
      const expensesOut = (todayExpenses.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
      const outflow = expensesOut + Math.abs(refunds);
      const byMethod: Record<string, number> = {};
      (todayPayments.data ?? []).forEach((r: any) => { byMethod[r.method] = (byMethod[r.method] ?? 0) + Number(r.amount); });

      return {
        series,
        todaySales, todayGross, todayRefund, todayDue, todayPaid, yestSales, todayProfit, yestProfit, todayExp, yestExp, todayOrders, yestOrders,
        monthTotal, lastMonthTotal, monthExp, lastMonthExpense,
        topCustomers, topPets, topDoctors, topProducts, categoryPie,
        low, nearExpiry, pendingList: pendingList.data ?? [], unpaidSales: unpaidSales.data ?? [], supplierDues: supplierDues.data ?? [],
        todayApptsCount: appts.count ?? 0, pendingApptsCount: pendingAppts.count ?? 0,
        inflow, outflow, net: inflow - outflow, byMethod,
        payments: todayPayments.data ?? [], expenses: todayExpenses.data ?? [],
      };
    },
  });

  const [drill, setDrill] = useState<"inflow" | "outflow" | null>(null);
  const [openingFloat, setOpeningFloat] = useState<string>("0");
  const [countedCash, setCountedCash] = useState<string>("");
  const [trendRange, setTrendRange] = useState<"7" | "30">("7");
  const [trendMetric, setTrendMetric] = useState<"sales" | "profit" | "expense">("sales");

  const chartData = useMemo(() => {
    const src = stats?.series ?? [];
    return trendRange === "7" ? src.slice(-7) : src;
  }, [stats?.series, trendRange]);

  const positivePayments = (stats?.payments ?? []).filter((p: any) => Number(p.amount) > 0);
  const refundPayments = (stats?.payments ?? []).filter((p: any) => Number(p.amount) < 0);

  const cashIn = (stats?.payments ?? []).filter((p: any) => p.method === "cash" && Number(p.amount) > 0).reduce((s: number, p: any) => s + Number(p.amount), 0);
  const cashRefunds = Math.abs((stats?.payments ?? []).filter((p: any) => p.method === "cash" && Number(p.amount) < 0).reduce((s: number, p: any) => s + Number(p.amount), 0));
  const cashExpenses = (stats?.expenses ?? []).filter((e: any) => e.method === "cash").reduce((s: number, e: any) => s + Number(e.amount), 0);

  // Source of truth: the currently open cash shift (same numbers as the Cash Drawer page)
  const { data: shift } = useQuery({
    queryKey: ["dashboard-open-shift"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cash_shift_summary", { _shift_id: null } as any);
      if (error) throw error;
      return (data as any) ?? null;
    },
  });

  const hasShift = !!shift;
  const shiftOpening = Number(shift?.opening_balance ?? 0);
  const shiftSales = Number(shift?.cash_sales ?? 0);
  const shiftRefunds = Number(shift?.cash_refunds ?? 0);
  const shiftSupplier = Number(shift?.supplier_payments ?? 0);
  const shiftExpenses = Number(shift?.expenses ?? 0);

  const openingNum = hasShift ? shiftOpening : Number(openingFloat) || 0;
  const drawerSales = hasShift ? shiftSales : cashIn;
  const drawerRefunds = hasShift ? shiftRefunds : cashRefunds;
  const drawerSupplier = hasShift ? shiftSupplier : 0;
  const drawerExpenses = hasShift ? shiftExpenses : cashExpenses;
  const expectedDrawer = hasShift
    ? Number(shift?.expected_cash ?? 0)
    : openingNum + cashIn - cashRefunds - cashExpenses;
  const countedNum = countedCash === "" ? null : Number(countedCash);
  const variance = countedNum === null ? null : countedNum - expectedDrawer;


  const alertsCount =
    (stats?.low?.length ?? 0) +
    (stats?.nearExpiry?.length ?? 0) +
    (stats?.unpaidSales?.length ?? 0) +
    (stats?.supplierDues?.length ?? 0) +
    (stats?.pendingList?.length ?? 0);

  const kpis = [
    { label: "Today's Sales", value: money(stats?.todaySales ?? 0), curr: stats?.todaySales ?? 0, prev: stats?.yestSales ?? 0, sub: "Net sales after cancel/refund/return", icon: ShoppingCart, tone: "text-primary" },
    { label: "Today's Collection", value: money(stats?.todayPaid ?? 0), curr: stats?.todayPaid ?? 0, prev: 0, sub: "Cash/digital received today", icon: Wallet, tone: "text-success" },
    { label: "Today's Due", value: money(stats?.todayDue ?? 0), curr: stats?.todayDue ?? 0, prev: 0, sub: "Unpaid credit sales today", icon: Activity, tone: "text-destructive", invert: true },
  ];

  const monthKpis = [
    { label: "This Month Net Sales", value: money(stats?.monthTotal ?? 0), curr: stats?.monthTotal ?? 0, prev: stats?.lastMonthTotal ?? 0, sub: "vs last month", icon: TrendingUp },
    ...(isAdmin ? [
      { label: "This Month Expense", value: money(stats?.monthExp ?? 0), curr: stats?.monthExp ?? 0, prev: stats?.lastMonthExpense ?? 0, sub: "vs last month", icon: Wallet, invert: true },
    ] : []),
    { label: "Today's Appointments", value: String(stats?.todayApptsCount ?? 0), curr: stats?.todayApptsCount ?? 0, prev: 0, sub: "scheduled today", icon: CalendarDays, noDelta: true },
    { label: "Pending Appointments", value: String(stats?.pendingApptsCount ?? 0), curr: stats?.pendingApptsCount ?? 0, prev: 0, sub: "awaiting confirmation", icon: PawPrint, noDelta: true },
  ];

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Snapshot of your clinic — {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</p>
        </div>
        {alertsCount > 0 && (
          <a href="#alerts" className="hidden sm:inline-flex items-center gap-2 rounded-full border bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">
            <Bell className="h-3.5 w-3.5" /> {alertsCount} alerts need attention
          </a>
        )}
      </div>

      {/* Today KPI row — simplified sales summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* Month + Appointments row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {monthKpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* New vs Repeat customers (today) */}
      <CustomerMixCard />

      {/* Trend chart */}
      <Card className="shadow-[var(--shadow-soft)]">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">{isAdmin ? "Sales / Profit / Expense trend" : "Sales trend"}</CardTitle>
            </div>
            <CardDescription>Interactive daily view — hover to see values</CardDescription>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:flex sm:items-center">
            <Tabs value={isAdmin ? trendMetric : "sales"} onValueChange={(v) => setTrendMetric(v as any)}>
              <TabsList>
                <TabsTrigger value="sales">Sales</TabsTrigger>
                {isAdmin && <TabsTrigger value="profit">Profit</TabsTrigger>}
                {isAdmin && <TabsTrigger value="expense">Expense</TabsTrigger>}
              </TabsList>
            </Tabs>
            <Tabs value={trendRange} onValueChange={(v) => setTrendRange(v as any)}>
              <TabsList>
                <TabsTrigger value="7">7d</TabsTrigger>
                <TabsTrigger value="30">30d</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[240px] min-w-0 w-full sm:h-[280px]">
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradMetric" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => moneyShort(Number(v))} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => money(Number(v))}
                />
                <Area type="monotone" dataKey={isAdmin ? trendMetric : "sales"} stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gradMetric)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 h-[180px] min-w-0 w-full">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => moneyShort(Number(v))} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => money(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                {isAdmin && <Bar dataKey="expense" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />}
                {isAdmin && <Bar dataKey="profit" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Alerts Hub */}
      <Card id="alerts" className="shadow-[var(--shadow-soft)]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-warning" />
            <CardTitle className="text-base">Alerts Hub</CardTitle>
            {alertsCount > 0 && <Badge variant="destructive">{alertsCount}</Badge>}
          </div>
          <CardDescription>Everything that needs your attention, in one place</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AlertBlock
              title="Low Stock"
              icon={AlertTriangle}
              tone="warning"
              count={stats?.low?.length ?? 0}
              actionHref="/inventory"
              actionLabel="Restock"
              rows={(stats?.low ?? []).slice(0, 5).map((p: any) => ({ label: p.name, right: `${Number(p.stock_quantity)} left` }))}
            />
            <AlertBlock
              title="Near Expiry (30d)"
              icon={Clock}
              tone="warning"
              count={stats?.nearExpiry?.length ?? 0}
              actionHref="/inventory"
              actionLabel="Review"
              rows={(stats?.nearExpiry ?? []).slice(0, 5).map((b: any) => ({ label: b.name, right: b.expiry }))}
            />
            <AlertBlock
              title="Supplier Dues"
              icon={Truck}
              tone="destructive"
              count={stats?.supplierDues?.length ?? 0}
              actionHref="/purchases"
              actionLabel="Pay"
              rows={(stats?.supplierDues ?? []).slice(0, 5).map((s: any) => ({ label: s.name, right: money(Number(s.balance_due)) }))}
            />
            <AlertBlock
              title="Unpaid Invoices"
              icon={FileWarning}
              tone="destructive"
              count={stats?.unpaidSales?.length ?? 0}
              actionHref="/sales-history"
              actionLabel="Collect"
              rows={(stats?.unpaidSales ?? []).slice(0, 5).map((s: any) => ({ label: `${s.invoice_no} • ${s.pet_owners?.full_name ?? "Walk-in"}`, right: money(Number(s.due)) }))}
            />
            <AlertBlock
              title="Pending Appointments"
              icon={CalendarDays}
              tone="primary"
              count={stats?.pendingList?.length ?? 0}
              actionHref="/appointments"
              actionLabel="Confirm"
              rows={(stats?.pendingList ?? []).slice(0, 5).map((a: any) => ({
                label: `${a.pets?.name ?? a.guest_pet_name ?? "Pet"} • ${a.pet_owners?.full_name ?? a.guest_name ?? ""}`,
                right: new Date(a.scheduled_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
              }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Leaderboards + Category */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="shadow-[var(--shadow-soft)] lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Category-wise Sales (30d)</CardTitle>
            </div>
            <CardDescription>Revenue mix across categories</CardDescription>
          </CardHeader>
          <CardContent>
            {(stats?.categoryPie ?? []).length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No sales yet.</p>
            ) : (
              <div className="h-[240px] min-w-0 sm:h-[260px]">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={(stats?.categoryPie ?? [])} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {(stats?.categoryPie ?? []).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => money(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Leaderboard
          title="Top Customers"
          icon={Users}
          rows={(stats?.topCustomers ?? []).map((c) => ({ label: c.name, sub: `${c.orders} orders`, right: money(c.total) }))}
          empty="No customer sales yet."
        />

        <Leaderboard
          title="Top Products"
          icon={Package}
          rows={(stats?.topProducts ?? []).map(([name, qty]) => ({ label: name, right: `${qty} sold` }))}
          empty="No products sold yet."
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Leaderboard
          title="Top Pets"
          icon={PawPrint}
          rows={(stats?.topPets ?? []).map((p) => ({ label: p.name, sub: p.species, right: `${p.count} visits` }))}
          empty="No appointments yet."
        />
        <Leaderboard
          title="Top Doctors"
          icon={Stethoscope}
          rows={(stats?.topDoctors ?? []).map((d) => ({ label: d.name, right: `${d.count} appts` }))}
          empty="No doctor activity yet."
        />
      </div>

      {/* Cashflow — financial summary, admin only */}
      {isAdmin && (
      <Card className="shadow-[var(--shadow-soft)]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Today's Cashflow</CardTitle>
          </div>
          <CardDescription>Inflow from POS payments vs outflow from expenses &amp; refunds</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <button type="button" onClick={() => setDrill("inflow")} className="rounded-lg border p-3 text-left transition hover:border-primary hover:bg-muted/50">
              <div className="text-xs text-muted-foreground">Inflow</div>
              <div className="text-xl font-semibold text-success">{money(stats?.inflow ?? 0)}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Click for details</div>
            </button>
            <button type="button" onClick={() => setDrill("outflow")} className="rounded-lg border p-3 text-left transition hover:border-primary hover:bg-muted/50">
              <div className="text-xs text-muted-foreground">Outflow</div>
              <div className="text-xl font-semibold text-destructive">{money(stats?.outflow ?? 0)}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Click for details</div>
            </button>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">Net</div>
              <div className={`text-xl font-semibold ${(stats?.net ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{money(stats?.net ?? 0)}</div>
            </div>
          </div>
          {stats?.byMethod && Object.keys(stats.byMethod).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(stats.byMethod).map(([m, v]) => (
                <Badge key={m} variant="secondary" className="capitalize">{m}: {money(Number(v))}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Cash reconciliation (kept) */}
      <Card className="shadow-[var(--shadow-soft)]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Cash Drawer Reconciliation</CardTitle>
          </div>
          <CardDescription>
            {hasShift
              ? "Live from your open cash shift — same figures as the Cash Drawer page"
              : "No open shift — showing today's cash movement with a manual opening float"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Label htmlFor="opening-float" className="text-xs">Opening float</Label>
                <Input id="opening-float" type="number" inputMode="decimal" value={hasShift ? String(shiftOpening) : openingFloat} disabled={hasShift} onChange={(e) => setOpeningFloat(e.target.value)} />
                {hasShift && <p className="mt-1 text-xs text-muted-foreground">Taken from the open shift.</p>}
              </div>
              <div>
                <Label htmlFor="counted-cash" className="text-xs">Counted cash in drawer</Label>
                <Input id="counted-cash" type="number" inputMode="decimal" placeholder="Enter counted amount" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="space-y-2 text-sm">
                <Row label="Opening float" value={money(openingNum)} />
                <Row label="+ Cash sales" value={money(drawerSales)} tone="text-success" />
                <Row label="− Cash refunds" value={money(drawerRefunds)} tone="text-destructive" />
                {hasShift && <Row label="− Supplier payments (cash)" value={money(drawerSupplier)} tone="text-destructive" />}
                <Row label="− Cash expenses" value={money(drawerExpenses)} tone="text-destructive" />
                <div className="my-2 border-t" />
                <Row label="Expected in drawer" value={money(expectedDrawer)} bold />

                {countedNum !== null && (
                  <>
                    <Row label="Counted" value={money(countedNum)} bold />
                    <div className="mt-3 rounded-md border p-3">
                      {variance === 0 ? (
                        <div className="flex items-center gap-2 text-success">
                          <Badge className="bg-success text-success-foreground">Balanced</Badge>
                          <span className="text-sm">Drawer matches expected total.</span>
                        </div>
                      ) : (
                        <div className={`flex items-center gap-2 ${(variance ?? 0) > 0 ? "text-warning" : "text-destructive"}`}>
                          <Badge variant={(variance ?? 0) > 0 ? "secondary" : "destructive"}>{(variance ?? 0) > 0 ? "Over" : "Short"}</Badge>
                          <span className="text-sm font-medium">Discrepancy: {money(Math.abs(variance ?? 0))}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={drill !== null} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {drill === "inflow" ? "Today's Inflow" : "Today's Outflow"} — {money(drill === "inflow" ? stats?.inflow ?? 0 : stats?.outflow ?? 0)}
            </DialogTitle>
            <DialogDescription>
              {drill === "inflow" ? "POS payments received today" : "Accounts expenses recorded today plus POS refunds"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {drill === "inflow" && (
              <Table>
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Invoice</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {positivePayments.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No payments today</TableCell></TableRow>
                  ) : positivePayments.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs text-muted-foreground">{new Date(p.received_at).toLocaleTimeString()}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sales?.invoice_no ?? "—"}</TableCell>
                      <TableCell className="capitalize">{p.method}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.reference ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium text-success">{money(Number(p.amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {drill === "outflow" && (
              <div className="space-y-6">
                <div>
                  <div className="mb-2 text-sm font-medium">Expenses</div>
                  <Table>
                    <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Paid to</TableHead><TableHead>Method</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(stats?.expenses ?? []).length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No expenses today</TableCell></TableRow>
                      ) : (stats?.expenses ?? []).map((e: any) => (
                        <TableRow key={e.id}>
                          <TableCell>{e.category}</TableCell>
                          <TableCell>{e.paid_to ?? "—"}</TableCell>
                          <TableCell className="capitalize">{e.method}</TableCell>
                          <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{e.notes ?? "—"}</TableCell>
                          <TableCell className="text-right font-medium text-destructive">{money(Number(e.amount))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {refundPayments.length > 0 && (
                  <div>
                    <div className="mb-2 text-sm font-medium">POS Refunds</div>
                    <Table>
                      <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Invoice</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {refundPayments.map((p: any) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs text-muted-foreground">{new Date(p.received_at).toLocaleTimeString()}</TableCell>
                            <TableCell className="font-mono text-xs">{p.sales?.invoice_no ?? "—"}</TableCell>
                            <TableCell className="capitalize">{p.method}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{p.reference ?? "—"}</TableCell>
                            <TableCell className="text-right font-medium text-destructive">{money(Number(p.amount))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ label, value, curr, prev, sub, icon: Icon, tone, invert, noDelta }: {
  label: string; value: string; curr: number; prev: number; sub?: string;
  icon: any; tone?: string; invert?: boolean; noDelta?: boolean;
}) {
  const delta = pct(curr, prev);
  const positive = invert ? delta < 0 : delta > 0;
  const neutral = Math.abs(delta) < 0.01;
  return (
    <Card className="shadow-[var(--shadow-soft)]">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardDescription>{label}</CardDescription>
        <Icon className={`h-4 w-4 ${tone ?? "text-primary"}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {!noDelta && (
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            {neutral ? (
              <span className="text-muted-foreground">—</span>
            ) : positive ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-success/10 px-1.5 py-0.5 font-medium text-success">
                <ArrowUpRight className="h-3 w-3" />{Math.abs(delta).toFixed(1)}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                <ArrowDownRight className="h-3 w-3" />{Math.abs(delta).toFixed(1)}%
              </span>
            )}
            <span className="text-muted-foreground">{sub}</span>
          </div>
        )}
        {noDelta && sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Leaderboard({ title, icon: Icon, rows, empty }: { title: string; icon: any; rows: { label: string; sub?: string; right: string }[]; empty: string }) {
  return (
    <Card className="shadow-[var(--shadow-soft)]">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.label}</div>
                    {r.sub && <div className="truncate text-xs text-muted-foreground">{r.sub}</div>}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-medium">{r.right}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AlertBlock({ title, icon: Icon, tone, count, rows, actionHref, actionLabel }: {
  title: string; icon: any; tone: "warning" | "destructive" | "primary"; count: number;
  rows: { label: string; right: string }[]; actionHref: string; actionLabel: string;
}) {
  const toneClass = tone === "destructive" ? "text-destructive bg-destructive/10" : tone === "warning" ? "text-warning bg-warning/10" : "text-primary bg-primary/10";
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${toneClass}`}><Icon className="h-4 w-4" /></span>
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">{count} item{count === 1 ? "" : "s"}</div>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
          <Link to={actionHref as any}>{actionLabel}</Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">All clear ✓</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 font-medium">{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value, tone, bold }: { label: string; value: string; tone?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${tone ?? ""} ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
