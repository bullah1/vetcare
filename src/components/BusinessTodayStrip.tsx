// Dashboard strip: today's and this month's sales, profit and due of each
// business, with a link to the Analysis page. Hidden until the Projects SQL.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { computeByProject, computeSnapshot, hasProjects, loadPeriod, loadSnapshot, snapshotForProject } from "@/lib/business-report";
import { monthStartDhaka, todayDhaka } from "@/lib/sales-ledger";
import { PROJECTS } from "@/lib/projects";
import { useAuth } from "@/lib/auth-context";

const money = (v: number) => { const x = Math.round(Number(v) || 0); return `${x < 0 ? "−" : ""}৳${Math.abs(x).toLocaleString("en-IN")}`; };

export function BusinessTodayStrip() {
  // Profit and due are for owners / managers: same access as the Analysis page.
  const { can } = useAuth();
  const allowed = can("analysis");
  const enabledQ = useQuery({ queryKey: ["has-projects"], queryFn: hasProjects, staleTime: Infinity, enabled: allowed });
  const t = todayDhaka();
  const m = monthStartDhaka();
  const on = allowed && !!enabledQ.data;
  const todayQ = useQuery({ queryKey: ["business-report", t, t], queryFn: () => loadPeriod({ from: t, to: t }), enabled: on, staleTime: 60_000 });
  const monthQ = useQuery({ queryKey: ["business-report", m, t], queryFn: () => loadPeriod({ from: m, to: t }), enabled: on, staleTime: 60_000 });
  const snapQ = useQuery({ queryKey: ["business-snapshot"], queryFn: loadSnapshot, enabled: on, staleTime: 60_000 });
  const today = useMemo(() => (todayQ.data ? computeByProject(todayQ.data) : null), [todayQ.data]);
  const month = useMemo(() => (monthQ.data ? computeByProject(monthQ.data) : null), [monthQ.data]);
  const due = useMemo(() => {
    if (!snapQ.data) return null;
    return {
      pcv: computeSnapshot(snapshotForProject(snapQ.data, "pcv")).receivable,
      ss: computeSnapshot(snapshotForProject(snapQ.data, "ss")).receivable,
    };
  }, [snapQ.data]);
  if (!on || !today || !month) return null;

  const cards = [
    ...PROJECTS.map((p) => ({ key: p.key, label: p.label, tone: p.tone, d: today[p.key], mo: month[p.key], due: due?.[p.key] ?? 0 })),
    { key: "all", label: "Total", tone: "#475569", d: today.all, mo: month.all, due: (due?.pcv ?? 0) + (due?.ss ?? 0) },
  ];
  return (
    <section aria-label="Businesses" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Businesses</h2>
        <Link to="/analysis" className="text-xs font-medium text-primary hover:underline">Open Analysis</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.key} to="/analysis" className="rounded-2xl border bg-card p-4 transition-shadow hover:shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.tone }} />
              {c.label}
            </div>
            <div className="text-2xl font-bold tabular-nums tracking-tight">{money(c.d.sales.netSales)}</div>
            <div className="text-xs text-muted-foreground">sales today · {c.d.sales.count} bill{c.d.sales.count === 1 ? "" : "s"}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-2 text-xs">
              <div><div className="text-muted-foreground">Month</div><div className="font-semibold tabular-nums">{money(c.mo.sales.netSales)}</div></div>
              <div><div className="text-muted-foreground">Profit</div><div className={`font-semibold tabular-nums ${c.mo.netProfit < 0 ? "text-destructive" : "text-emerald-700"}`}>{money(c.mo.netProfit)}</div></div>
              <div><div className="text-muted-foreground">Due</div><div className={`font-semibold tabular-nums ${c.due > 0 ? "text-amber-700" : ""}`}>{money(c.due)}</div></div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
