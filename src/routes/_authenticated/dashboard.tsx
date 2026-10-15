import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CustomerMixCard } from "@/components/CustomerMixCard";
import { fetchAll } from "@/lib/fetch-all";
import { dayRangeISO } from "@/lib/sales-ledger";
import { dhakaDayKey, shiftDay, summarizeSales } from "@/lib/sales-summary";
import {
  CalendarDays,
  CalendarPlus,
  PawPrint,
  ShoppingCart,
  Package,
  AlertTriangle,
  Wallet,
  Calculator,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Stethoscope,
  Clock,
  FileWarning,
  Truck,
  ChevronRight,
  ReceiptText,
  CheckCircle2,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
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
  const v = Number(n || 0);
  return `${v < 0 ? "-" : ""}৳${Math.abs(v).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
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

const MIX_COLORS = [
  "var(--primary)",
  "var(--foreground)",
  "color-mix(in oklab, var(--primary) 55%, var(--card))",
  "color-mix(in oklab, var(--foreground) 45%, var(--card))",
  "color-mix(in oklab, var(--primary) 25%, var(--card))",
  "color-mix(in oklab, var(--foreground) 18%, var(--card))",
];
const TOOLTIP_STYLE = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, boxShadow: "var(--shadow-soft)" };
const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

function Dashboard() {
  const { hasRole, can } = useAuth();
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

  const { data: stats, dataUpdatedAt } = useQuery({
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
  const [alertTab, setAlertTab] = useState<AlertKey>("unpaid");
  const [leaderTab, setLeaderTab] = useState<"customers" | "products" | "pets" | "doctors">("customers");

  const metric = isAdmin ? trendMetric : "sales";
  const chartData = useMemo(() => {
    const src = stats?.series ?? [];
    return trendRange === "7" ? src.slice(-7) : src;
  }, [stats?.series, trendRange]);
  const rangeTotal = chartData.reduce((s, r: any) => s + Number(r[metric] ?? 0), 0);
  const bestDay = chartData.reduce<any>((best, r: any) => (!best || Number(r[metric]) > Number(best[metric]) ? r : best), null);
  const spark = (stats?.series ?? []).slice(-7);

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

  // ---------- attention items ----------
  const unpaidTotal = (stats?.unpaidSales ?? []).reduce((s: number, r: any) => s + Number(r.due || 0), 0);
  const supplierTotal = (stats?.supplierDues ?? []).reduce((s: number, r: any) => s + Number(r.balance_due || 0), 0);
  const capped = (n: number) => (n >= 10 ? "10+" : String(n));
  const attention: AttentionItem[] = [
    { key: "unpaid", short: "Unpaid", label: "Unpaid invoices", sub: unpaidTotal > 0 ? `${money(unpaidTotal)} to collect` : "Nothing to collect", count: stats?.unpaidSales?.length ?? 0, shown: capped(stats?.unpaidSales?.length ?? 0), icon: FileWarning, tone: "red", href: "/due-bills", action: "Collect" },
    { key: "supplier", short: "Suppliers", label: "Supplier dues", sub: supplierTotal > 0 ? `${money(supplierTotal)} to pay` : "All suppliers paid", count: stats?.supplierDues?.length ?? 0, shown: capped(stats?.supplierDues?.length ?? 0), icon: Truck, tone: "red", href: "/purchases", action: "Pay" },
    { key: "low", short: "Low stock", label: "Low stock", sub: "At or below the reorder level", count: stats?.low?.length ?? 0, shown: String(stats?.low?.length ?? 0), icon: AlertTriangle, tone: "amber", href: "/inventory", action: "Restock" },
    { key: "expiry", short: "Expiring", label: "Expiring soon", sub: "Batches expiring within 30 days", count: stats?.nearExpiry?.length ?? 0, shown: capped(stats?.nearExpiry?.length ?? 0), icon: Clock, tone: "amber", href: "/inventory", action: "Review" },
    { key: "appts", short: "Appointments", label: "Appointments to confirm", sub: "Waiting for confirmation", count: stats?.pendingList?.length ?? 0, shown: capped(stats?.pendingList?.length ?? 0), icon: CalendarDays, tone: "orange", href: "/appointments", action: "Confirm" },
  ];
  const attentionTotal = attention.reduce((s, a) => s + a.count, 0);
  const alertRows: Record<AlertKey, { label: string; sub?: string; right: string }[]> = {
    unpaid: (stats?.unpaidSales ?? []).map((s: any) => ({ label: s.pet_owners?.full_name ?? "Walk-in", sub: s.invoice_no, right: money(Number(s.due)) })),
    supplier: (stats?.supplierDues ?? []).map((s: any) => ({ label: s.name, right: money(Number(s.balance_due)) })),
    low: (stats?.low ?? []).slice(0, 10).map((p: any) => ({ label: p.name, sub: `Reorder at ${Number(p.low_stock_threshold)}`, right: `${Number(p.stock_quantity)} left` })),
    expiry: (stats?.nearExpiry ?? []).map((b: any) => ({ label: b.name, sub: `${b.qty} in batch`, right: new Date(b.expiry).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) })),
    appts: (stats?.pendingList ?? []).map((a: any) => ({
      label: a.pets?.name ?? a.guest_pet_name ?? "Pet",
      sub: a.pet_owners?.full_name ?? a.guest_name ?? undefined,
      right: new Date(a.scheduled_at).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    })),
  };
  const activeAlert = attention.find((a) => a.key === alertTab)!;

  const openAlert = (k: AlertKey) => {
    setAlertTab(k);
    document.getElementById("alerts")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ---------- leaders ----------
  const leaders = {
    customers: (stats?.topCustomers ?? []).map((c) => ({ label: c.name, sub: `${c.orders} bill${c.orders === 1 ? "" : "s"}`, value: c.total, right: money(c.total) })),
    products: (stats?.topProducts ?? []).map(([name, qty]) => ({ label: name, value: Number(qty), right: `${qty} sold` })),
    pets: (stats?.topPets ?? []).map((p) => ({ label: p.name, sub: p.species, value: p.count, right: `${p.count} visit${p.count === 1 ? "" : "s"}` })),
    doctors: (stats?.topDoctors ?? []).map((d) => ({ label: d.name, value: d.count, right: `${d.count} appt${d.count === 1 ? "" : "s"}` })),
  };
  const leaderRows = leaders[leaderTab];
  const leaderMax = Math.max(1, ...leaderRows.map((r) => r.value));

  const mix = stats?.categoryPie ?? [];
  const mixTotal = mix.reduce((s, m) => s + m.value, 0);

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Dhaka" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dhaka" });
  const updatedLabel = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }) : null;

  const salesDelta = pct(stats?.todaySales ?? 0, stats?.yestSales ?? 0);
  const quickActions = [
    can("pos") && { to: "/pos", label: "New sale", short: "New sale", icon: ShoppingCart, primary: true },
    can("clinic_bill") && { to: "/clinic-bill", label: "Service bill", short: "Service", icon: ReceiptText },
    can("appointments") && { to: "/appointments", label: "Appointment", short: "Booking", icon: CalendarPlus },
  ].filter(Boolean) as { to: string; label: string; short: string; icon: any; primary?: boolean }[];

  const monthCells = [
    { label: "Net sales this month", value: money(stats?.monthTotal ?? 0), curr: stats?.monthTotal ?? 0, prev: stats?.lastMonthTotal ?? 0, note: `Last month ${money(stats?.lastMonthTotal ?? 0)}`, progress: true },
    ...(isAdmin ? [{ label: "Expenses this month", value: money(stats?.monthExp ?? 0), curr: stats?.monthExp ?? 0, prev: stats?.lastMonthExpense ?? 0, note: `Last month ${money(stats?.lastMonthExpense ?? 0)}`, invert: true }] : []),
    { label: "Appointments today", value: String(stats?.todayApptsCount ?? 0), note: "Scheduled for today", noDelta: true },
    { label: "Waiting to confirm", value: String(stats?.pendingApptsCount ?? 0), note: "Pending appointments", noDelta: true },
  ];

  const heroStats = [
    { label: "Collected", value: money(stats?.todayPaid ?? 0), hint: "Received on today's bills" },
    { label: "Due today", value: money(stats?.todayDue ?? 0), hint: "Left unpaid on today's bills", warn: (stats?.todayDue ?? 0) > 0 },
    { label: "Bills", value: String(stats?.todayOrders ?? 0), hint: `${stats?.yestOrders ?? 0} yesterday` },
    isAdmin
      ? { label: "Profit", value: money(stats?.todayProfit ?? 0), hint: `${money(stats?.yestProfit ?? 0)} yesterday` }
      : { label: "Appointments", value: String(stats?.todayApptsCount ?? 0), hint: "Scheduled today" },
  ];

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      {/* Header */}
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{greeting}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {dateLabel}
            {updatedLabel && <span className="ml-2 inline-flex items-center gap-1.5"><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" aria-hidden />Live, updated {updatedLabel}</span>}
          </p>
        </div>
        {quickActions.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:flex">
            {quickActions.map((a) => (
              <Button key={a.to} asChild size="sm" variant={a.primary ? "default" : "outline"} className="h-9 rounded-full px-3 sm:px-4">
                <Link to={a.to as any}><a.icon className="h-4 w-4" /> <span className="truncate sm:hidden">{a.short}</span><span className="hidden sm:inline">{a.label}</span></Link>
              </Button>
            ))}
          </div>
        )}
      </header>

      {/* Today hero + attention */}
      <div className="grid min-w-0 gap-4 sm:gap-5 xl:grid-cols-12">
        <section className="relative flex min-w-0 flex-col overflow-hidden rounded-3xl bg-sidebar p-5 text-sidebar-foreground sm:p-7 xl:col-span-8">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl" />
          <div className="relative grid min-w-0 flex-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center">
            <div className="min-w-0">
              <p className="text-sm text-white/60">Today's net sales</p>
              <p className="mt-1 truncate text-[40px] font-bold leading-none tracking-tight tabular-nums sm:text-[52px]">{money(stats?.todaySales ?? 0)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <DeltaChip delta={salesDelta} dark neutral={!(stats?.todaySales || stats?.yestSales)} />
                <span className="text-white/60">vs yesterday ({money(stats?.yestSales ?? 0)})</span>
              </div>
              {(stats?.todayRefund ?? 0) > 0 && (
                <p className="mt-2 text-xs text-white/50">Gross {money(stats?.todayGross ?? 0)}, returns {money(stats?.todayRefund ?? 0)}</p>
              )}
            </div>
            <div className="min-w-0">
              <div className="h-[92px] w-full min-w-0 sm:h-[130px]">
                <ResponsiveContainer>
                  <AreaChart data={spark} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="heroSpark" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--sidebar-primary)" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="var(--sidebar-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      cursor={{ stroke: "rgba(255,255,255,.25)" }}
                      contentStyle={{ ...TOOLTIP_STYLE, background: "#1a1a1a", border: "1px solid #333", color: "#fff" }}
                      labelStyle={{ color: "rgba(255,255,255,.6)" }}
                      formatter={(v: any) => [money(Number(v)), "Net sales"]}
                    />
                    <Area type="monotone" dataKey="sales" stroke="var(--sidebar-primary)" strokeWidth={2.5} fill="url(#heroSpark)" dot={false} activeDot={{ r: 4, fill: "var(--sidebar-primary)", stroke: "#000" }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-white/40">
                <span>{spark[0]?.day ? fmtDay(spark[0].day) : ""}</span>
                <span>Last 7 days</span>
                <span>Today</span>
              </div>
            </div>
          </div>
          <dl className="relative mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-4">
            {heroStats.map((h) => (
              <div key={h.label} className="min-w-0 bg-sidebar/95 p-3 sm:p-4">
                <dt className="text-xs text-white/55">{h.label}</dt>
                <dd className={`mt-1 truncate text-lg font-semibold tabular-nums sm:text-xl ${"warn" in h && h.warn ? "text-[#ff9a62]" : ""}`}>{h.value}</dd>
                <dd className="mt-0.5 truncate text-[11px] text-white/40">{h.hint}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex min-w-0 flex-col rounded-3xl border bg-card p-4 sm:p-5 xl:col-span-4">
          <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
            <h2 className="text-base font-semibold">Needs attention</h2>
            <span className="text-xs text-muted-foreground">{attentionTotal === 0 ? "All clear" : `${attention.filter((a) => a.count > 0).length} of ${attention.length} areas`}</span>
          </div>
          <ul className="flex flex-1 flex-col">
            {attention.map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  onClick={() => openAlert(a.key)}
                  className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${a.count === 0 ? "bg-muted text-muted-foreground" : TONES[a.tone]}`}>
                    {a.count === 0 ? <CheckCircle2 className="h-4 w-4" /> : <a.icon className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.sub}</span>
                  </span>
                  <span className={`text-lg font-semibold tabular-nums ${a.count === 0 ? "text-muted-foreground/60" : ""}`}>{a.shown}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Month strip */}
      <section className={`grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border ${monthCells.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {monthCells.map((m: any) => {
          const share = m.progress && m.prev > 0 ? Math.min(100, (m.curr / m.prev) * 100) : null;
          return (
            <div key={m.label} className="min-w-0 bg-card p-4 sm:p-5">
              <p className="truncate text-xs text-muted-foreground sm:text-sm">{m.label}</p>
              <p className="mt-1 truncate text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{m.value}</p>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {!m.noDelta && <DeltaChip delta={pct(m.curr, m.prev)} invert={m.invert} neutral={!m.curr && !m.prev} />}
                <span className="truncate text-muted-foreground">{m.note}</span>
              </div>
              {share !== null && (
                <div className="mt-3" title={`${share.toFixed(0)}% of last month's total so far`}>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${share}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{share.toFixed(0)}% of last month reached</p>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Trend + category mix */}
      <div className="grid min-w-0 gap-4 sm:gap-5 xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          title={isAdmin ? "Performance" : "Sales trend"}
          hint="Net sales after returns, by day"
          right={
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <Segmented
                  value={trendMetric}
                  onChange={(v) => setTrendMetric(v as any)}
                  options={[{ value: "sales", label: "Sales" }, { value: "profit", label: "Profit" }, { value: "expense", label: "Expense" }]}
                />
              )}
              <Segmented value={trendRange} onChange={(v) => setTrendRange(v as any)} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
            </div>
          }
        >
          <div className="mb-4 grid grid-cols-3 gap-3">
            <MiniStat label={`Total ${metric}`} value={money(rangeTotal)} />
            <MiniStat label="Daily average" value={money(chartData.length ? rangeTotal / chartData.length : 0)} />
            <MiniStat label="Best day" value={bestDay && Number(bestDay[metric]) > 0 ? fmtDay(bestDay.day) : "—"} sub={bestDay && Number(bestDay[metric]) > 0 ? money(Number(bestDay[metric])) : undefined} />
          </div>
          <div className="h-[230px] w-full min-w-0 sm:h-[280px]">
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradMetric" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={METRIC_COLOR[metric]} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={METRIC_COLOR[metric]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tickFormatter={fmtDay} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => moneyShort(Number(v))} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => fmtDay(String(l))} formatter={(v: any) => [money(Number(v)), metric[0].toUpperCase() + metric.slice(1)]} />
                <Area type="monotone" dataKey={metric} stroke={METRIC_COLOR[metric]} strokeWidth={2.5} fill="url(#gradMetric)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="xl:col-span-4" title="Sales by category" hint="Last 30 days">
          {mix.length === 0 ? (
            <Empty text="No sales in the last 30 days." />
          ) : (
            <div className="grid min-w-0 items-center gap-4 sm:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-1">
              <div className="relative mx-auto h-[180px] w-[180px]">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={mix} dataKey="value" nameKey="name" innerRadius={58} outerRadius={84} paddingAngle={2} stroke="var(--card)" strokeWidth={2}>
                      {mix.map((_, i) => <Cell key={i} fill={MIX_COLORS[i % MIX_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, n: any) => [money(Number(v)), prettyCat(String(n))]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[11px] text-muted-foreground">Total</span>
                  <span className="text-base font-bold tabular-nums">{moneyShort(mixTotal)}</span>
                </div>
              </div>
              <ul className="min-w-0 space-y-2">
                {mix.slice().sort((a, b) => b.value - a.value).map((m) => {
                  const i = mix.indexOf(m);
                  return (
                    <li key={m.name} className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />
                      <span className="min-w-0 flex-1 truncate">{prettyCat(m.name)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{mixTotal ? Math.round((m.value / mixTotal) * 100) : 0}%</span>
                      <span className="w-20 shrink-0 text-right font-medium tabular-nums">{money(m.value)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      {/* Customers today */}
      <CustomerMixCard />

      {/* Leaders + alerts */}
      <div className="grid min-w-0 gap-4 sm:gap-5 xl:grid-cols-12">
        <Panel
          className="xl:col-span-5"
          title="Top performers"
          hint="Last 30 days"
          right={
            <Segmented
              value={leaderTab}
              onChange={(v) => setLeaderTab(v as any)}
              options={[{ value: "customers", label: "Customers" }, { value: "products", label: "Products" }, { value: "pets", label: "Pets" }, { value: "doctors", label: "Doctors" }]}
            />
          }
        >
          {leaderRows.length === 0 ? (
            <Empty text={leaderTab === "customers" ? "No customer sales yet." : leaderTab === "products" ? "No products sold yet." : leaderTab === "pets" ? "No appointments yet." : "No doctor activity yet."} />
          ) : (
            <ol className="space-y-3">
              {leaderRows.map((r, i) => {
                const Icon = leaderTab === "customers" ? Users : leaderTab === "products" ? Package : leaderTab === "pets" ? PawPrint : Stethoscope;
                return (
                  <li key={i} className="min-w-0">
                    <div className="flex min-w-0 items-center gap-3 text-sm">
                      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.label}</span>
                        {"sub" in r && r.sub && <span className="block truncate text-xs capitalize text-muted-foreground">{r.sub}</span>}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{r.right}</span>
                    </div>
                    <div className="ml-11 mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${i === 0 ? "bg-primary" : "bg-foreground/30"}`} style={{ width: `${(r.value / leaderMax) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <section id="alerts" className="min-w-0 scroll-mt-20 rounded-2xl border bg-card xl:col-span-7">
          <div className="flex min-w-0 gap-1 overflow-x-auto border-b p-2" role="tablist" aria-label="Alerts">
            {attention.map((a) => (
              <button
                key={a.key}
                type="button"
                role="tab"
                aria-selected={alertTab === a.key}
                onClick={() => setAlertTab(a.key)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${alertTab === a.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {a.short}
                <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${alertTab === a.key ? "bg-background/20" : a.count > 0 ? TONES[a.tone] : "bg-muted"}`}>{a.shown}</span>
              </button>
            ))}
          </div>
          <div className="p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm text-muted-foreground">{activeAlert.sub}</p>
              <Button asChild size="sm" variant="outline" className="h-8 shrink-0 rounded-full">
                <Link to={activeAlert.href as any}>{activeAlert.action} <ChevronRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
            {alertRows[alertTab].length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="h-6 w-6 text-success" />
                Nothing here right now.
              </div>
            ) : (
              <ul className="divide-y">
                {alertRows[alertTab].slice(0, 8).map((r, i) => (
                  <li key={i} className="flex min-w-0 items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.label}</span>
                      {r.sub && <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{r.right}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Money in the drawer */}
      <div className="grid min-w-0 gap-4 sm:gap-5 xl:grid-cols-12">
        {isAdmin && (
          <Panel className="xl:col-span-5" title="Today's cashflow" hint="Payments in, expenses and refunds out">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setDrill("inflow")} className="group rounded-xl bg-success/10 p-4 text-left transition-colors hover:bg-success/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center justify-between text-xs text-muted-foreground">Money in <ArrowUpRight className="h-4 w-4 text-success" /></span>
                <span className="mt-1 block truncate text-xl font-bold tabular-nums text-success">{money(stats?.inflow ?? 0)}</span>
                <span className="mt-1 block text-[11px] text-muted-foreground group-hover:text-foreground">See payments</span>
              </button>
              <button type="button" onClick={() => setDrill("outflow")} className="group rounded-xl bg-destructive/10 p-4 text-left transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center justify-between text-xs text-muted-foreground">Money out <ArrowDownRight className="h-4 w-4 text-destructive" /></span>
                <span className="mt-1 block truncate text-xl font-bold tabular-nums text-destructive">{money(stats?.outflow ?? 0)}</span>
                <span className="mt-1 block text-[11px] text-muted-foreground group-hover:text-foreground">See expenses</span>
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl border px-4 py-3">
              <span className="text-sm text-muted-foreground">Net today</span>
              <span className={`text-lg font-bold tabular-nums ${(stats?.net ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{money(stats?.net ?? 0)}</span>
            </div>
            {stats?.byMethod && Object.keys(stats.byMethod).length > 0 && (
              <div className="mt-4 space-y-2">
                {Object.entries(stats.byMethod).sort(([, a], [, b]) => Number(b) - Number(a)).map(([m, v]) => {
                  const share = (stats.inflow ?? 0) > 0 ? Math.max(0, (Number(v) / stats.inflow) * 100) : 0;
                  return (
                    <div key={m} className="text-sm">
                      <div className="flex justify-between"><span className="capitalize text-muted-foreground">{m}</span><span className="font-medium tabular-nums">{money(Number(v))}</span></div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/60" style={{ width: `${share}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        )}

        <Panel
          className={isAdmin ? "xl:col-span-7" : "xl:col-span-12"}
          title="Cash drawer check"
          hint={hasShift ? "Live from your open cash shift, same as the Cash Drawer page" : "No open shift. Showing today's cash with a manual opening float"}
          right={<Calculator className="hidden h-4 w-4 text-muted-foreground sm:block" />}
        >
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Label htmlFor="opening-float" className="text-xs">Opening float</Label>
                <Input id="opening-float" type="number" inputMode="decimal" value={hasShift ? String(shiftOpening) : openingFloat} disabled={hasShift} onChange={(e) => setOpeningFloat(e.target.value)} />
                {hasShift && <p className="mt-1 text-xs text-muted-foreground">Taken from the open shift.</p>}
              </div>
              <div>
                <Label htmlFor="counted-cash" className="text-xs">Cash counted in the drawer</Label>
                <Input id="counted-cash" type="number" inputMode="decimal" placeholder="Enter the counted amount" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} />
              </div>
              {countedNum !== null && (
                <div className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium ${variance === 0 ? "bg-success/10 text-success" : (variance ?? 0) > 0 ? "bg-warning/15 text-foreground" : "bg-destructive/10 text-destructive"}`}>
                  <span>{variance === 0 ? "Balanced" : (variance ?? 0) > 0 ? "Over" : "Short"}</span>
                  <span className="tabular-nums">{variance === 0 ? money(countedNum) : money(Math.abs(variance ?? 0))}</span>
                </div>
              )}
            </div>
            <div className="rounded-xl bg-muted/60 p-4">
              <div className="space-y-2 text-sm">
                <Row label="Opening float" value={money(openingNum)} />
                <Row label="+ Cash sales" value={money(drawerSales)} tone="text-success" />
                <Row label="− Cash refunds" value={money(drawerRefunds)} tone="text-destructive" />
                {hasShift && <Row label="− Supplier payments" value={money(drawerSupplier)} tone="text-destructive" />}
                <Row label="− Cash expenses" value={money(drawerExpenses)} tone="text-destructive" />
                <div className="my-2 border-t border-dashed" />
                <Row label="Expected in drawer" value={money(expectedDrawer)} bold />
                {countedNum !== null && <Row label="Counted" value={money(countedNum)} bold />}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Dialog open={drill !== null} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {drill === "inflow" ? "Money in today" : "Money out today"}: {money(drill === "inflow" ? stats?.inflow ?? 0 : stats?.outflow ?? 0)}
            </DialogTitle>
            <DialogDescription>
              {drill === "inflow" ? "POS payments received today" : "Expenses recorded today plus POS refunds"}
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
                    <div className="mb-2 text-sm font-medium">POS refunds</div>
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

type AlertKey = "unpaid" | "supplier" | "low" | "expiry" | "appts";
type AttentionItem = { key: AlertKey; short: string; label: string; sub: string; count: number; shown: string; icon: any; tone: keyof typeof TONES; href: string; action: string };

const TONES = {
  red: "bg-destructive/10 text-destructive",
  amber: "bg-warning/15 text-[#b45309] dark:text-warning",
  orange: "bg-primary/10 text-primary",
};

const METRIC_COLOR: Record<string, string> = {
  sales: "var(--primary)",
  profit: "var(--success)",
  expense: "var(--destructive)",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "10-12" → "12 Oct" */
function fmtDay(mmdd: string) {
  const [m, d] = String(mmdd).split("-");
  const mi = Number(m) - 1;
  return MONTHS[mi] ? `${Number(d)} ${MONTHS[mi]}` : String(mmdd);
}

function prettyCat(c: string) {
  return c.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());
}

function DeltaChip({ delta, invert, dark, neutral }: { delta: number; invert?: boolean; dark?: boolean; neutral?: boolean }) {
  if (neutral || Math.abs(delta) < 0.05) {
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${dark ? "bg-white/10 text-white/60" : "bg-muted text-muted-foreground"}`}>No change</span>;
  }
  const up = delta > 0;
  const good = invert ? !up : up;
  const cls = dark
    ? good ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"
    : good ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      <Icon className="h-3.5 w-3.5" />{Math.abs(delta) >= 1000 ? "999+" : Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)}%
    </span>
  );
}

function Panel({ title, hint, right, className, children }: { title: string; hint?: string; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-2xl border bg-card p-4 sm:p-5 ${className ?? ""}`}>
      <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {right && <div className="min-w-0 shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-muted p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] capitalize text-muted-foreground sm:text-xs">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums sm:text-lg">{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>;
}

function Row({ label, value, tone, bold }: { label: string; value: string; tone?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${tone ?? ""} ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
