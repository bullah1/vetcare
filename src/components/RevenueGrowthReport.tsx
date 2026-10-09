import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type DayRow = { rev: number; cogs: number; purch: number; opex: number };

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const toDate = (day: string) => new Date(`${day}T00:00:00`);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Monday of the week containing `d`. */
function mondayOf(d: Date) {
  const m = new Date(d);
  m.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  m.setHours(0, 0, 0, 0);
  return m;
}

/** True ISO week label (2026-W36), week starts Monday. */
function weekKey(day: string) {
  const monday = mondayOf(toDate(day));
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3); // ISO: the week belongs to its Thursday's year
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstMonday = mondayOf(firstThursday);
  const week = Math.round((monday.getTime() - firstMonday.getTime()) / 604_800_000) + 1;
  return `${thursday.getFullYear()}-W${String(week).padStart(2, "0")} (${monday.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })})`;
}

const monthKey = (day: string) =>
  toDate(day).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

/**
 * Every metric here is derived from the SAME day rows the P&L table uses, over
 * the SAME selected date range. Days with no activity are zero-filled so
 * "Avg per day" divides by the real number of calendar days in the range (not
 * only the days that happened to have a sale) and day-over-day growth always
 * compares genuinely consecutive days.
 */
export function RevenueGrowthReport({
  daily,
  from,
  to,
}: {
  daily: [string, DayRow][];
  from?: string;
  to?: string;
}) {
  const [grain, setGrain] = useState<"day" | "week" | "month">("day");

  // Continuous day series across the selected range (zero-filled).
  const days = useMemo(() => {
    const src = new Map(daily);
    const keys = daily.map(([d]) => d).sort();
    const start = from || keys[0];
    const end = to || keys[keys.length - 1];
    if (!start || !end) return [] as [string, DayRow][];
    const out: [string, DayRow][] = [];
    const cur = toDate(start);
    const last = toDate(end);
    for (let i = 0; cur <= last && i < 1500; i++) {
      const k = iso(cur);
      out.push([k, src.get(k) ?? { rev: 0, cogs: 0, purch: 0, opex: 0 }]);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [daily, from, to]);

  const rows = useMemo(() => {
    const bucket = grain === "day" ? (d: string) => d : grain === "week" ? weekKey : monthKey;
    const m = new Map<string, { sort: string; rev: number; cogs: number; opex: number }>();
    days.forEach(([day, v]) => {
      const k = bucket(day);
      const cur = m.get(k) ?? { sort: day, rev: 0, cogs: 0, opex: 0 };
      cur.rev += v.rev;
      cur.cogs += v.cogs;
      cur.opex += v.opex;
      if (day < cur.sort) cur.sort = day;
      m.set(k, cur);
    });
    // oldest first so growth compares against the immediately previous period
    const asc = Array.from(m.entries()).sort((a, b) => a[1].sort.localeCompare(b[1].sort));
    const totalRev = asc.reduce((a, [, v]) => a + v.rev, 0);
    const list = asc.map(([period, v], i) => {
      const prev = i > 0 ? asc[i - 1][1].rev : null;
      const growth = prev !== null && prev > 0 ? ((v.rev - prev) / prev) * 100 : null;
      const gross = v.rev - v.cogs;
      const net = gross - v.opex;
      return {
        period,
        rev: v.rev,
        growth,
        share: totalRev > 0 ? (v.rev / totalRev) * 100 : 0,
        margin: v.rev > 0 ? (gross / v.rev) * 100 : 0,
        netMargin: v.rev > 0 ? (net / v.rev) * 100 : 0,
      };
    });
    return { asc: list, list: [...list].reverse(), totalRev, count: list.length };
  }, [days, grain]);

  const label = grain === "day" ? "Day" : grain === "week" ? "Week" : "Month";

  const stats = useMemo(() => {
    const { asc, totalRev, count } = rows;
    // Avg per period = total revenue / number of periods in the selected range.
    const avg = count > 0 ? totalRev / count : 0;

    // Trend growth uses a compound (geometric) rate between the first and last
    // period that actually has revenue — an arithmetic mean of period-over-period
    // percentages is dominated by rebounds from near-zero days (that was the
    // wildly optimistic "+135.7%") and is not an accounting-valid growth rate.
    const firstIdx = asc.findIndex((r) => r.rev > 0);
    let lastIdx = -1;
    for (let i = asc.length - 1; i >= 0; i--) if (asc[i].rev > 0) { lastIdx = i; break; }
    const steps = firstIdx >= 0 && lastIdx > firstIdx ? lastIdx - firstIdx : 0;
    const trend =
      steps > 0 ? (Math.pow(asc[lastIdx].rev / asc[firstIdx].rev, 1 / steps) - 1) * 100 : null;

    // Median period-over-period change: a robust "typical" movement.
    const gs = asc.map((r) => r.growth).filter((g): g is number => g !== null).sort((a, b) => a - b);
    const median = gs.length
      ? gs.length % 2
        ? gs[(gs.length - 1) / 2]
        : (gs[gs.length / 2 - 1] + gs[gs.length / 2]) / 2
      : null;

    const best = asc.reduce<null | (typeof asc)[number]>((a, r) => (!a || r.rev > a.rev ? r : a), null);
    const active = asc.filter((r) => r.rev !== 0).length;
    return { avg, trend, median, best: best && best.rev > 0 ? best : null, active };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Total revenue</div><div className="text-lg font-semibold sm:text-2xl">{fmt(rows.totalRev)}</div><div className="mt-1 text-[11px] text-muted-foreground">selected range (net of refunds)</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Avg per {label.toLowerCase()}</div><div className="text-lg font-semibold sm:text-2xl">{fmt(stats.avg)}</div><div className="mt-1 text-[11px] text-muted-foreground">{rows.count} {label.toLowerCase()}{rows.count === 1 ? "" : "s"} in range · {stats.active} with activity</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Trend / {label.toLowerCase()}</div><div className={`text-lg font-semibold sm:text-2xl ${(stats.trend ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}>{stats.trend === null ? "—" : pct(stats.trend)}</div><div className="mt-1 text-[11px] text-muted-foreground">compound rate, first → last active {label.toLowerCase()}</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground">Best {label.toLowerCase()}</div><div className="text-lg font-semibold sm:text-2xl">{stats.best ? fmt(stats.best.rev) : "—"}</div><div className="mt-1 truncate text-[11px] text-muted-foreground">{stats.best?.period ?? "no revenue in range"}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Revenue growth — {label}ly</CardTitle>
          <Tabs value={grain} onValueChange={(v) => setGrain(v as "day" | "week" | "month")}>
            <TabsList>
              <TabsTrigger value="day">Daily</TabsTrigger>
              <TabsTrigger value="week">Weekly</TabsTrigger>
              <TabsTrigger value="month">Monthly</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{label}</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Growth %</TableHead>
              <TableHead className="text-right">Share of total</TableHead>
              <TableHead className="text-right">Gross margin</TableHead>
              <TableHead className="text-right">Net margin</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.list.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No data in range</TableCell></TableRow>
              )}
              {rows.list.map((r) => (
                <TableRow key={r.period}>
                  <TableCell className="whitespace-nowrap">{r.period}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.rev)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.growth === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 font-medium ${r.growth > 0 ? "text-emerald-600" : r.growth < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {r.growth > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : r.growth < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                        {pct(r.growth)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, r.share))}%` }} />
                      </div>
                      <span className="tabular-nums">{r.share.toFixed(1)}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.rev > 0 ? `${r.margin.toFixed(1)}%` : "—"}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.netMargin >= 0 ? "text-emerald-600" : "text-destructive"}`}>{r.rev > 0 ? `${r.netMargin.toFixed(1)}%` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Revenue = invoice sales − refund (P&L-এর মতোই)। Growth % = ঠিক আগের {label.toLowerCase()}-এর তুলনায় পরিবর্তন; আগের {label.toLowerCase()} ০ হলে "—"।
            Avg per {label.toLowerCase()} = মোট revenue ÷ রেঞ্জের সব {label.toLowerCase()} (বিক্রি না হওয়া দিনও গোনা হয়)।
            Trend = প্রথম থেকে শেষ active {label.toLowerCase()} পর্যন্ত compound growth rate, তাই একদিনের লাফ হিসাব ফুলিয়ে দেয় না।
            Median move = {stats.median === null ? "—" : pct(stats.median)}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
