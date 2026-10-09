import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchCustomerMix } from "@/lib/customer-mix";
import { exportToExcel } from "@/lib/export-excel";

const money = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

export function CustomerMixReport({ from, to }: { from: string; to: string }) {
  const [grain, setGrain] = useState<"day" | "month">("day");
  const fromISO = new Date(`${from}T00:00:00`).toISOString();
  const toISO = new Date(`${to}T23:59:59.999`).toISOString();

  const { data, isLoading } = useQuery({
    queryKey: ["customer-mix-report", fromISO, toISO],
    queryFn: () => fetchCustomerMix(fromISO, toISO),
  });

  const periods = (grain === "day" ? data?.daily : data?.monthly) ?? [];
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Total Customers</div><div className="text-lg font-semibold sm:text-2xl">{data?.total ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">New Customers</div><div className="text-lg font-semibold text-emerald-600 sm:text-2xl">{data?.newCustomers ?? 0}</div><div className="mt-1 text-[11px] text-muted-foreground">{money(data?.newAmount ?? 0)}</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Repeat Customers</div><div className="text-lg font-semibold sm:text-2xl">{data?.repeatCustomers ?? 0}</div><div className="mt-1 text-[11px] text-muted-foreground">{money(data?.repeatAmount ?? 0)}</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Repeat Rate</div><div className="text-lg font-semibold sm:text-2xl">{(data?.repeatRate ?? 0).toFixed(1)}%</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Gender-wise repeat analysis</CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={(data?.byGender ?? []).length === 0}
            onClick={() =>
              exportToExcel(
                (data?.byGender ?? []).map((g) => ({
                  Gender: g.gender,
                  "Total customers": g.total,
                  New: g.newCustomers,
                  Repeat: g.repeatCustomers,
                  "Repeat rate %": Number(g.repeatRate.toFixed(1)),
                  Sales: Math.round(g.amount),
                })),
                "gender-repeat",
                "Gender repeat",
              )
            }
          >
            <Download className="h-4 w-4" /> Excel
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(data?.byGender ?? []).map((g) => (
              <div key={g.gender} className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{g.gender === "unknown" ? "Not set" : g.gender}</div>
                <div className="mt-1 text-2xl font-semibold">{g.repeatRate.toFixed(1)}%</div>
                <div className="text-[11px] text-muted-foreground">repeat rate</div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, g.repeatRate)}%` }} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
                  <div><div className="font-semibold text-foreground">{g.total}</div>total</div>
                  <div><div className="font-semibold text-emerald-600">{g.newCustomers}</div>new</div>
                  <div><div className="font-semibold text-foreground">{g.repeatCustomers}</div>repeat</div>
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">{money(g.amount)}</div>
              </div>
            ))}
            {(data?.byGender ?? []).length === 0 && (
              <div className="col-span-full py-6 text-center text-sm text-muted-foreground">{isLoading ? "Loading…" : "No customer sales in range"}</div>
            )}
          </div>
          {(() => {
            const male = data?.byGender.find((g) => g.gender === "male");
            const female = data?.byGender.find((g) => g.gender === "female");
            if (!male?.total || !female?.total) return null;
            const diff = Math.abs(male.repeatRate - female.repeatRate).toFixed(1);
            const winner = male.repeatRate === female.repeatRate ? null : male.repeatRate > female.repeatRate ? "Male" : "Female";
            return (
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                {winner
                  ? <>👥 <strong>{winner}</strong> customers repeat more — {winner === "Male" ? male.repeatRate.toFixed(1) : female.repeatRate.toFixed(1)}% vs {winner === "Male" ? female.repeatRate.toFixed(1) : male.repeatRate.toFixed(1)}% ({diff}% higher).</>
                  : <>Male and female repeat rates are equal ({male.repeatRate.toFixed(1)}%).</>}
              </div>
            );
          })()}
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">New vs Repeat — {grain === "day" ? "Daily" : "Monthly"}</CardTitle>
          <div className="flex items-center gap-2">
            <Tabs value={grain} onValueChange={(v) => setGrain(v as "day" | "month")}>
              <TabsList>
                <TabsTrigger value="day">Daily</TabsTrigger>
                <TabsTrigger value="month">Monthly</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              size="sm"
              variant="outline"
              disabled={periods.length === 0}
              onClick={() =>
                exportToExcel(
                  periods.map((p) => ({
                    Period: p.period,
                    "Total customers": p.total,
                    New: p.newCustomers,
                    Repeat: p.repeatCustomers,
                    "Repeat rate %": Number(p.repeatRate.toFixed(1)),
                    "New sales": Math.round(p.newAmount),
                    "Repeat sales": Math.round(p.repeatAmount),
                  })),
                  `new-vs-repeat-${grain}`,
                  "New vs Repeat",
                )
              }
            >
              <Download className="h-4 w-4" /> Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{grain === "day" ? "Date" : "Month"}</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">New</TableHead>
              <TableHead className="text-right">Repeat</TableHead>
              <TableHead className="text-right">Repeat rate</TableHead>
              <TableHead className="text-right">New sales</TableHead>
              <TableHead className="text-right">Repeat sales</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {periods.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{isLoading ? "Loading…" : "No customer sales in range"}</TableCell></TableRow>
              )}
              {periods.map((p) => (
                <TableRow key={p.period}>
                  <TableCell>{p.period}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.total}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600">{p.newCustomers}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.repeatCustomers}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.repeatRate.toFixed(1)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.newAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.repeatAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Customer detail ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>First purchase</TableHead>
              <TableHead>Last purchase</TableHead>
              <TableHead className="text-right">Orders (range)</TableHead>
              <TableHead className="text-right">Spent (range)</TableHead>
              <TableHead className="text-right">Lifetime</TableHead>
              <TableHead className="text-right">Gap</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No customers in range</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <Button variant="link" className="h-auto p-0" asChild>
                      <Link to="/customers/$id" params={{ id: r.ownerId }}>{r.name}</Link>
                    </Button>
                    <div className="text-xs text-muted-foreground">{r.phone ?? "—"}</div>
                  </TableCell>
                  <TableCell className="capitalize">{r.gender === "unknown" ? "—" : r.gender}</TableCell>
                  <TableCell><Badge variant={r.type === "new" ? "default" : "secondary"}>{r.type}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">{r.firstPurchase ? format(new Date(r.firstPurchase), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.lastPurchase ? format(new Date(r.lastPurchase), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.ordersInRange}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.amountInRange)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.lifetimeOrders} · {money(r.lifetimeAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.gapDays === null ? "—" : `${r.gapDays}d`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
