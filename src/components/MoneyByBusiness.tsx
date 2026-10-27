// Where the money came from: one drawer, but every payment belongs to a bill
// and every bill to a business, so in / out can be split by business.
//  - Sales:         payments on bills made inside the period
//  - Due collected: payments on older bills
//  - Refunds:       money given back (negative payments)
//  - Expenses:      by business, or Shared
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { hasProjects, isPurchaseExpense } from "@/lib/business-report";
import { PROJECTS, type Project } from "@/lib/projects";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const db = supabase as any;
const n = (v: unknown) => Number(v) || 0;
const MOBILE = new Set(["bkash", "nagad", "rocket"]);
const col = (m: string) => (m === "cash" ? "cash" : MOBILE.has(m) ? "mobile" : "bank");
const money = (v: number) => `৳ ${Math.round(v).toLocaleString("en-IN")}`;

type Cols = { cash: number; mobile: number; bank: number };
type Row = { key: string; label: string; tone?: string; sign: 1 | -1; v: Cols };
const empty = (): Cols => ({ cash: 0, mobile: 0, bank: 0 });
const total = (c: Cols) => c.cash + c.mobile + c.bank;

export async function loadMoneyByBusiness(fromISO: string, toISO: string, fromDay?: string, toDay?: string) {
  const [payments, expenses] = await Promise.all([
    fetchAll<any>(() => db.from("payments").select("id,amount,method,received_at,sale_id, sales(project,created_at,status)")
      .gte("received_at", fromISO).lte("received_at", toISO).order("id")),
    // Shift: expenses entered during it. Date range: by expense date.
    fetchAll<any>(() => {
      const q = db.from("expenses").select("id,amount,method,category,purchase_invoice_id,project,created_at,expense_date");
      return (fromDay && toDay ? q.gte("expense_date", fromDay).lte("expense_date", toDay) : q.gte("created_at", fromISO).lte("created_at", toISO)).order("id");
    }),
  ]);
  const rows = new Map<string, Row>();
  const row = (key: string, label: string, sign: 1 | -1, tone?: string) => {
    let r = rows.get(key);
    if (!r) { r = { key, label, sign, tone, v: empty() }; rows.set(key, r); }
    return r;
  };
  for (const pr of PROJECTS) {
    row(`${pr.key}-sale`, `${pr.label} — sales`, 1, pr.tone);
    row(`${pr.key}-due`, `${pr.label} — due collected`, 1, pr.tone);
  }
  for (const p of payments) {
    if (p.sales?.status === "void") continue;
    const proj: Project = p.sales?.project === "ss" ? "ss" : "pcv";
    const label = PROJECTS.find((x) => x.key === proj)!;
    const a = n(p.amount);
    if (a < 0) { row(`${proj}-refund`, `${label.label} — refunds`, -1, label.tone).v[col(p.method)] += -a; continue; }
    const older = p.sales?.created_at && p.sales.created_at < fromISO;
    row(`${proj}-${older ? "due" : "sale"}`, "", 1).v[col(p.method)] += a;
  }
  for (const e of expenses) {
    if (isPurchaseExpense(e)) continue;
    const proj = e.project === "ss" || e.project === "pcv" ? e.project : null;
    const pr = PROJECTS.find((x) => x.key === proj);
    row(`exp-${proj ?? "shared"}`, `Expenses — ${pr?.label ?? "Shared"}`, -1, pr?.tone).v[col(e.method ?? "cash")] += n(e.amount);
  }
  const order = ["pcv-sale", "pcv-due", "pcv-refund", "ss-sale", "ss-due", "ss-refund", "exp-pcv", "exp-ss", "exp-shared"];
  const list = order.map((k) => rows.get(k)).filter((r): r is Row => !!r && (total(r.v) > 0.004 || r.key.endsWith("-sale")));
  const net = list.reduce((c, r) => ({ cash: c.cash + r.sign * r.v.cash, mobile: c.mobile + r.sign * r.v.mobile, bank: c.bank + r.sign * r.v.bank }), empty());
  const inBy = (k: Project) => list.filter((r) => r.key.startsWith(`${k}-`)).reduce((t, r) => t + r.sign * total(r.v), 0);
  return { rows: list, net, inBy: { pcv: inBy("pcv"), ss: inBy("ss") } };
}

export function MoneyByBusiness({ fromISO, toISO, fromDay, toDay, title = "Money by business" }: {
  fromISO: string; toISO: string; fromDay?: string; toDay?: string; title?: string;
}) {
  const { data: enabled } = useQuery({ queryKey: ["has-projects"], queryFn: hasProjects, staleTime: Infinity });
  const { data } = useQuery({
    queryKey: ["money-by-business", fromISO, toISO, fromDay, toDay],
    enabled: !!enabled,
    queryFn: () => loadMoneyByBusiness(fromISO, toISO, fromDay, toDay),
  });
  if (!enabled || !data) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From / to</TableHead>
              <TableHead className="text-right">Cash</TableHead>
              <TableHead className="text-right">bKash / Nagad</TableHead>
              <TableHead className="text-right">Bank / Card</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.tone ?? "var(--muted-foreground)" }} />
                    {r.label}
                  </span>
                </TableCell>
                {(["cash", "mobile", "bank"] as const).map((k) => (
                  <TableCell key={k} className={`text-right tabular-nums ${r.sign < 0 && r.v[k] > 0 ? "text-destructive" : ""}`}>
                    {r.v[k] > 0.004 ? `${r.sign < 0 ? "−" : ""}${money(r.v[k])}` : "—"}
                  </TableCell>
                ))}
                <TableCell className={`text-right font-medium tabular-nums ${r.sign < 0 ? "text-destructive" : ""}`}>
                  {r.sign < 0 ? "−" : ""}{money(total(r.v))}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell>Net</TableCell>
              <TableCell className="text-right tabular-nums">{money(data.net.cash)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(data.net.mobile)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(data.net.bank)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(total(data.net))}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="px-4 py-2 text-xs text-muted-foreground">
          Supplier payments and manual cash in / out are not tied to a business — see the drawer summary above.
        </p>
      </CardContent>
    </Card>
  );
}
