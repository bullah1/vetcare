import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scale, Printer, ChevronRight, ChevronDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { getClinic } from "@/lib/clinic-settings";

export const Route = createFileRoute("/_authenticated/reconciliation")({
  head: () => ({
    meta: [
      { title: "Cash Drawer Reconciliation — Pet Care Vet" },
      { name: "description", content: "Shift-by-shift drawer reconciliation: opening balance, cash sales, due collections, expenses and closing difference report." },
      { property: "og:title", content: "Cash Drawer Reconciliation — Pet Care Vet" },
      { property: "og:description", content: "Shift-by-shift drawer reconciliation: opening balance, cash sales, due collections, expenses and closing difference report." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReconciliationPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const money = (n: number) =>
  `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (v: unknown) => Number(v || 0);

type Shift = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_balance: number;
  counted_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  status: string;
  opening_notes: string | null;
  closing_notes: string | null;
};

type Mov = {
  id: string;
  shift_id: string | null;
  source_id: string | null;
  direction: string;
  amount: number;
  source: string;
  method: string;
  reference: string | null;
  note: string | null;
  occurred_at: string;
};

/** One reconciliation row: everything that moved the drawer inside a shift. */
type Row = {
  shift: Shift;
  opening: number;
  cashSales: number;
  dueCollections: number;
  manualIn: number;
  refunds: number;
  expenses: number;
  supplierPayments: number;
  manualOut: number;
  totalIn: number;
  totalOut: number;
  expected: number;
  counted: number | null;
  difference: number | null;
  movements: Mov[];
};

/**
 * Mirrors public.cash_shift_summary exactly so this screen can never disagree
 * with the closing report: cash-only movements, attached either by shift_id or
 * by falling inside the shift window, and a sale payment counts as a "due
 * collection" when its invoice was created before the shift opened.
 * Cash taken and returned for CANCELLED (void) invoices is kept out of sales and
 * refunds — it nets to zero in the drawer and would otherwise inflate both lines.
 */
function buildRows(
  shifts: Shift[],
  movements: Mov[],
  /** payment id -> parent invoice created_at */
  paymentSaleDate: Map<string, string>,
  /** payment id -> parent invoice status */
  paymentSaleStatus: Map<string, string>,
): Row[] {
  return shifts.map((shift) => {
    const end = shift.closed_at ?? new Date().toISOString();
    const movs = movements
      .filter(
        (m) =>
          m.method === "cash" &&
          (m.shift_id === shift.id ||
            (m.shift_id == null && m.occurred_at >= shift.opened_at && m.occurred_at <= end)),
      )
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

    const total = (list: Mov[]) => list.reduce((s, m) => s + n(m.amount), 0);
    const isDue = (m: Mov) => {
      const saleAt = m.source_id ? paymentSaleDate.get(m.source_id) : undefined;
      return !!saleAt && saleAt < shift.opened_at;
    };
    const isVoid = (m: Mov) =>
      m.source !== "manual" && !!m.source_id && paymentSaleStatus.get(m.source_id) === "void";

    const saleIn = movs.filter((m) => m.source === "sale" && m.direction === "in" && !isVoid(m));
    const cashSales = total(saleIn.filter((m) => !isDue(m)));
    const dueCollections = total(saleIn.filter(isDue));
    const manualIn = total(movs.filter((m) => m.source === "manual" && m.direction === "in"));
    const refunds = total(
      movs.filter((m) => (m.source === "refund" || (m.source === "sale" && m.direction === "out")) && !isVoid(m)),
    );
    const cancelledIn = total(movs.filter((m) => isVoid(m) && m.direction === "in"));
    const cancelledOut = total(movs.filter((m) => isVoid(m) && m.direction === "out"));
    const expenses = total(movs.filter((m) => m.source === "expense"));
    const supplierPayments = total(movs.filter((m) => m.source === "supplier_payment"));
    const manualOut = total(movs.filter((m) => m.source === "manual" && m.direction === "out"));

    const opening = n(shift.opening_balance);
    const totalIn = cashSales + dueCollections + manualIn + cancelledIn;
    const totalOut = refunds + expenses + supplierPayments + manualOut + cancelledOut;
    const expected = opening + totalIn - totalOut;

    const counted = shift.counted_cash == null ? null : n(shift.counted_cash);

    return {
      shift,
      opening,
      cashSales,
      dueCollections,
      manualIn,
      refunds,
      expenses,
      supplierPayments,
      manualOut,
      totalIn,
      totalOut,
      expected,
      counted,
      difference: counted == null ? null : counted - expected,
      movements: movs,
    };
  });
}

function ReconciliationPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [diffFilter, setDiffFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);

  const shiftsQ = useQuery({
    queryKey: ["recon", "shifts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_shifts")
        .select("id,opened_at,closed_at,opening_balance,counted_cash,expected_cash,variance,status,opening_notes,closing_notes")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
  });

  const movsQ = useQuery({
    queryKey: ["recon", "movements"],
    queryFn: async () =>
      await fetchAll<Mov>(() =>
        supabase
          .from("cash_movements")
          .select("id,shift_id,source_id,direction,amount,source,method,reference,note,occurred_at")
          .order("occurred_at", { ascending: true }),
      ),
  });

  // Sale payments whose invoice predates the shift are "due collections", so the
  // payment -> invoice date link is part of the reconciliation input.
  const linkQ = useQuery({
    queryKey: ["recon", "payment-sale-dates"],
    queryFn: async () => {
      const [pays, sales] = await Promise.all([
        fetchAll<{ id: string; sale_id: string | null }>(() =>
          supabase.from("payments").select("id,sale_id"),
        ),
        fetchAll<{ id: string; created_at: string; status: string }>(() =>
          supabase.from("sales").select("id,created_at,status"),
        ),
      ]);
      const saleAt = new Map(sales.map((s) => [s.id, s.created_at]));
      const saleStatus = new Map(sales.map((s) => [s.id, String(s.status)]));
      const map = new Map<string, string>();
      const statusMap = new Map<string, string>();
      for (const p of pays) {
        if (!p.sale_id) continue;
        const at = saleAt.get(p.sale_id);
        if (at) map.set(p.id, at);
        const st = saleStatus.get(p.sale_id);
        if (st) statusMap.set(p.id, st);
      }
      return { map, statusMap };
    },
  });

  const rows = useMemo(
    () =>
      buildRows(
        shiftsQ.data ?? [],
        movsQ.data ?? [],
        linkQ.data?.map ?? new Map(),
        linkQ.data?.statusMap ?? new Map(),
      ),
    [shiftsQ.data, movsQ.data, linkQ.data],
  );


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.shift.status !== statusFilter) return false;
      if (diffFilter === "mismatch" && !(r.difference != null && Math.abs(r.difference) > 0.009)) return false;
      if (diffFilter === "short" && !(r.difference != null && r.difference < -0.009)) return false;
      if (diffFilter === "over" && !(r.difference != null && r.difference > 0.009)) return false;
      if (diffFilter === "uncounted" && r.difference != null) return false;
      if (q) {
        const hay = `${format(new Date(r.shift.opened_at), "dd MMM yyyy")} ${r.shift.opening_notes ?? ""} ${r.shift.closing_notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, diffFilter, search]);

  const stats = useMemo(() => {
    const counted = rows.filter((r) => r.difference != null);
    const short = counted.filter((r) => r.difference! < -0.009);
    const over = counted.filter((r) => r.difference! > 0.009);
    return {
      shifts: rows.length,
      counted: counted.length,
      balanced: counted.length - short.length - over.length,
      shortCount: short.length,
      overCount: over.length,
      shortTotal: short.reduce((s, r) => s + r.difference!, 0),
      overTotal: over.reduce((s, r) => s + r.difference!, 0),
      netDiff: counted.reduce((s, r) => s + r.difference!, 0),
      totalIn: rows.reduce((s, r) => s + r.totalIn, 0),
      totalOut: rows.reduce((s, r) => s + r.totalOut, 0),
    };
  }, [rows]);

  // Cash entries that fall between shifts belong to no drawer count, so they are
  // reported separately instead of silently disappearing from the totals.
  const orphans = useMemo(() => {
    const claimed = new Set(rows.flatMap((r) => r.movements.map((m) => m.id)));
    return (movsQ.data ?? []).filter((m) => m.method === "cash" && !claimed.has(m.id));
  }, [rows, movsQ.data]);
  const orphanNet = orphans.reduce((s, m) => s + (m.direction === "in" ? n(m.amount) : -n(m.amount)), 0);

  const loading = shiftsQ.isLoading || movsQ.isLoading || linkQ.isLoading;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Scale className="h-6 w-6" /> Cash Drawer Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground">
            Every shift: opening → cash in → cash out → expected closing vs counted cash
          </p>
        </div>
        <Button variant="outline" onClick={() => printRecon(filtered, stats)} disabled={!filtered.length}>
          <Printer className="h-4 w-4 mr-2" /> Print difference report
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Shifts</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{stats.shifts}</div>
            <div className="text-xs text-muted-foreground mt-1">{stats.counted} counted · {stats.shifts - stats.counted} not counted</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Cash movement</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{money(stats.totalIn - stats.totalOut)}</div>
            <div className="text-xs text-muted-foreground mt-1">In {money(stats.totalIn)} · Out {money(stats.totalOut)}</div>
          </CardContent>
        </Card>
        <Card className={stats.shortCount ? "border-destructive/50" : ""}>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Shortage</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-destructive">{money(Math.abs(stats.shortTotal))}</div>
            <div className="text-xs text-muted-foreground mt-1">{stats.shortCount} shift(s) short</div>
          </CardContent>
        </Card>
        <Card className={stats.overCount ? "border-emerald-600/50" : ""}>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Excess</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-emerald-600">{money(stats.overTotal)}</div>
            <div className="text-xs text-muted-foreground mt-1">{stats.overCount} shift(s) over · {stats.balanced} exact</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Shift-by-shift reconciliation</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search date or note…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-44"
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All shifts</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={diffFilter} onValueChange={setDiffFilter}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any difference</SelectItem>
                  <SelectItem value="mismatch">Mismatched only</SelectItem>
                  <SelectItem value="short">Short only</SelectItem>
                  <SelectItem value="over">Over only</SelectItem>
                  <SelectItem value="uncounted">Not counted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Shift</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Cash sales</TableHead>
                <TableHead className="text-right">Due collected</TableHead>
                <TableHead className="text-right">Manual in</TableHead>
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Supplier</TableHead>
                <TableHead className="text-right">Manual out</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!loading && !filtered.length && (
                <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">No shifts match this filter</TableCell></TableRow>
              )}
              {filtered.map((r) => {
                const expanded = openRow === r.shift.id;
                const diff = r.difference;
                return (
                  <Fragment key={r.shift.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setOpenRow(expanded ? null : r.shift.id)}
                    >
                      <TableCell className="text-muted-foreground">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <div className="font-medium">{format(new Date(r.shift.opened_at), "dd MMM yy HH:mm")}</div>
                        <div className="text-muted-foreground">
                          {r.shift.closed_at ? `→ ${format(new Date(r.shift.closed_at), "dd MMM HH:mm")}` : (
                            <Badge variant="default" className="h-4 px-1 text-[10px]">open</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{money(r.opening)}</TableCell>
                      <TableCell className="text-right text-emerald-600">{money(r.cashSales)}</TableCell>
                      <TableCell className="text-right text-emerald-600">{money(r.dueCollections)}</TableCell>
                      <TableCell className="text-right text-emerald-600">{money(r.manualIn)}</TableCell>
                      <TableCell className="text-right text-destructive">{money(r.refunds)}</TableCell>
                      <TableCell className="text-right text-destructive">{money(r.expenses)}</TableCell>
                      <TableCell className="text-right text-destructive">{money(r.supplierPayments)}</TableCell>
                      <TableCell className="text-right text-destructive">{money(r.manualOut)}</TableCell>
                      <TableCell className="text-right font-semibold">{money(r.expected)}</TableCell>
                      <TableCell className="text-right">{r.counted == null ? "—" : money(r.counted)}</TableCell>
                      <TableCell className="text-right">
                        {diff == null ? (
                          <span className="text-muted-foreground text-xs">not counted</span>
                        ) : Math.abs(diff) < 0.009 ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" /> exact
                          </span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 font-semibold ${diff < 0 ? "text-destructive" : "text-emerald-600"}`}>
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {diff > 0 ? "+" : "−"}{money(Math.abs(diff))}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow key={`${r.shift.id}-d`} className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={13} className="p-4">
                          <ShiftDetail row={r} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!!orphans.length && (
        <Card className="border-amber-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Cash entries outside any shift ({orphans.length}) · net {money(orphanNet)}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These moved the drawer while no shift was open, so no shift count covers them.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orphans.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs whitespace-nowrap">{format(new Date(m.occurred_at), "dd MMM yy HH:mm")}</TableCell>
                    <TableCell className="text-xs">{SOURCE_LABEL[m.source] ?? m.source}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.reference || m.note || "—"}</TableCell>
                    <TableCell className={`text-xs text-right font-medium ${m.direction === "in" ? "text-emerald-600" : "text-destructive"}`}>
                      {m.direction === "in" ? "+" : "−"}{money(n(m.amount))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  payment: "Sale payment",
  sale: "Sale payment",
  due_collection: "Due collection",
  due: "Due collection",
  refund: "Refund",
  return: "Refund",
  expense: "Expense",
  supplier_payment: "Supplier payment",
  manual: "Manual entry",
};

function ShiftDetail({ row }: { row: Row }) {
  const line = (label: string, value: string, cls = "") => (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${cls}`}>{value}</span>
    </div>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Reconciliation</div>
        {line("Opening balance", money(row.opening))}
        {line("Cash sales", money(row.cashSales), "text-emerald-600")}
        {line("Due collections", money(row.dueCollections), "text-emerald-600")}
        {line("Manual cash in", money(row.manualIn), "text-emerald-600")}
        {line("Refunds paid out", `− ${money(row.refunds)}`, "text-destructive")}
        {line("Expenses paid", `− ${money(row.expenses)}`, "text-destructive")}
        {line("Supplier payments", `− ${money(row.supplierPayments)}`, "text-destructive")}
        {line("Manual cash out", `− ${money(row.manualOut)}`, "text-destructive")}
        <div className="border-t mt-2 pt-2">
          {line("Expected closing", money(row.expected), "text-primary")}
          {line("Counted cash", row.counted == null ? "not counted" : money(row.counted))}
          {line(
            "Difference",
            row.difference == null ? "—" : `${row.difference > 0 ? "+" : row.difference < 0 ? "−" : ""}${money(Math.abs(row.difference))}`,
            row.difference == null ? "" : row.difference < -0.009 ? "text-destructive" : row.difference > 0.009 ? "text-emerald-600" : "text-emerald-600",
          )}
        </div>
        {(row.shift.opening_notes || row.shift.closing_notes) && (
          <div className="mt-3 text-xs text-muted-foreground space-y-1">
            {row.shift.opening_notes && <div><b>Open note:</b> {row.shift.opening_notes}</div>}
            {row.shift.closing_notes && <div><b>Close note:</b> {row.shift.closing_notes}</div>}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Drawer entries ({row.movements.length})
        </div>
        <div className="max-h-72 overflow-y-auto rounded border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Time</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Reference</TableHead>
                <TableHead className="text-xs text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row.movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs whitespace-nowrap">{format(new Date(m.occurred_at), "dd MMM HH:mm")}</TableCell>
                  <TableCell className="text-xs">{SOURCE_LABEL[m.source] ?? m.source}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.reference || m.note || "—"}</TableCell>
                  <TableCell className={`text-xs text-right font-medium ${m.direction === "in" ? "text-emerald-600" : "text-destructive"}`}>
                    {m.direction === "in" ? "+" : "−"}{money(n(m.amount))}
                  </TableCell>
                </TableRow>
              ))}
              {!row.movements.length && (
                <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">No cash entries in this shift</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function printRecon(rows: Row[], stats: { shifts: number; counted: number; balanced: number; shortCount: number; overCount: number; shortTotal: number; overTotal: number; netDiff: number }) {
  const clinic = getClinic();
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const body = rows
    .map((r) => {
      const d = r.difference;
      const cls = d == null ? "muted" : d < -0.009 ? "neg" : d > 0.009 ? "pos" : "";
      return `<tr>
        <td>${format(new Date(r.shift.opened_at), "dd MMM yy HH:mm")}${r.shift.closed_at ? `<br><span class="muted">→ ${format(new Date(r.shift.closed_at), "dd MMM HH:mm")}</span>` : `<br><span class="muted">open</span>`}</td>
        <td class="r">${money(r.opening)}</td>
        <td class="r">${money(r.totalIn)}</td>
        <td class="r">${money(r.totalOut)}</td>
        <td class="r b">${money(r.expected)}</td>
        <td class="r">${r.counted == null ? "—" : money(r.counted)}</td>
        <td class="r b ${cls}">${d == null ? "not counted" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${money(Math.abs(d))}`}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>Cash Drawer Difference Report</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:18mm 12mm;color:#111}
  h1{font-size:18px;margin:0}
  .head{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:14px}
  .sub{font-size:11px;color:#555;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;vertical-align:top}
  th{background:#f3f3f3;font-size:10px;text-transform:uppercase;letter-spacing:.03em}
  .r{text-align:right}.b{font-weight:700}
  .pos{color:#0a7a3d}.neg{color:#b3261e}.muted{color:#777}
  .cards{display:flex;gap:8px;margin:12px 0 16px}
  .card{flex:1;border:1px solid #ddd;border-radius:6px;padding:8px}
  .card .l{font-size:9px;text-transform:uppercase;color:#666}
  .card .v{font-size:14px;font-weight:700;margin-top:2px}
  .foot{margin-top:18px;text-align:center;font-size:10px;color:#666}
</style></head><body>
<div class="head">
  <h1>${esc(clinic.name || "")}</h1>
  <div class="sub">${esc(clinic.address || "")}${clinic.phone ? ` · ${esc(clinic.phone)}` : ""}</div>
  <div class="sub"><b>Cash Drawer Reconciliation & Difference Report</b></div>
  <div class="sub">Generated ${format(new Date(), "dd MMM yyyy HH:mm")} · ${rows.length} shift(s)</div>
</div>
<div class="cards">
  <div class="card"><div class="l">Shifts counted</div><div class="v">${stats.counted}/${stats.shifts}</div></div>
  <div class="card"><div class="l">Exact</div><div class="v">${stats.balanced}</div></div>
  <div class="card"><div class="l">Shortage</div><div class="v neg">${money(Math.abs(stats.shortTotal))} (${stats.shortCount})</div></div>
  <div class="card"><div class="l">Excess</div><div class="v pos">${money(stats.overTotal)} (${stats.overCount})</div></div>
  <div class="card"><div class="l">Net difference</div><div class="v ${stats.netDiff < 0 ? "neg" : "pos"}">${stats.netDiff > 0 ? "+" : stats.netDiff < 0 ? "−" : ""}${money(Math.abs(stats.netDiff))}</div></div>
</div>
<table>
  <thead><tr>
    <th>Shift</th><th class="r">Opening</th><th class="r">Cash in</th><th class="r">Cash out</th>
    <th class="r">Expected</th><th class="r">Counted</th><th class="r">Difference</th>
  </tr></thead>
  <tbody>${body}</tbody>
</table>
<div class="foot"><b>${esc(clinic.name || "")}</b><br/>Drawer difference report — cash only</div>
<script>window.onload=()=>{window.print()}</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
