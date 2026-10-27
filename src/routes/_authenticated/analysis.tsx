import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, BarChart3, FileDown } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/report/DataTable";
import { MoneyByBusiness } from "@/components/MoneyByBusiness";
import { monthStartDhaka, todayDhaka, dayRangeISO } from "@/lib/sales-ledger";
import { shiftDay } from "@/lib/sales-summary";
import {
  changePct, computeByProject, computeSnapshot, hasProjects, loadPeriod, loadSnapshot,
  METHOD_LABEL, previousPeriod, snapshotForProject, type Computed,
} from "@/lib/business-report";
import { exportToExcel } from "@/lib/export-excel";
import { PROJECTS, projectLabel, type Project } from "@/lib/projects";

export const Route = createFileRoute("/_authenticated/analysis")({
  head: () => ({ meta: [{ title: "Analysis — Pet Care Vet & Sasthya Seba | Pet Care Vet ERP" }] }),
  component: AnalysisPage,
});

type Pick = Project | "all";
type Preset = "today" | "week" | "month" | "lastMonth" | "custom";

const fmt = (v: number) => { const x = Math.round(Number(v) || 0); return `${x < 0 ? "−" : ""}৳${Math.abs(x).toLocaleString("en-IN")}`; };
const TOTAL_TONE = "#475569";

function rangeFor(p: Preset) {
  const t = todayDhaka();
  if (p === "today") return { from: t, to: t };
  if (p === "week") return { from: shiftDay(t, -6), to: t };
  if (p === "lastMonth") {
    const end = shiftDay(monthStartDhaka(), -1);
    return { from: `${end.slice(0, 7)}-01`, to: end };
  }
  return { from: monthStartDhaka(), to: t };
}

function Change({ cur, prev }: { cur: number; prev?: number }) {
  if (prev == null) return null;
  const ch = changePct(cur, prev);
  if (ch == null) return <span className="text-xs text-muted-foreground">new this period</span>;
  const up = ch >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-emerald-700" : "text-destructive"}`}>
      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {Math.abs(ch).toFixed(0)}% vs previous
    </span>
  );
}

function BusinessCard({ label, tone, c, p, due, active, onClick }: {
  label: string; tone: string; c: Computed; p?: Computed | null; due: number; active: boolean; onClick: () => void;
}) {
  const line = (k: string, v: number, cls = "") => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-muted-foreground">{k}</span>
      <span className={`text-base font-semibold tabular-nums ${cls}`}>{fmt(v)}</span>
    </div>
  );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`w-full rounded-xl border bg-card p-4 text-left transition-shadow ${active ? "shadow-md" : "hover:shadow-sm"}`}
      style={active ? { borderColor: tone, boxShadow: `0 0 0 1px ${tone}` } : undefined}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: tone }} />
        <span className="font-semibold">{label}</span>
      </div>
      {line("Sales", c.sales.netSales)}
      {line("Expense", c.opex)}
      {line("Profit", c.netProfit, c.netProfit < 0 ? "text-destructive" : "text-emerald-700")}
      {line("Due", due, due > 0 ? "text-amber-700" : "")}
      <div className="mt-1 min-h-4"><Change cur={c.sales.netSales} prev={p?.sales.netSales} /></div>
    </button>
  );
}

function AnalysisPage() {
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(rangeFor("month"));
  const [pick, setPick] = useState<Pick>("all");
  const prev = useMemo(() => previousPeriod(range), [range]);

  const enabledQ = useQuery({ queryKey: ["has-projects"], queryFn: hasProjects, staleTime: Infinity });
  const curQ = useQuery({ queryKey: ["business-report", range.from, range.to], queryFn: () => loadPeriod(range), staleTime: 60_000 });
  const prevQ = useQuery({ queryKey: ["business-report", prev.from, prev.to], queryFn: () => loadPeriod(prev), staleTime: 5 * 60_000 });
  const snapQ = useQuery({ queryKey: ["business-snapshot"], queryFn: loadSnapshot, staleTime: 60_000 });

  const cur = useMemo(() => (curQ.data ? computeByProject(curQ.data) : null), [curQ.data]);
  const prv = useMemo(() => (prevQ.data ? computeByProject(prevQ.data) : null), [prevQ.data]);
  const snap = useMemo(() => {
    if (!snapQ.data) return null;
    return {
      all: computeSnapshot(snapQ.data),
      pcv: computeSnapshot(snapshotForProject(snapQ.data, "pcv")),
      ss: computeSnapshot(snapshotForProject(snapQ.data, "ss")),
    };
  }, [snapQ.data]);

  const chartData = useMemo(() => {
    if (!cur) return [];
    const days = new Map<string, { day: string; pcv: number; ss: number }>();
    for (const k of ["pcv", "ss"] as const) {
      for (const r of cur[k].daily) {
        const d = days.get(r.day) ?? { day: r.day, pcv: 0, ss: 0 };
        d[k] = Math.round(r.net);
        days.set(r.day, d);
      }
    }
    return [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, label: d.day.slice(5) }));
  }, [cur]);

  const choose = (k: Preset) => { setPreset(k); if (k !== "custom") setRange(rangeFor(k)); };
  const chip = (on: boolean) => `h-8 rounded-md border px-3 text-xs font-medium transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;
  const { fromISO, toISO } = dayRangeISO(range.from, range.to);

  const c = cur ? cur[pick] : null;
  const s = snap ? snap[pick] : null;
  const pickLabel = pick === "all" ? "Total" : projectLabel(pick);

  return (
    <div className="space-y-4">
      <PageHeader title="Analysis" description="Pet Care Vet and Sasthya Seba — sales, expense, profit and due, each on its own and together." icon={BarChart3} />

      <div className="flex flex-wrap items-center gap-2">
        {([["today", "Today"], ["week", "Last 7 days"], ["month", "This month"], ["lastMonth", "Last month"], ["custom", "Custom"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={chip(preset === k)} onClick={() => choose(k)}>{l}</button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input type="date" className="h-8 w-36" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} aria-label="From" />
            <span className="text-muted-foreground">→</span>
            <Input type="date" className="h-8 w-36" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} aria-label="To" />
          </div>
        )}
      </div>

      {enabledQ.data === false && (
        <Card><CardContent className="p-4 text-sm text-amber-800">
          Sasthya Seba is not set up in the database yet — everything below is Pet Care Vet. Ask the admin to run the Projects SQL.
        </CardContent></Card>
      )}

      {!cur || !snap ? (
        <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {PROJECTS.map((p) => (
            <BusinessCard key={p.key} label={p.label} tone={p.tone} c={cur[p.key]} p={prv?.[p.key]} due={snap[p.key].receivable}
              active={pick === p.key} onClick={() => setPick(pick === p.key ? "all" : p.key)} />
          ))}
          <BusinessCard label="Total" tone={TOTAL_TONE} c={cur.all} p={prv?.all} due={snap.all.receivable} active={pick === "all"} onClick={() => setPick("all")} />
        </div>
      )}

      {cur && cur.shared.total > 0 && (
        <p className="text-xs text-muted-foreground">
          Shared expenses {fmt(cur.shared.total)} are split by sales: Pet Care Vet {(cur.shared.pcvShare * 100).toFixed(0)}% ({fmt(cur.shared.total * cur.shared.pcvShare)}),
          Sasthya Seba {(cur.shared.ssShare * 100).toFixed(0)}% ({fmt(cur.shared.total * cur.shared.ssShare)}).
        </p>
      )}

      {chartData.length > 1 && (
        <Card>
          <CardContent className="p-3 sm:p-4">
            <h3 className="mb-2 text-sm font-semibold">Daily net sales</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => `৳${Number(v).toLocaleString("en-IN")}`} />
                  <Tooltip formatter={(v: number, name: string) => [fmt(v), name]} />
                  <Legend />
                  {PROJECTS.map((p) => (
                    <Line key={p.key} type="monotone" dataKey={p.key} name={p.label} stroke={p.tone} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {c && s && cur && (
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: pick === "all" ? TOTAL_TONE : PROJECTS.find((p) => p.key === pick)!.tone }} />
              <h3 className="font-semibold">{pickLabel} — details</h3>
              <span className="text-xs text-muted-foreground">Click a card above to switch</span>
            </div>
            <Tabs defaultValue={pick === "all" ? "compare" : "sales"} key={pick}>
              <TabsList className="h-auto flex-wrap">
                {pick === "all" && <TabsTrigger value="compare">Compare</TabsTrigger>}
                <TabsTrigger value="sales">Sales</TabsTrigger>
                <TabsTrigger value="products">Products</TabsTrigger>
                <TabsTrigger value="expenses">Expenses</TabsTrigger>
                <TabsTrigger value="due">Due</TabsTrigger>
                <TabsTrigger value="cash">Cash</TabsTrigger>
              </TabsList>

              {pick === "all" && (
                <TabsContent value="compare" className="pt-3">
                  <CompareTable cur={cur} snap={snap!} />
                </TabsContent>
              )}

              <TabsContent value="sales" className="space-y-4 pt-3">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <SubHead title="By category" onExcel={() => exportToExcel(c.categories.map((r) => ({ Category: r.category, Qty: r.qty, Sales: Math.round(r.revenue), Profit: Math.round(r.profit), "Margin %": Number(r.margin.toFixed(1)) })), `sales-by-category-${pick}`, "By category")} />
                    <DataTable rows={c.categories} searchable={false} pageSize={10} columns={[
                      { key: "category", label: "Category" },
                      { key: "revenue", label: "Sales", align: "right", render: (r) => fmt(r.revenue) },
                      { key: "profit", label: "Profit", align: "right", render: (r) => fmt(r.profit) },
                      { key: "margin", label: "Margin", align: "right", render: (r) => `${r.margin.toFixed(0)}%` },
                    ] as Column<(typeof c.categories)[number]>[]} />
                  </div>
                  <div>
                    <SubHead title="Money received by method" />
                    <DataTable searchable={false} pageSize={10}
                      rows={Object.entries(c.collected).map(([m, v]) => ({ method: METHOD_LABEL[m] ?? m, amount: v })).sort((a, b) => b.amount - a.amount)}
                      columns={[
                        { key: "method", label: "Method" },
                        { key: "amount", label: "Amount", align: "right", render: (r) => fmt(r.amount) },
                      ]} />
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <Stat label="Bills" value={String(c.sales.count)} />
                      <Stat label="Average bill" value={fmt(c.sales.count ? c.sales.invoiceSales / c.sales.count : 0)} />
                      <Stat label="Discounts" value={fmt(c.sales.discounts)} />
                      <Stat label="Returns / cancels" value={fmt(c.sales.reversals)} />
                      <Stat label="Gross profit" value={fmt(c.grossProfit)} />
                      <Stat label="Gross margin" value={`${c.grossMargin.toFixed(1)}%`} />
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="products" className="space-y-4 pt-3">
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <Stat label="Stock value (cost)" value={fmt(s.stockValue)} />
                  <Stat label="Stock value (selling)" value={fmt(s.retailValue)} />
                  <Stat label="Low / out of stock" value={`${s.low} / ${s.out}`} />
                  <Stat label="Expiring in 30 days" value={fmt(s.expiringValue)} />
                </div>
                <div>
                  <SubHead title="Best sellers" onExcel={() => exportToExcel(c.products.map((r) => ({ Product: r.name, Category: r.category, Qty: r.qty, Sales: Math.round(r.revenue), Profit: Math.round(r.profit) })), `products-${pick}`, "Products")} />
                  <DataTable rows={c.products} pageSize={10} initialSort={{ key: "revenue", dir: "desc" }} columns={[
                    { key: "name", label: "Product" },
                    { key: "category", label: "Category" },
                    { key: "qty", label: "Qty", align: "right" },
                    { key: "revenue", label: "Sales", align: "right", render: (r) => fmt(r.revenue) },
                    { key: "profit", label: "Profit", align: "right", render: (r) => <span className={r.profit < 0 ? "text-destructive" : ""}>{fmt(r.profit)}</span> },
                  ] as Column<(typeof c.products)[number]>[]} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <SubHead title="Low / out of stock" />
                    <DataTable rows={s.lowRows} pageSize={8} columns={[
                      { key: "name", label: "Product" },
                      { key: "stock_quantity", label: "Stock", align: "right" },
                      { key: "state", label: "State" },
                    ]} />
                  </div>
                  <div>
                    <SubHead title="Expiring soon" />
                    <DataTable rows={s.expiryRows} pageSize={8} columns={[
                      { key: "name", label: "Product" },
                      { key: "expiry", label: "Expiry" },
                      { key: "qty", label: "Qty", align: "right" },
                      { key: "value", label: "Value", align: "right", render: (r: any) => fmt(r.value) },
                    ]} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="expenses" className="space-y-3 pt-3">
                <SubHead title={`Expenses — ${fmt(c.opex)}`} onExcel={() => exportToExcel(c.opexRows.map((e: any) => ({ Date: e.expense_date, Category: e.category, Business: e.project ? projectLabel(e.project) : "Shared", Amount: Number(e.amount), "Paid to": e.paid_to ?? "", Notes: e.notes ?? "" })), `expenses-${pick}`, "Expenses")} />
                <div className="grid gap-4 lg:grid-cols-2">
                  <DataTable rows={c.expenseCategories} searchable={false} pageSize={10} columns={[
                    { key: "category", label: "Category" },
                    { key: "amount", label: "Amount", align: "right", render: (r) => fmt(r.amount) },
                    { key: "pct", label: "Of sales", align: "right", value: (r) => r.amount, render: (r) => (c.sales.netSales > 0 ? `${((r.amount / c.sales.netSales) * 100).toFixed(1)}%` : "—") },
                  ] as Column<(typeof c.expenseCategories)[number]>[]} />
                  <DataTable rows={c.opexRows} pageSize={10} columns={[
                    { key: "expense_date", label: "Date" },
                    { key: "category", label: "Category" },
                    { key: "project", label: "Business", render: (e: any) => (e.project ? projectLabel(e.project) : <span className="text-muted-foreground">Shared{e.shared ? " (share)" : ""}</span>) },
                    { key: "amount", label: "Amount", align: "right", render: (e: any) => fmt(e.amount) },
                  ]} />
                </div>
              </TabsContent>

              <TabsContent value="due" className="space-y-3 pt-3">
                <SubHead title={`Outstanding due — ${fmt(s.receivable)}`} onExcel={() => exportToExcel(s.dueRows.map((x: any) => ({ Invoice: x.invoice_no, Business: projectLabel(x.project), Customer: x.owner?.full_name ?? "Walk-in", Phone: x.owner?.phone ?? "", Date: String(x.created_at).slice(0, 10), Due: Number(x.due) })), `due-${pick}`, "Due")} />
                <DataTable rows={s.dueRows} pageSize={12} initialSort={{ key: "due", dir: "desc" }} columns={[
                  { key: "invoice_no", label: "Invoice" },
                  { key: "customer", label: "Customer", value: (x: any) => x.owner?.full_name ?? "Walk-in", render: (x: any) => <>{x.owner?.full_name ?? "Walk-in"}{x.owner?.phone && <span className="block text-xs text-muted-foreground">{x.owner.phone}</span>}</> },
                  { key: "created_at", label: "Date", render: (x: any) => String(x.created_at).slice(0, 10) },
                  { key: "due", label: "Due", align: "right", value: (x: any) => Number(x.due), render: (x: any) => fmt(x.due) },
                ]} />
              </TabsContent>

              <TabsContent value="cash" className="pt-3">
                <MoneyByBusiness title={`Money in / out — ${range.from} to ${range.to}`} fromISO={fromISO} toISO={toISO} fromDay={range.from} toDay={range.to} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SubHead({ title, onExcel }: { title: string; onExcel?: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      {onExcel && <Button variant="outline" size="sm" className="h-7" onClick={onExcel}><FileDown className="h-3.5 w-3.5" /> Excel</Button>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Every number side by side: Pet Care Vet | Sasthya Seba | Total. */
function CompareTable({ cur, snap }: {
  cur: ReturnType<typeof computeByProject>;
  snap: Record<"all" | Project, ReturnType<typeof computeSnapshot>>;
}) {
  const rows: { label: string; get: (c: Computed, k: "all" | Project) => number; pct?: boolean }[] = [
    { label: "Sales (net)", get: (c) => c.sales.netSales },
    { label: "Bills", get: (c) => c.sales.count, pct: false },
    { label: "Cost of goods", get: (c) => c.cogs },
    { label: "Gross profit", get: (c) => c.grossProfit },
    { label: "Expenses", get: (c) => c.opex },
    { label: "Net profit", get: (c) => c.netProfit },
    { label: "Money received", get: (c) => Object.values(c.collected).reduce((a, v) => a + v, 0) },
    { label: "New due (this period)", get: (c) => c.sales.creditSales },
    { label: "Outstanding due (today)", get: (_c, k) => snap[k].receivable },
    { label: "Stock value (cost)", get: (_c, k) => snap[k].stockValue },
  ];
  const isCount = (label: string) => label === "Bills";
  const data = rows.map((r) => ({
    label: r.label,
    pcv: r.get(cur.pcv, "pcv"),
    ss: r.get(cur.ss, "ss"),
    all: r.get(cur.all, "all"),
  }));
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="h-7" onClick={() => exportToExcel(data.map((d) => ({ Item: d.label, "Pet Care Vet": Math.round(d.pcv), "Sasthya Seba": Math.round(d.ss), Total: Math.round(d.all) })), "business-compare", "Compare")}>
          <FileDown className="h-3.5 w-3.5" /> Excel
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              {PROJECTS.map((p) => (
                <th key={p.key} className="px-3 py-2 text-right font-medium">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: p.tone }} />{p.label}</span>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((d) => {
              const share = (v: number) => (d.all !== 0 && !isCount(d.label) ? ` · ${Math.round((v / d.all) * 100)}%` : "");
              const show = (v: number) => (isCount(d.label) ? String(v) : fmt(v));
              return (
                <tr key={d.label} className={d.label === "Net profit" ? "font-semibold" : ""}>
                  <td className="px-3 py-2">{d.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{show(d.pcv)}<span className="text-xs text-muted-foreground">{share(d.pcv)}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{show(d.ss)}<span className="text-xs text-muted-foreground">{share(d.ss)}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{show(d.all)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Clinic belongs to Pet Care Vet. Purchases are stock, not expense, so they are not in profit.</p>
    </div>
  );
}
