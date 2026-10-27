import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, PackageSearch, Printer, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, type Column } from "@/components/report/DataTable";
import { computeProductSales, EMPTY_FILTERS, loadProductSales, METHOD_LABEL, productSalesForBusiness, type Filters } from "@/lib/product-sales";
import { hasProjects } from "@/lib/business-report";
import { PROJECTS, type Project } from "@/lib/projects";
import { exportCsv, exportExcel, printSheet, SHEET_TITLES, type SheetKey } from "@/lib/product-sales-export";
import { monthStartDhaka, todayDhaka } from "@/lib/sales-ledger";
import { shiftDay } from "@/lib/sales-summary";
import { dayRangeISO } from "@/lib/sales-ledger";
import { fetchAll } from "@/lib/fetch-all";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/product-sales")({
  head: () => ({ meta: [{ title: "Product Sales — Pet Care Vet" }] }),
  component: ProductSalesPage,
});

const money = (v: number) => `৳${(Math.round(v * 100) / 100).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const qtyFmt = (v: number) => (Math.round(v * 100) / 100).toLocaleString("en-BD");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const dayLabel = (k: string) =>
  k.length === 7
    ? new Date(`${k}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : new Date(`${k}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

type Preset = "today" | "7d" | "month" | "last_month" | "custom";
function rangeFor(p: Preset): [string, string] {
  const t = todayDhaka();
  if (p === "today") return [t, t];
  if (p === "7d") return [shiftDay(t, -6), t];
  if (p === "last_month") {
    const end = shiftDay(monthStartDhaka(), -1);
    return [`${end.slice(0, 7)}-01`, end];
  }
  return [monthStartDhaka(), t];
}

function ProductSalesPage() {
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState<[string, string]>(rangeFor("month"));
  const [from, to] = preset === "custom" ? custom : rangeFor(preset);
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const [tab, setTab] = useState<SheetKey | "prices">("products");
  const sheet: SheetKey = tab === "prices" ? "products" : tab;
  const [productSort, setProductSort] = useState<"best" | "low">("best");

  const { data, isLoading, error } = useQuery({
    queryKey: ["product-sales", from, to],
    queryFn: () => loadProductSales(from, to),
    enabled: !!from && !!to && from <= to,
    staleTime: 30_000,
  });
  const hasBizQ = useQuery({ queryKey: ["has-projects"], queryFn: hasProjects, staleTime: Infinity });
  const [biz, setBiz] = useState<"all" | Project>("all");
  const v = useMemo(() => (data ? computeProductSales(productSalesForBusiness(data, biz), f) : null), [data, f, biz]);
  const set = (patch: Partial<Filters>) => setF((x) => ({ ...x, ...patch }));
  const filtersOn = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);
  const filterNote = [
    f.product && `Product: ${f.product}`,
    f.category !== "all" && `Category: ${f.category}`,
    f.invoice && `Invoice: ${f.invoice}`,
    f.customer && `Customer: ${f.customer}`,
    f.employee !== "all" && `Employee: ${v?.employeeOptions.find(([id]) => id === f.employee)?.[1] ?? ""}`,
    f.method !== "all" && `Payment: ${METHOD_LABEL[f.method] ?? f.method}`,
  ].filter(Boolean).join(" · ") || "All products";

  const products = useMemo(() => {
    if (!v) return [];
    const list = [...v.products];
    return productSort === "best" ? list.sort((a, b) => b.soldQty - a.soldQty || b.net - a.net) : list.sort((a, b) => a.soldQty - b.soldQty || a.net - b.net);
  }, [v, productSort]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Product Sales"
        description="Every product sale by date, invoice, customer, employee and payment — with cost, profit, returns and money actually received."
        icon={PackageSearch}
        actions={
          v && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm"><FileSpreadsheet className="h-4 w-4" /> Export</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportExcel(v, [sheet], from, to)}>Excel — {SHEET_TITLES[sheet]}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportCsv(v, sheet, from, to)}>CSV — {SHEET_TITLES[sheet]}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportExcel(v, ["products", "lines", "daily", "monthly", "invoices", "employees", "collection"], from, to)}>Excel — all sheets</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={() => printSheet(v, sheet, from, to, filterNote)}><Printer className="h-4 w-4" /> Print</Button>
            </>
          )
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="grid gap-3 p-3 sm:grid-cols-2 sm:p-3 lg:grid-cols-4">
          {hasBizQ.data && (
            <div className="space-y-1">
              <Label className="text-xs">Business</Label>
              <Select value={biz} onValueChange={(x) => setBiz(x === "pcv" || x === "ss" ? x : "all")}>
                <SelectTrigger className="h-9" aria-label="Business"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Both businesses</SelectItem>
                  {PROJECTS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Dates</Label>
            <Select value={preset} onValueChange={(x) => setPreset(x as Preset)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="last_month">Last month</SelectItem>
                <SelectItem value="custom">Custom dates</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" className="h-9" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" className="h-9" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} /></div>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Period</Label>
              <p className="flex h-9 items-center text-sm text-muted-foreground">{from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`}</p>
            </div>
          )}
          <div className="space-y-1"><Label className="text-xs">Product name / SKU</Label><Input className="h-9" value={f.product} onChange={(e) => set({ product: e.target.value })} placeholder="Any product" /></div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={f.category} onValueChange={(x) => set({ category: x })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {(v?.categoryOptions ?? []).map((c) => <SelectItem key={c} value={c} className="capitalize">{c.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Invoice no.</Label><Input className="h-9" value={f.invoice} onChange={(e) => set({ invoice: e.target.value })} placeholder="INV-…" /></div>
          <div className="space-y-1"><Label className="text-xs">Customer name / phone</Label><Input className="h-9" value={f.customer} onChange={(e) => set({ customer: e.target.value })} placeholder="Any customer" /></div>
          <div className="space-y-1">
            <Label className="text-xs">Sales employee</Label>
            <Select value={f.employee} onValueChange={(x) => set({ employee: x })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {(v?.employeeOptions ?? []).map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Payment method</Label>
            <div className="flex gap-2">
              <Select value={f.method} onValueChange={(x) => set({ method: x })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All methods</SelectItem>
                  {Object.entries(METHOD_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
              {filtersOn && <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Clear filters" onClick={() => setF(EMPTY_FILTERS)}><RotateCcw className="h-4 w-4" /></Button>}
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <Card><CardContent className="py-6 text-sm text-destructive sm:py-6">Could not load: {(error as any).message}</CardContent></Card>}
      {isLoading && <Card><CardContent className="py-10 text-center text-muted-foreground sm:py-10">Loading…</CardContent></Card>}

      {v && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Kpi label="Invoices" value={String(v.totals.invoices)} />
            <Kpi label="Qty sold (net)" value={qtyFmt(v.totals.qty - v.totals.returnedQty)} />
            <Kpi label="Net sales" value={money(v.totals.net)} strong />
            <Kpi label="Purchase cost" value={money(v.totals.cost)} />
            <Kpi label="Profit" value={money(v.totals.profit)} strong tone={v.totals.profit < 0 ? "bad" : undefined} />
            <Kpi label="Discount / Returns" value={`${money(v.totals.discount)} / ${money(v.totals.returned)}`} />
            <Kpi label="Received in period" value={money(v.totals.collected)} />
            <Kpi label="Due on these bills" value={money(v.totals.due)} tone={v.totals.due > 0 ? "warn" : undefined} />
          </div>

          <Tabs value={tab} onValueChange={(x) => setTab(x as SheetKey | "prices")}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="products">Products</TabsTrigger>
              <TabsTrigger value="lines">Sales history</TabsTrigger>
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="employees">Employees</TabsTrigger>
              <TabsTrigger value="collection">Collection</TabsTrigger>
              <TabsTrigger value="prices">Price changes</TabsTrigger>
            </TabsList>

            <TabsContent value="products" className="space-y-2">
              <div className="flex gap-2">
                <Button size="sm" variant={productSort === "best" ? "default" : "outline"} onClick={() => setProductSort("best")}>Best-selling</Button>
                <Button size="sm" variant={productSort === "low" ? "default" : "outline"} onClick={() => setProductSort("low")}>Low-selling</Button>
              </div>
              <DataTable
                key={productSort}
                rows={products}
                pageSize={20}
                columns={[
                  { key: "product", label: "Product", render: (p) => <div><div className="font-medium">{p.product}</div><div className="text-xs text-muted-foreground">{[p.sku, p.category.replace(/_/g, " ")].filter(Boolean).join(" · ")}</div></div>, value: (p) => `${p.product} ${p.sku}` },
                  { key: "invoiceCount", label: "Invoices", align: "right" },
                  { key: "soldQty", label: "Qty sold", align: "right", render: (p) => <>{qtyFmt(p.soldQty)}{p.returnedQty > 0 && <span className="block text-xs text-amber-700">{qtyFmt(p.returnedQty)} returned</span>}</> },
                  { key: "avgPrice", label: "Avg price", align: "right", render: (p) => money(p.avgPrice) },
                  { key: "discount", label: "Discount", align: "right", render: (p) => money(p.discount) },
                  { key: "net", label: "Net sales", align: "right", render: (p) => <b>{money(p.net)}</b> },
                  { key: "cost", label: "Cost", align: "right", render: (p) => money(p.cost) },
                  { key: "profit", label: "Profit", align: "right", render: (p) => <span className={p.profit < 0 ? "text-destructive" : ""}>{money(p.profit)}</span> },
                  { key: "margin", label: "Margin", align: "right", render: (p) => `${p.margin.toFixed(1)}%` },
                  { key: "last", label: "Last sold", render: (p) => <span className="whitespace-nowrap text-xs">{when(p.last)}</span> },
                ] as Column<(typeof products)[number]>[]}
              />
            </TabsContent>

            <TabsContent value="lines">
              <DataTable
                rows={v.lines}
                pageSize={25}
                columns={[
                  { key: "date", label: "Date", render: (l) => <span className="whitespace-nowrap text-xs">{when(l.date)}</span> },
                  { key: "invoiceNo", label: "Invoice", render: (l) => <span className="whitespace-nowrap font-mono text-xs">{l.invoiceNo}</span> },
                  { key: "product", label: "Product", render: (l) => <div><div className="font-medium">{l.product}</div>{l.sku && <div className="text-xs text-muted-foreground">{l.sku}</div>}</div> },
                  { key: "qty", label: "Qty", align: "right", render: (l) => <>{qtyFmt(l.qty)}{l.returnedQty > 0 && <span className="block text-xs text-amber-700">−{qtyFmt(l.returnedQty)} ret.</span>}</> },
                  { key: "unitPrice", label: "Price", align: "right", render: (l) => <>{money(l.unitPrice)}{l.priceChanged && l.listPrice != null && <span className="block text-[11px] text-violet-700">was {money(l.listPrice)}</span>}</> },
                  { key: "discount", label: "Discount", align: "right", value: (l) => l.lineDiscount + l.invoiceDiscount, render: (l) => money(l.lineDiscount + l.invoiceDiscount) },
                  { key: "netAfterReturn", label: "Net", align: "right", render: (l) => <b>{money(l.netAfterReturn)}</b> },
                  { key: "cost", label: "Cost", align: "right", render: (l) => money(l.cost) },
                  { key: "profit", label: "Profit", align: "right", render: (l) => <span className={l.profit < 0 ? "text-destructive" : ""}>{money(l.profit)}</span> },
                  { key: "customer", label: "Customer", render: (l) => <div className="text-xs">{l.customer}<div className="text-muted-foreground">{l.customerPhone}</div></div> },
                  { key: "employee", label: "Employee", render: (l) => <span className="text-xs">{l.employee}</span> },
                  { key: "methods", label: "Payment", value: (l) => l.methods.join(","), render: (l) => <div className="flex flex-wrap gap-1">{l.methods.map((m) => <Badge key={m} variant={m === "due" ? "destructive" : "secondary"} className="text-[10px]">{METHOD_LABEL[m] ?? m}</Badge>)}</div> },
                ] as Column<(typeof v.lines)[number]>[]}
              />
            </TabsContent>

            {(["daily", "monthly"] as const).map((k) => (
              <TabsContent key={k} value={k}>
                <DataTable
                  rows={v[k]}
                  pageSize={31}
                  initialSort={{ key: "key", dir: "desc" }}
                  columns={[
                    { key: "key", label: k === "daily" ? "Date" : "Month", render: (d) => dayLabel(d.key) },
                    { key: "invoiceCount", label: "Invoices", align: "right" },
                    { key: "qty", label: "Qty", align: "right", render: (d) => qtyFmt(d.qty) },
                    { key: "discount", label: "Discount", align: "right", render: (d) => money(d.discount) },
                    { key: "returned", label: "Returns", align: "right", render: (d) => money(d.returned) },
                    { key: "net", label: "Net sales", align: "right", render: (d) => <b>{money(d.net)}</b> },
                    { key: "cost", label: "Cost", align: "right", render: (d) => money(d.cost) },
                    { key: "profit", label: "Profit", align: "right", render: (d) => money(d.profit) },
                  ] as Column<(typeof v.daily)[number]>[]}
                />
              </TabsContent>
            ))}

            <TabsContent value="invoices">
              <DataTable
                rows={v.invoices}
                pageSize={25}
                columns={[
                  { key: "date", label: "Date", render: (i) => <span className="whitespace-nowrap text-xs">{when(i.date)}</span> },
                  { key: "invoiceNo", label: "Invoice", render: (i) => <span className="whitespace-nowrap font-mono text-xs">{i.invoiceNo}{i.priceChanged && <Badge variant="outline" className="ml-1 border-violet-300 text-[10px] text-violet-700">price changed</Badge>}</span> },
                  { key: "customer", label: "Customer", render: (i) => <div className="text-xs">{i.customer}<div className="text-muted-foreground">{i.phone}</div></div> },
                  { key: "employee", label: "Employee", render: (i) => <span className="text-xs">{i.employee}</span> },
                  { key: "items", label: "Items", align: "right" },
                  { key: "discount", label: "Discount", align: "right", render: (i) => money(i.discount) },
                  { key: "total", label: "Total", align: "right", render: (i) => <b>{money(i.total)}</b> },
                  { key: "paid", label: "Paid", align: "right", render: (i) => money(i.paid) },
                  { key: "due", label: "Due", align: "right", render: (i) => <span className={i.due > 0 ? "text-destructive" : ""}>{money(i.due)}</span> },
                  { key: "returned", label: "Returns", align: "right", render: (i) => money(i.returned) },
                  { key: "profit", label: "Profit", align: "right", render: (i) => money(i.profit) },
                  { key: "methods", label: "Payment", render: (i) => <span className="text-xs">{i.methods}</span> },
                  { key: "status", label: "Status", render: (i) => <span className="text-xs capitalize">{i.status.replace(/_/g, " ")}</span> },
                ] as Column<(typeof v.invoices)[number]>[]}
              />
            </TabsContent>

            <TabsContent value="employees">
              <DataTable
                rows={v.employees}
                columns={[
                  { key: "employee", label: "Employee", render: (e) => <span className="font-medium">{e.employee}</span> },
                  { key: "invoiceCount", label: "Invoices", align: "right" },
                  { key: "qty", label: "Qty", align: "right", render: (e) => qtyFmt(e.qty) },
                  { key: "discount", label: "Discount", align: "right", render: (e) => money(e.discount) },
                  { key: "net", label: "Net sales", align: "right", render: (e) => <b>{money(e.net)}</b> },
                  { key: "profit", label: "Profit", align: "right", render: (e) => money(e.profit) },
                  { key: "paid", label: "Paid on bills", align: "right", render: (e) => money(e.paid) },
                  { key: "due", label: "Due on bills", align: "right", render: (e) => <span className={e.due > 0 ? "text-destructive" : ""}>{money(e.due)}</span> },
                ] as Column<(typeof v.employees)[number]>[]}
              />
            </TabsContent>

            <TabsContent value="collection" className="space-y-4">
              <p className="text-xs text-muted-foreground">Money actually received in these dates (by payment date), including due collected for older invoices. Each payment is spread over the invoice&apos;s lines by their value. Refunds show as minus.</p>
              <div className="grid gap-4 lg:grid-cols-2">
                <DataTable
                  rows={v.collByProduct}
                  columns={[
                    { key: "product", label: "Product", render: (r) => <span className="font-medium">{r.product}</span> },
                    { key: "cash", label: "Cash", align: "right", render: (r) => money(r.cash) },
                    { key: "bkash", label: "bKash", align: "right", render: (r) => money(r.bkash) },
                    { key: "nagad", label: "Nagad", align: "right", render: (r) => money(r.nagad) },
                    { key: "bank", label: "Bank / card", align: "right", value: (r) => r.bank + r.card + r.rocket, render: (r) => money(r.bank + r.card + r.rocket) },
                    { key: "refunds", label: "Refunds", align: "right", render: (r) => money(r.refunds) },
                    { key: "total", label: "Received", align: "right", render: (r) => <b>{money(r.total)}</b> },
                  ] as Column<(typeof v.collByProduct)[number]>[]}
                />
                <DataTable
                  rows={v.collByDay}
                  initialSort={{ key: "key", dir: "desc" }}
                  columns={[
                    { key: "key", label: "Date", render: (r) => dayLabel(r.key) },
                    ...(["cash", "bkash", "nagad", "bank"] as const).map((m) => ({ key: m, label: METHOD_LABEL[m], align: "right" as const, value: (r: any) => r.byMethod[m] ?? 0, render: (r: any) => money(r.byMethod[m] ?? 0) })),
                    { key: "total", label: "Received", align: "right", render: (r) => <b>{money(r.total)}</b> },
                  ] as Column<(typeof v.collByDay)[number]>[]}
                />
              </div>
              <DataTable
                rows={v.collections}
                pageSize={25}
                columns={[
                  { key: "date", label: "Received on", render: (c) => <span className="whitespace-nowrap text-xs">{when(c.date)}</span> },
                  { key: "method", label: "Method", render: (c) => <Badge variant="secondary" className="text-[10px]">{METHOD_LABEL[c.method] ?? c.method}</Badge> },
                  { key: "amount", label: "Amount", align: "right", render: (c) => <span className={c.amount < 0 ? "text-destructive" : "font-medium"}>{money(c.amount)}</span> },
                  { key: "invoiceNo", label: "Invoice", render: (c) => <span className="font-mono text-xs">{c.invoiceNo}</span> },
                  { key: "invoiceDate", label: "Invoice date", render: (c) => <span className="whitespace-nowrap text-xs">{when(c.invoiceDate)}</span> },
                  { key: "product", label: "Product" },
                  { key: "customer", label: "Customer", render: (c) => <span className="text-xs">{c.customer}</span> },
                  { key: "employee", label: "Employee", render: (c) => <span className="text-xs">{c.employee}</span> },
                ] as Column<(typeof v.collections)[number]>[]}
              />
            </TabsContent>
            <TabsContent value="prices">
              <PriceChanges from={from} to={to} />
            </TabsContent>
          </Tabs>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Net sales = price × qty − line and bill discount − returns. Cost uses the purchase price saved on each invoice line, so later price changes never alter old invoices.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "warn" | "bad" }) {
  return (
    <Card className={tone === "warn" ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20" : ""}>
      <CardContent className="p-3 sm:p-3">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={`truncate tabular-nums ${strong ? "text-lg font-bold" : "text-base font-semibold"} ${tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function PriceChanges({ from, to }: { from: string; to: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["price-override-log", from, to],
    queryFn: async () => {
      const { fromISO, toISO } = dayRangeISO(from, to);
      const [log, profiles] = await Promise.all([
        fetchAll<any>(() => (supabase as any).from("price_override_log").select("*").gte("created_at", fromISO).lte("created_at", toISO).order("created_at", { ascending: false }).order("id")),
        (supabase as any).from("profiles").select("id,full_name").then((r: any) => (r.data ?? []) as { id: string; full_name: string | null }[]),
      ]);
      const names = new Map<string, string>((profiles as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || "Staff"]));
      return log.map((x: any) => ({ ...x, who: x.changed_by ? names.get(x.changed_by) ?? "Staff" : "—" }));
    },
  });
  if (error) return <p className="text-sm text-muted-foreground">Price change log is not set up yet — run the B2B SQL update.</p>;
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <DataTable
      rows={data ?? []}
      pageSize={25}
      empty="No price was changed in these dates."
      columns={[
        { key: "created_at", label: "When", render: (x: any) => <span className="whitespace-nowrap text-xs">{when(x.created_at)}</span> },
        { key: "invoice_no", label: "Invoice", render: (x: any) => <span className="font-mono text-xs">{x.invoice_no}</span> },
        { key: "product_name", label: "Product" },
        { key: "customer_type", label: "Customer", render: (x: any) => <span className="text-xs uppercase">{x.customer_type ?? ""}</span> },
        { key: "quantity", label: "Qty", align: "right", value: (x: any) => Number(x.quantity) },
        { key: "old_price", label: "Old price", align: "right", value: (x: any) => Number(x.old_price), render: (x: any) => money(Number(x.old_price)) },
        { key: "new_price", label: "New price", align: "right", value: (x: any) => Number(x.new_price), render: (x: any) => <b className={x.below_min ? "text-destructive" : ""}>{money(Number(x.new_price))}</b> },
        { key: "min_price", label: "Minimum", align: "right", value: (x: any) => Number(x.min_price ?? 0), render: (x: any) => (x.min_price != null ? money(Number(x.min_price)) : "—") },
        { key: "who", label: "Changed by" },
      ] as Column<any>[]}
    />
  );
}
