import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wallet, ArrowDownCircle, ArrowUpCircle, Printer, Play, StopCircle, PlusCircle, MinusCircle, Scale } from "lucide-react";

import { toast } from "sonner";
import { format } from "date-fns";
import { getClinic } from "@/lib/clinic-settings";
import { getThermalSettings } from "@/lib/invoice-print";
import { ensureCloseReport } from "@/lib/cash-close-report";
import { CashCloseHistory } from "@/components/CashCloseHistory";
import { deadSaleIds, grossOf, reversalAmount } from "@/lib/sales-ledger";

export const Route = createFileRoute("/_authenticated/cash-drawer")({
  head: () => ({
    meta: [
      { title: "Cash Drawer & Shift Closing — Pet Care Vet" },
      { name: "description", content: "Track cash drawer balances, sales collections, due collections, and daily shift closing reports." },
      { property: "og:title", content: "Cash Drawer & Shift Closing — Pet Care Vet" },
      { property: "og:description", content: "Track cash drawer balances, sales collections, due collections, and daily shift closing reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CashDrawerPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Summary = {
  shift_id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_balance: number;
  cash_sales: number;
  cash_due_collections: number;
  cash_refunds: number;
  total_sales?: number;
  total_paid?: number;
  total_due?: number;
  invoice_count?: number;
  supplier_payments: number;
  expenses: number;
  manual_in: number;
  manual_out: number;
  cancelled_in?: number;
  cancelled_out?: number;

  expected_cash: number;
  counted_cash: number | null;
  variance: number | null;
  opening_notes: string | null;
  closing_notes: string | null;
};

const SOURCES = [
  { value: "cash", label: "Cash (drawer)" },
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" },
  { value: "bank", label: "Bank" },
  { value: "card", label: "Card" },
] as const;


const money = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function CashDrawerPage() {
  const qc = useQueryClient();

  const summaryQ = useQuery({
    queryKey: ["cash_shift", "current"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cash_shift_summary", { _shift_id: undefined });
      if (error) throw error;
      return data as Summary | null;
    },
    refetchInterval: 15000,
  });

  const historyQ = useQuery({
    queryKey: ["cash_shifts", "history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_shifts")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  const current = summaryQ.data;
  const isOpen = current?.status === "open";

  const [viewShiftId, setViewShiftId] = useState<string | null>(null);
  const effectiveShiftId =
    viewShiftId ?? current?.shift_id ?? (historyQ.data?.[0] as any)?.id ?? null;
  const isCurrentView = !!effectiveShiftId && effectiveShiftId === current?.shift_id;

  const viewQ = useQuery({
    queryKey: ["cash_shift", effectiveShiftId],
    enabled: !!effectiveShiftId && !isCurrentView,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cash_shift_summary", { _shift_id: effectiveShiftId! });
      if (error) throw error;
      return data as Summary | null;
    },
  });
  const viewed = isCurrentView ? current : viewQ.data;

  // Live sync: any new sale / payment / refund refreshes the shift summary at once,
  // so the closing dialog and printed report never lag behind the dashboard.
  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["cash_shift"] });
      qc.invalidateQueries({ queryKey: ["cash_shift_methods"] });
      qc.invalidateQueries({ queryKey: ["cash_shift_method_summary"] });
      qc.invalidateQueries({ queryKey: ["cash_shift_movements"] });
      qc.invalidateQueries({ queryKey: ["account_balances_breakdown"] });
    };
    const channel = supabase
      .channel("cash-drawer-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_returns" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_movements" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);


  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6" /> Cash Drawer</h1>
          <p className="text-sm text-muted-foreground">Shift open → transactions → close with variance</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/reconciliation"><Scale className="h-4 w-4 mr-1.5" /> Reconciliation</Link>
          </Button>
          {isOpen && <ManualCashDialog direction="in" onDone={() => qc.invalidateQueries()} />}
          {isOpen && <ManualCashDialog direction="out" onDone={() => qc.invalidateQueries()} />}
          {isOpen ? <CloseShiftDialog summary={current!} onDone={() => qc.invalidateQueries()} />
                  : <OpenShiftDialog onDone={() => qc.invalidateQueries()} />}
        </div>

      </div>

      <AccountBalances
        expectedDrawer={isOpen ? Number(current?.expected_cash || 0) : null}
        openingBalance={isOpen ? Number(current?.opening_balance || 0) : null}
      />

      <ReconciliationReport
        cashOpening={isOpen ? Number(current?.opening_balance || 0) : null}
        cashExpected={isOpen ? Number(current?.expected_cash || 0) : null}
        cashCounted={current?.counted_cash ?? null}
      />




      {!isOpen && (
        <Card><CardContent className="py-4 text-center text-sm text-muted-foreground">
          No open shift — The {viewed ? "latest" : ""} shift summary is shown below. To start new sales, <b>Open Shift</b>.
        </CardContent></Card>
      )}

      {viewed && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={isCurrentView && isOpen ? "default" : "secondary"}>
            {isCurrentView && isOpen ? "Current shift" : "Closed shift"}
          </Badge>
          <span className="text-muted-foreground">
            {format(new Date(viewed.opened_at), "dd MMM yy HH:mm")}
            {viewed.closed_at ? ` → ${format(new Date(viewed.closed_at), "dd MMM yy HH:mm")}` : ""}
          </span>
          {viewShiftId && (
            <Button size="sm" variant="ghost" onClick={() => setViewShiftId(null)}>Reset view</Button>
          )}
        </div>
      )}

      {viewed && <ShiftSummaryCards s={viewed} />}
      {effectiveShiftId && <MethodSummary shiftId={effectiveShiftId} />}
      {effectiveShiftId && <MovementsList shiftId={effectiveShiftId} />}


      <Card>
        <CardHeader><CardTitle>Shift History</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Opened</TableHead><TableHead>Closed</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {historyQ.data?.map((s: any) => (
                <TableRow
                  key={s.id}
                  onClick={() => setViewShiftId(s.id)}
                  className={`cursor-pointer hover:bg-muted/50 ${s.id === effectiveShiftId ? "bg-muted/60" : ""}`}
                >

                  <TableCell className="text-xs">{format(new Date(s.opened_at), "dd MMM yy HH:mm")}</TableCell>
                  <TableCell className="text-xs">{s.closed_at ? format(new Date(s.closed_at), "dd MMM yy HH:mm") : "—"}</TableCell>
                  <TableCell className="text-right">{money(s.opening_balance)}</TableCell>
                  <TableCell className="text-right">{s.expected_cash != null ? money(s.expected_cash) : "—"}</TableCell>
                  <TableCell className="text-right">{s.counted_cash != null ? money(s.counted_cash) : "—"}</TableCell>
                  <TableCell className={`text-right font-medium ${Number(s.variance) < 0 ? "text-destructive" : Number(s.variance) > 0 ? "text-emerald-600" : ""}`}>
                    {s.variance != null ? money(s.variance) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.status === "open" ? "default" : "secondary"}>{s.status}</Badge>
                  </TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); printShift(s.id); }}><Printer className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              ))}
              {!historyQ.data?.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No shifts yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CashCloseHistory />
    </div>
  );
}

function ShiftSummaryCards({ s }: { s: Summary }) {
  const cashIn = Number(s.cash_sales || 0) + Number(s.cash_due_collections || 0) + Number(s.manual_in || 0) + Number(s.cancelled_in || 0);
  const cashOut = Number(s.cash_refunds || 0) + Number(s.supplier_payments || 0) + Number(s.expenses || 0) + Number(s.manual_out || 0) + Number(s.cancelled_out || 0);
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Opening Balance</CardTitle></CardHeader>
        <CardContent><div className="text-2xl font-semibold">{money(s.opening_balance)}</div>
          <div className="text-xs text-muted-foreground mt-1">Since {format(new Date(s.opened_at), "dd MMM HH:mm")}</div></CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><ArrowDownCircle className="h-3.5 w-3.5 text-emerald-600" />Cash In</CardTitle></CardHeader>
        <CardContent><div className="text-2xl font-semibold text-emerald-600">{money(cashIn)}</div>
          <div className="text-xs text-muted-foreground mt-1">Sales {money(s.cash_sales)} · Due {money(s.cash_due_collections)} · Cancelled in {money(s.cancelled_in || 0)} · Manual {money(s.manual_in)}</div></CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpCircle className="h-3.5 w-3.5 text-destructive" />Cash Out</CardTitle></CardHeader>
        <CardContent><div className="text-2xl font-semibold text-destructive">{money(cashOut)}</div>
          <div className="text-xs text-muted-foreground mt-1">Refund {money(s.cash_refunds)} · Cancelled out {money(s.cancelled_out || 0)} · Sup {money(s.supplier_payments)} · Exp {money(s.expenses)} · Manual {money(s.manual_out)}</div></CardContent></Card>
      <Card className="border-primary"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Expected in Drawer</CardTitle></CardHeader>
        <CardContent><div className="text-2xl font-bold text-primary">{money(s.expected_cash)}</div>
          <div className="text-xs text-muted-foreground mt-1">Opening + In − Out</div></CardContent></Card>
    </div>
  );
}

function ManualCashDialog({ direction, onDone }: { direction: "in" | "out"; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const isIn = direction === "in";

  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("record_manual_cash", {
        _direction: direction,
        _amount: Number(amount) || 0,
        _method: method as any,
        _reason: reason,
        _note: note || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isIn ? "Cash in recorded" : "Cash out recorded");
      setOpen(false); setAmount(""); setReason(""); setNote(""); setMethod("cash");
      onDone();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const amt = Number(amount) || 0;
  const affectsDrawer = method === "cash";

  return (
    <>
      <Button variant={isIn ? "default" : "outline"} onClick={() => setOpen(true)}>
        {isIn ? <PlusCircle className="h-4 w-4 mr-2" /> : <MinusCircle className="h-4 w-4 mr-2" />}
        {isIn ? "Cash In" : "Cash Out"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manual {isIn ? "Cash In" : "Cash Out"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Amount (৳)</Label>
              <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div>
              <Label>Source / Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={isIn ? "e.g. Owner cash deposit" : "e.g. Staff advance, transport bill"}
              />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
            {amt > 0 && (
              <div className={`rounded-md border p-2 text-xs ${affectsDrawer ? (isIn ? "text-emerald-700" : "text-destructive") : "text-muted-foreground"}`}>
                {affectsDrawer
                  ? `Cash drawer balance will ${isIn ? "increase" : "decrease"} by ${money(amt)}.`
                  : `${SOURCES.find((s) => s.value === method)?.label} balance will ${isIn ? "increase" : "decrease"} by ${money(amt)} — physical cash drawer stays unchanged.`}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => mut.mutate()}
                disabled={mut.isPending || amt <= 0 || !reason.trim()}
                variant={isIn ? "default" : "destructive"}
              >
                {mut.isPending ? "Saving…" : isIn ? "Record Cash In" : "Record Cash Out"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


function OpenShiftDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState("0");
  const [notes, setNotes] = useState("");
  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("open_cash_shift", { _opening: Number(opening) || 0, _notes: notes || undefined });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Shift opened"); setOpen(false); setOpening("0"); setNotes(""); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  if (!open) return <Button onClick={() => setOpen(true)}><Play className="h-4 w-4 mr-2" />Open Shift</Button>;
  return (
    <Card className="fixed inset-0 z-50 m-auto h-fit w-full max-w-md">
      <CardHeader><CardTitle>Open Cash Shift</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div><Label>Opening Cash (৳)</Label><Input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} autoFocus /></div>
        <div><Label>Notes (optional)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? "Opening…" : "Open Shift"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

type MethodRow = {
  method: string;
  sales: number;
  due_collections: number;
  refunds: number;
  supplier_payments: number;
  manual_in: number;
  manual_out: number;
  cancelled_in?: number;
  cancelled_out?: number;
  net: number;
};


function CloseShiftDialog({ summary, onDone }: { summary: Summary; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [methodCounts, setMethodCounts] = useState<Record<string, string>>({});
  const [settleDigital, setSettleDigital] = useState(true);
  // Digital accounts already settled in this close attempt. If closing fails
  // after settling, a retry must not record the settlement a second time.
  const settledRef = useRef<Record<string, number>>({});



  const methodsQ = useQuery({
    queryKey: ["cash_shift_methods", summary.shift_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cash_shift_method_summary", { _shift_id: summary.shift_id });
      if (error) throw error;
      return (data ?? []) as MethodRow[];
    },
    enabled: open,
  });

  // Live balance per account (same numbers as the Account Balances cards), so a
  // digital account carrying an older balance can be closed out together with cash.
  const balancesQ = useQuery({
    queryKey: ["account_balances_breakdown", "close-shift"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("account_balances_breakdown", {
        _from: null,
        _to: null,
      });
      if (error) throw error;
      return (data ?? []) as MethodBreakdown[];
    },
    enabled: open,
  });

  const rows: MethodRow[] = SOURCES.map((s) => {
    const found = methodsQ.data?.find((r) => r.method === s.value);
    return (
      found ?? {
        method: s.value,
        sales: 0,
        due_collections: 0,
        refunds: 0,
        supplier_payments: 0,
        manual_in: 0,
        manual_out: 0,
        cancelled_in: 0,
        cancelled_out: 0,
        net: 0,
      }
    );
  });

  const label = (m: string) => SOURCES.find((s) => s.value === m)?.label ?? m;
  const totals = rows.reduce(
    (a, r) => ({
      sales: a.sales + Number(r.sales || 0),
      due_collections: a.due_collections + Number(r.due_collections || 0),
      refunds: a.refunds + Number(r.refunds || 0),
      supplier_payments: a.supplier_payments + Number(r.supplier_payments || 0),
      manual_in: a.manual_in + Number(r.manual_in || 0),
      manual_out: a.manual_out + Number(r.manual_out || 0),
      cancelled_in: a.cancelled_in + Number(r.cancelled_in || 0),
      cancelled_out: a.cancelled_out + Number(r.cancelled_out || 0),
      net: a.net + Number(r.net || 0),
    }),
    { sales: 0, due_collections: 0, refunds: 0, supplier_payments: 0, manual_in: 0, manual_out: 0, cancelled_in: 0, cancelled_out: 0, net: 0 },
  );

  const grandTotal = Number(summary.opening_balance || 0) + totals.net;

  // Expected balance per account: cash uses the drawer expectation, digital accounts
  // use their full current balance (carried-over + this shift) so they can be settled to zero.
  const expectedFor = (m: string) => {
    if (m === "cash") return Number(summary.expected_cash || 0);
    const bal = balancesQ.data?.find((r) => r.method === m);
    if (bal) return Number(bal.closing || 0);
    return Number(rows.find((r) => r.method === m)?.net || 0);
  };

  // Prefill every account with its expected amount once totals are loaded.
  useEffect(() => {
    if (!open || !methodsQ.data || !balancesQ.data) return;
    setMethodCounts((prev) => {
      const next = { ...prev };
      for (const s of SOURCES) if (next[s.value] === undefined) next[s.value] = String(expectedFor(s.value));
      return next;
    });
  }, [open, methodsQ.data, balancesQ.data]);


  const countedFor = (m: string) => (m === "cash" ? Number(counted) || 0 : Number(methodCounts[m]) || 0);
  const totalExpected = SOURCES.reduce((a, s) => a + expectedFor(s.value), 0);
  const totalCounted = SOURCES.reduce((a, s) => a + countedFor(s.value), 0);
  const totalVariance = totalCounted - totalExpected;


  const mut = useMutation({
    mutationFn: async () => {
      const breakdown = SOURCES.map((s) => {
        const exp = expectedFor(s.value);
        const cnt = countedFor(s.value);
        return `${s.label}: expected ${exp.toFixed(2)} / counted ${cnt.toFixed(2)} / var ${(cnt - exp).toFixed(2)}`;
      }).join("\n");

      // Settle digital accounts (bKash/Nagad/Rocket/Card/Bank) so their balance
      // does not carry over to the next shift. Must run while the shift is open.
      const settled: string[] = [];
      if (settleDigital) {
        for (const s of SOURCES) {
          if (s.value === "cash") continue;
          const amt = Math.round(countedFor(s.value) * 100) / 100;
          if (amt <= 0) continue;
          if (settledRef.current[s.value] !== undefined) {
            settled.push(`${s.label}: ${settledRef.current[s.value].toFixed(2)}`);
            continue;
          }
          const { error: mErr } = await supabase.rpc("record_manual_cash", {
            _direction: "out",
            _amount: amt,
            _method: s.value as any,
            _reason: "Shift close settlement",
            _note: `Closed out ${s.label} on shift close`,
          });
          if (mErr) throw mErr;
          settledRef.current[s.value] = amt;
          settled.push(`${s.label}: ${amt.toFixed(2)}`);
        }
      }

      const fullNotes = [
        notes.trim(),
        "--- Account close-out ---",
        breakdown,
        `TOTAL: expected ${totalExpected.toFixed(2)} / counted ${totalCounted.toFixed(2)} / var ${totalVariance.toFixed(2)}`,
        settled.length ? `Settled out: ${settled.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const { data, error } = await supabase.rpc("close_cash_shift", {
        _shift_id: summary.shift_id, _counted: Number(counted) || 0, _notes: fullNotes,
      });
      if (error) throw error;
      return data as Summary;
    },
    onSuccess: (data) => {
      settledRef.current = {};
      toast.success("Shift closed"); setOpen(false); onDone(); printShiftData(data);
      ensureCloseReport(data as any)
        .then(() => toast.success("Cash Close Report saved"))
        .catch((e) => toast.error(`Cash Close Report not saved: ${e.message}. Use "Save report" in Cash Close History.`))
        .finally(onDone);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const variance = (Number(counted) || 0) - Number(summary.expected_cash || 0);
  if (!open) return <Button variant="destructive" onClick={() => { setOpen(true); setCounted(String(summary.expected_cash)); setMethodCounts({}); }}>
    <StopCircle className="h-4 w-4 mr-2" />Close Shift</Button>;

  return (
    <Card className="fixed inset-0 z-50 m-auto h-fit max-h-[92vh] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto">
      <CardHeader><CardTitle>Close Cash Shift</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded bg-muted p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>Opening</span><b>{money(summary.opening_balance)}</b></div>
          <div className="flex justify-between text-emerald-700"><span>+ Cash Sales</span><b>{money(summary.cash_sales)}</b></div>
          <div className="flex justify-between text-emerald-700"><span>+ Due Collected</span><b>{money(summary.cash_due_collections)}</b></div>
          <div className="flex justify-between text-destructive"><span>− Refunds</span><b>{money(summary.cash_refunds)}</b></div>
          <div className="flex justify-between text-destructive"><span>− Supplier Pay</span><b>{money(summary.supplier_payments)}</b></div>
          <div className="flex justify-between text-destructive"><span>− Expenses</span><b>{money(summary.expenses)}</b></div>
          <div className="flex justify-between text-emerald-700"><span>+ Manual Cash In</span><b>{money(summary.manual_in)}</b></div>
          <div className="flex justify-between text-destructive"><span>− Manual Cash Out</span><b>{money(summary.manual_out)}</b></div>
          {(Number(summary.cancelled_in || 0) !== 0 || Number(summary.cancelled_out || 0) !== 0) && (
            <div className="flex justify-between text-muted-foreground">
              <span>Cancelled bills (taken / returned)</span>
              <b className="whitespace-nowrap">
                <span className="text-emerald-700">{money(Number(summary.cancelled_in || 0))}</span>
                {" / "}
                <span className="text-destructive">{money(Number(summary.cancelled_out || 0))}</span>

              </b>
            </div>
          )}


          <div className="flex justify-between border-t pt-1 text-base"><span>Expected Cash</span><b className="text-primary">{money(summary.expected_cash)}</b></div>
        </div>

        <div className="space-y-2">
          <Label>All accounts this shift</Label>
          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                   <TableHead className="text-right">Due Collected</TableHead>
                  <TableHead className="text-right">Refunds</TableHead>
                  <TableHead className="text-right">Paid out</TableHead>
                  <TableHead className="text-right">Manual +/−</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.method}>
                    <TableCell className="whitespace-nowrap">{label(r.method)}</TableCell>
                    <TableCell className="text-right text-emerald-700">{money(r.sales)}</TableCell>
                     <TableCell className="text-right text-emerald-700">{money(r.due_collections)}</TableCell>
                    <TableCell className="text-right text-destructive">{money(r.refunds)}</TableCell>
                    <TableCell className="text-right text-destructive">{money(r.supplier_payments)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className="text-emerald-700">{money(r.manual_in)}</span>
                      {" / "}
                      <span className="text-destructive">{money(r.manual_out)}</span>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{money(r.net)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/60 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{money(totals.sales)}</TableCell>
                   <TableCell className="text-right">{money(totals.due_collections)}</TableCell>
                  <TableCell className="text-right">{money(totals.refunds)}</TableCell>
                  <TableCell className="text-right">{money(totals.supplier_payments)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{money(totals.manual_in)} / {money(totals.manual_out)}</TableCell>
                  <TableCell className="text-right">{money(totals.net)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-primary/5 p-3 text-sm">
            <span>Total amount (opening + all accounts net)</span>
            <b className="text-base text-primary">{money(grandTotal)}</b>
          </div>
          {methodsQ.isLoading && <p className="text-xs text-muted-foreground">Loading account totals…</p>}
        </div>

        <div className="space-y-2">
          <Label>Close out every account</Label>
          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right w-32">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SOURCES.map((s) => {
                  const exp = expectedFor(s.value);
                  const cnt = countedFor(s.value);
                  const v = cnt - exp;
                  return (
                    <TableRow key={s.value}>
                      <TableCell className="whitespace-nowrap">{s.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(exp)}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="h-9 text-right"
                          value={s.value === "cash" ? counted : (methodCounts[s.value] ?? "")}
                          onChange={(e) =>
                            s.value === "cash"
                              ? setCounted(e.target.value)
                              : setMethodCounts((p) => ({ ...p, [s.value]: e.target.value }))
                          }
                        />
                      </TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${v < 0 ? "text-destructive" : v > 0 ? "text-emerald-600" : ""}`}>
                        {money(v)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/60 font-semibold">
                  <TableCell>Total (all accounts)</TableCell>
                  <TableCell className="text-right tabular-nums">{money(totalExpected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(totalCounted)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${totalVariance < 0 ? "text-destructive" : totalVariance > 0 ? "text-emerald-600" : ""}`}>
                    {money(totalVariance)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <label className="flex items-start gap-2 rounded border bg-muted/40 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={settleDigital}
              onChange={(e) => setSettleDigital(e.target.checked)}
            />
            <span>
              Settle digital accounts on close (bKash, Nagad, Rocket, Card, Bank)
              <span className="block text-xs text-muted-foreground">
                Their counted amounts are closed out, so balances start from zero in the next shift instead of carrying over.
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            Cash variance is stored on the shift; the full account-wise close-out is saved with the closing notes.
          </p>
        </div>

        <div className={`text-sm font-medium ${variance < 0 ? "text-destructive" : variance > 0 ? "text-emerald-600" : ""}`}>
          Cash variance: {money(variance)} {variance < 0 ? "(short)" : variance > 0 ? "(over)" : ""}
        </div>

        <div><Label>Closing Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? "Closing…" : "Close & Print"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}


async function printShift(shift_id: string) {
  const { data, error } = await supabase.rpc("cash_shift_summary", { _shift_id: shift_id });
  if (error) { toast.error(error.message); return; }
  printShiftData(data as Summary);
}

const sMoney = (n: number) => {
  const v = Number(n || 0);
  const r = Math.round(v);
  const s = `৳${Math.abs(r).toLocaleString("en-BD", { maximumFractionDigits: 0 })}`;
  return r < 0 ? `−${s}` : s;
};

// Midnight (UTC+6, Dhaka) of the day the given timestamp falls on.
function dhakaDayStartISO(iso: string) {
  const shifted = new Date(new Date(iso).getTime() + 6 * 3600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 6 * 3600_000).toISOString();
}

// Daily Sales & Shift Closing Summary — thermal-friendly (80mm) closing report.
async function printShiftData(s: Summary | null) {
  if (!s) return;
  const CLINIC = getClinic();
  const paper = getThermalSettings().paperWidth || 80;

  // --- extra data for a complete closing paper ---
  let dueSales = Number(s.total_due || 0);
  let invoiceCount = Number(s.invoice_count || 0);
  let openingDue = 0;
  let dueCollectedInShift = 0;
  let remainingDue = 0;
  let closedBy = "";
  const endISO = s.closed_at ?? new Date().toISOString();
  let dueRefundAdj = 0;
  let shiftGross = Number(s.total_sales || 0);
  let shiftRefund = 0;
  let prevRefund = 0;
  const collectedByMethod: Record<string, number> = {};
  try {
    const [sales, pays, rets, user] = await Promise.all([
      // every sale created up to the end of this shift (for due carry-forward).
      // void sales stay INCLUDED: they count on their original day and are
      // reversed in full on the cancellation day (same rule as Reports).
      fetchAll(() => supabase.from("sales").select("id,total,subtotal,discount,paid,due,status,created_at")
        .lte("created_at", endISO).order("created_at")).then(data => ({ data })),
      fetchAll(() => supabase.from("payments").select("sale_id,amount,method,reference,received_at")
        .lte("received_at", endISO).order("received_at")).then(data => ({ data })),
      // ALL reversal rows (no end cutoff): an invoice sold today can be refunded
      // on a later day, and without that row the invoice looked "dead" and fell
      // out of today's Invoice Sales (the ৳170 that went missing on 08 Sep).
      fetchAll(() => supabase.from("sale_returns").select("sale_id,refund_amount,refund_paid,created_at")
        .order("created_at")).then(data => ({ data })),
      supabase.auth.getUser(),
    ]);

    const allSales = (sales.data ?? []) as any[];
    const saleById = new Map<string, any>(allSales.map((r) => [r.id, r]));
    const allPays = ((pays.data ?? []) as any[]).filter((p) => saleById.has(p.sale_id));
    const allRets = ((rets.data ?? []) as any[]).filter((r) => saleById.has(r.sale_id));
    // Drop fully-reversed invoices and old cancellations that have no reversal row,
    // exactly like Reports / Dashboard — otherwise phantom revenue leaks in.
    const dead = deadSaleIds(allSales, allRets);
    const liveSales = allSales.filter((r) => !dead.has(r.id));

    // Business-day start (UTC+6) of the shift's open date. Invoices entered today
    // BEFORE this shift was opened still belong to today's report, so the closing
    // summary always matches the dashboard's day totals / order count.
    const periodStart = dhakaDayStartISO(s.opened_at);
    const inShift = (iso: string) => iso >= periodStart && iso <= endISO;
    const isRefundPay = (p: any) => {
      const ref = String(p.reference || "");
      return Number(p.amount || 0) < 0 && (ref.startsWith("Refund ") || ref.startsWith("Cancelled "));
    };
    const refundsOf = (saleId: string, cutoff?: string) =>
      allRets.filter((r) => r.sale_id === saleId && (!cutoff || r.created_at > cutoff))
        .reduce((a, r) => a + Number(r.refund_amount || 0), 0);

    // Today's (this shift's) invoices
    const shiftInvoices = liveSales.filter((r) => inShift(r.created_at));
    invoiceCount = shiftInvoices.length;
    const shiftIds = new Set(shiftInvoices.map((r) => r.id));

    // Invoice Sales = today's invoices at their original value.
    // For normal invoices sales.total is already net of every refund → add the
    // refunds back. Cancelled (void) invoices keep their full total, so adding
    // their reversal back would double count it.
    shiftGross = shiftInvoices.reduce(
      (a, r) => a + grossOf(r) + (r.status === "void" || r.status === "refunded" ? 0 : refundsOf(r.id)),
      0,
    );

    // Refund = every reversal processed inside this shift, on its own date.
    // A cancelled (void) invoice reverses its full value once.
    const seen = new Set<string>();
    shiftRefund = allRets
      .filter((r) => inShift(r.created_at))
      .reduce((a, r) => a + reversalAmount(r, saleById.get(r.sale_id), seen), 0);
    // Split by invoice age: refunds on today's invoices are already deducted from
    // sales.total, refunds on earlier invoices are not.
    const seenPrev = new Set<string>();
    prevRefund = allRets
      .filter((r) => inShift(r.created_at) && !shiftIds.has(r.sale_id))
      .reduce((a, r) => a + reversalAmount(r, saleById.get(r.sale_id), seenPrev), 0);

    // Money actually collected on today's invoices, split by payment method
    const paidPerSale = new Map<string, number>();
    allPays
      .filter((p) => shiftIds.has(p.sale_id) && inShift(p.received_at))
      .forEach((p) => {
        const amt = Number(p.amount || 0);
        paidPerSale.set(p.sale_id, (paidPerSale.get(p.sale_id) ?? 0) + amt);
        const key = String(p.method || "cash");
        collectedByMethod[key] = (collectedByMethod[key] ?? 0) + amt;
      });

    // Today's due = end-of-day remaining amount on each of today's invoices.
    // Cancelled invoices carry no due — their whole value shows up as a refund.
    dueSales = shiftInvoices.reduce((a, r) => {
      if (r.status === "void" || r.status === "refunded") return a;
      const value = grossOf(r);
      return a + Math.max(value - (paidPerSale.get(r.id) ?? 0), 0);
    }, 0);

    // Opening due = outstanding on all invoices from previous days.
    // Cancelled (void) invoices carry NO due — their value is written off on the
    // cancellation day — so they must never enter the carry-forward, otherwise
    // the closing paper shows phantom due that Receivables doesn't have.
    const earlier = liveSales.filter((r) => r.created_at < periodStart && r.status !== "void" && r.status !== "refunded");
    const earlierIds = new Set(earlier.map((r) => r.id));
    const paidBeforeOpen = allPays
      .filter((p) => earlierIds.has(p.sale_id) && p.received_at < periodStart)
      .reduce((a, p) => a + Number(p.amount || 0), 0);
    openingDue = earlier.reduce((a, r) => a + grossOf(r) + refundsOf(r.id, periodStart), 0) - paidBeforeOpen;


    // Previous due collected = payments in this shift against earlier invoices.
    dueCollectedInShift = allPays
      .filter((p) => earlierIds.has(p.sale_id) && inShift(p.received_at) && !isRefundPay(p))
      .reduce((a, p) => a + Number(p.amount || 0), 0);

    // Refunds on earlier invoices: the unpaid part just reduces the due
    dueRefundAdj = allRets
      .filter((r) => inShift(r.created_at) && earlierIds.has(r.sale_id))
      .reduce((a, r) => a + Number(r.refund_amount || 0) - Number(r.refund_paid || 0), 0);

    // Carry-forward formula
    remainingDue = openingDue + dueSales - dueCollectedInShift - dueRefundAdj;
    closedBy = user.data?.user?.email ?? "";
  } catch { /* report still prints without extras */ }


  const ORDER = ["cash", "bkash", "nagad", "card", "rocket", "bank"] as const;
  const shown = ORDER.filter((k) => k !== "bank" || (collectedByMethod["bank"] ?? 0) !== 0);
  const collectedToday = shown.reduce((a, k) => a + (collectedByMethod[k] ?? 0), 0);
  const otherCollected = Object.entries(collectedByMethod)
    .filter(([k]) => !(ORDER as readonly string[]).includes(k))
    .reduce((a, [, v]) => a + v, 0);
  // Net Sales = Invoice Sales − every reversal processed today (same rule as
  // Reports / Sales History). Collected + Due − earlier-invoice refunds must
  // land on the same number, which is what the collection summary shows.
  const netSales = shiftGross - shiftRefund;
  const previousDueCollected = dueCollectedInShift;
  const cashInHand = Number(s.expected_cash || 0);
  // Cash in Hand = Reserve + Cash Sales + Cash Due Collection − Cash Refund − Cash Expense (± manual)
  const counted = s.counted_cash;
  const diff = counted != null ? Number(counted) - cashInHand : null;




  const row = (label: string, val: string, cls = "") =>
    `<div class="tr ${cls}"><span>${label}</span><span class="amt">${val}</span></div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Shift Closing Summary</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#000;
    font:500 12px/1.45 ui-sans-serif,system-ui,"Segoe UI",Roboto,Arial,sans-serif}
  .sheet{width:${paper}mm;max-width:${paper}mm;margin:0 auto;padding:4mm 4mm 6mm}
  .center{text-align:center}.amt{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
  h1{margin:0;font-size:16px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
  .sub{font-size:11px;font-weight:700;margin-top:2px;letter-spacing:.04em}
  .tag{font-size:10px;margin-top:1px}
  .rule{border-top:2px solid #000;margin:6px 0}
  .dash{border-top:1px dashed #000;margin:6px 0}
  .meta{font-size:10.5px}
  .meta .tr{padding:1px 0}
  .tr{display:flex;justify-content:space-between;gap:8px;padding:2.5px 0}
  .sec{margin-top:8px}
  .sec-t{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;
    border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:3px}
  .hero{display:flex;gap:4mm;margin:7px 0 2px}
  .box{flex:1;border:2px solid #000;padding:5px 6px;text-align:center}
  .box .k{font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
  .box .v{font-size:15px;font-weight:800;margin-top:2px}
  .total{font-weight:800;border-top:1.5px solid #000;border-bottom:2px double #000;padding:4px 0;margin-top:3px;font-size:12.5px}
  .neg{font-weight:600}
  .duebox{display:flex;justify-content:space-between;align-items:center;gap:8px;
    border:2px solid #000;padding:5px 7px;margin-top:5px;font-size:14px;font-weight:800;letter-spacing:.05em}
  .bigbox{border:3px solid #000;padding:8px 6px;margin:8px 0 2px;text-align:center}
  .bigbox .k{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
  .bigbox .v{font-size:24px;font-weight:900;margin-top:2px;font-variant-numeric:tabular-nums}
  .badge{margin-top:6px;text-align:center;font-size:12px;font-weight:800;letter-spacing:.06em;
    border:2px solid #000;padding:4px;text-transform:uppercase}
  .sign{display:flex;gap:6mm;margin-top:12mm;font-size:10px}
  .sign div{flex:1;text-align:center;border-top:1px solid #000;padding-top:3px}
  .foot{margin-top:8px;text-align:center;font-size:10px}
  .bar{display:flex;gap:8px;justify-content:center;padding:8px;background:#f4f4f5}
  .bar button{padding:6px 14px;font-size:13px;border:1px solid #999;border-radius:6px;background:#fff;cursor:pointer}
  @page{size:${paper}mm auto;margin:0}
  @media print{.no{display:none!important}.sec,.hero,.box,.tr{page-break-inside:avoid}}
</style></head><body>
<div class="bar no"><button onclick="window.print()">Print</button><button onclick="window.close()">Close</button></div>
<div class="sheet">
  <div class="center">
    <h1>${CLINIC.name}</h1>
    <div class="tag">${CLINIC.address}<br/>Tel: ${CLINIC.phone}</div>
    <div class="sub">Daily Sales &amp; Shift Closing Summary</div>
  </div>
  <div class="rule"></div>

  <div class="meta">
    ${row("Date", format(new Date(s.closed_at ?? s.opened_at), "dd MMM yyyy"))}
    ${row("Shift", s.shift_id.slice(0, 8).toUpperCase())}
    ${row("Shift Open", format(new Date(s.opened_at), "dd MMM yy · hh:mm a"))}
    ${row("Shift Close", s.closed_at ? format(new Date(s.closed_at), "dd MMM yy · hh:mm a") : "— (open)")}
    ${closedBy ? row("Closed By", closedBy) : ""}
  </div>

  <div class="bigbox">
    <div class="k">Today Sales (Net)</div>
    <div class="v">${sMoney(netSales)}</div>
  </div>

  <div class="sec" style="margin-top:4px">
    ${row("Invoice Count", String(invoiceCount))}
    ${row("Invoice Sales", sMoney(shiftGross))}
    ${shiftRefund ? row("Refund (today)", sMoney(-Math.abs(shiftRefund)), "neg") : ""}
  </div>

  <div class="sec">
    <div class="sec-t">Collection Summary</div>
    ${shown.map((k) => row(methodLabel[k] ?? k, sMoney(collectedByMethod[k] ?? 0))).join("")}
    ${otherCollected !== 0 ? row("Other", sMoney(otherCollected)) : ""}
    ${row("Collected", sMoney(collectedToday + otherCollected))}
    ${dueSales !== 0 ? row("Due (Unpaid)", sMoney(dueSales)) : ""}
    ${prevRefund ? row("Prev. Invoice Refund", sMoney(-Math.abs(prevRefund)), "neg") : ""}
    ${row("Total (= Today Sales)", sMoney(netSales), "total")}
  </div>


  <div class="sec">
    <div class="sec-t">Cash Summary</div>
    ${row("Reserve Cash", sMoney(s.opening_balance))}
    ${row("Cash Sales", sMoney(s.cash_sales))}
    ${row("Cash Due Collection", sMoney(s.cash_due_collections))}
    ${row("Cash Refund", sMoney(-Math.abs(Number(s.cash_refunds || 0))), "neg")}
    ${row("Cash Expense", sMoney(-Math.abs(Number(s.expenses || 0) + Number(s.supplier_payments || 0))), "neg")}
    ${Number(s.manual_in || 0) ? row("Manual Cash In", sMoney(s.manual_in)) : ""}
    ${Number(s.manual_out || 0) ? row("Manual Cash Out", sMoney(-Math.abs(Number(s.manual_out))), "neg") : ""}
    <div class="bigbox">
      <div class="k">Hand Cash</div>
      <div class="v">${sMoney(cashInHand)}</div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-t">Due Summary</div>
    ${row("Opening Due", sMoney(openingDue))}
    ${row("Today's Due Sales", `+${sMoney(dueSales)}`)}
    ${row("Due Collected", sMoney(-Math.abs(previousDueCollected)), "neg")}
    ${row("Due Refund Adjustment", sMoney(-Math.abs(dueRefundAdj)), "neg")}
    <div class="bigbox">
      <div class="k">Remaining Due</div>
      <div class="v">${sMoney(remainingDue)}</div>
    </div>
  </div>



  <div class="dash"></div>
  <div class="sec">
    <div class="sec-t">Final Closing</div>
    ${row("Expected Cash", sMoney(cashInHand))}
    ${row("Counted Cash", counted != null ? sMoney(counted) : "—")}
    ${row("Difference", diff != null ? sMoney(diff) : "—")}
    ${
      diff == null ? ""
      : Math.abs(diff) < 0.005
        ? `<div class="badge">Balanced ✓</div>`
        : `<div class="badge">${diff > 0 ? "Excess" : "Short"}: ${sMoney(Math.abs(diff))}</div>`
    }
  </div>


  <div class="sign"><div>Closed By</div><div>Signature</div></div>

  <div class="dash"></div>
  <div class="foot"><b>${CLINIC.name}</b><br/>Daily Sales &amp; Shift Closing Report</div>
</div>
</body></html>`;

  const w = window.open("", "_blank", `width=${Math.max(420, paper * 6)},height=900`);
  if (!w) { toast.error("Enable pop-ups to print the closing report"); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 400);
}


function MovementsList({ shiftId }: { shiftId: string }) {
  const q = useQuery({
    queryKey: ["cash_shift_movements", shiftId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cash_shift_movements", { _shift_id: shiftId });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 15000,
  });
  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Cash Movements ({rows.length})</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Reason / Reference</TableHead>
            <TableHead className="text-right">In</TableHead>
            <TableHead className="text-right">Out</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-xs">{format(new Date(m.occurred_at), "dd MMM HH:mm")}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{String(m.source).replace("_"," ")}</Badge></TableCell>
                <TableCell><Badge className={methodColor[m.method] ?? "bg-muted"}>{methodLabel[m.method] ?? m.method ?? "cash"}</Badge></TableCell>
                <TableCell className="text-xs">{m.reference ?? m.note ?? "—"}{m.reference && m.note ? ` — ${m.note}` : ""}</TableCell>
                <TableCell className="text-right text-emerald-600 font-medium">{m.direction === "in" ? money(m.amount) : ""}</TableCell>
                <TableCell className="text-right text-destructive font-medium">{m.direction === "out" ? money(m.amount) : ""}</TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No cash movements yet in this shift</TableCell></TableRow>}

          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const methodLabel: Record<string, string> = {
  cash: "Cash", bkash: "bKash", nagad: "Nagad", rocket: "Rocket",
  card: "Card", bank: "Bank", due: "Due",
};
const methodColor: Record<string, string> = {
  cash: "bg-emerald-100 text-emerald-800",
  bkash: "bg-pink-100 text-pink-800",
  nagad: "bg-orange-100 text-orange-800",
  rocket: "bg-purple-100 text-purple-800",
  card: "bg-blue-100 text-blue-800",
  bank: "bg-slate-100 text-slate-800",
  due: "bg-amber-100 text-amber-800",
};

function MethodSummary({ shiftId }: { shiftId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["cash_shift_method_summary", shiftId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cash_shift_method_summary", { _shift_id: shiftId });
      if (error) throw error;
      return (data ?? []) as { method: string; sales: number; due_collections: number; refunds: number; supplier_payments: number; manual_in: number; manual_out: number; cancelled_in: number; cancelled_out: number; net: number }[];
    },
    refetchInterval: 15000,
  });
  const rows = q.data ?? [];
  const totals = rows.reduce(
    (a, r) => ({
      sales: a.sales + Number(r.sales || 0),
      due: a.due + Number(r.due_collections || 0),
      refunds: a.refunds + Number(r.refunds || 0),
      sup: a.sup + Number(r.supplier_payments || 0),
      mIn: a.mIn + Number(r.manual_in || 0),
      mOut: a.mOut + Number(r.manual_out || 0),
      cancelledIn: a.cancelledIn + Number(r.cancelled_in || 0),
      cancelledOut: a.cancelledOut + Number(r.cancelled_out || 0),
      net: a.net + Number(r.net || 0),
    }),
    { sales: 0, due: 0, refunds: 0, sup: 0, mIn: 0, mOut: 0, cancelledIn: 0, cancelledOut: 0, net: 0 },
  );
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Payment Method Summary <span className="text-xs font-normal text-muted-foreground">(click a row for details)</span></CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Method</TableHead>
            <TableHead className="text-right">Sales</TableHead>
             <TableHead className="text-right">Due Collected</TableHead>
            <TableHead className="text-right">Refunds</TableHead>
            <TableHead className="text-right">Supplier / Exp</TableHead>
            <TableHead className="text-right">Manual In</TableHead>
            <TableHead className="text-right">Manual Out</TableHead>
            <TableHead className="text-right">Cancelled In / Out</TableHead>
            <TableHead className="text-right">Net</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.method} onClick={() => setSelected(r.method)} className="cursor-pointer hover:bg-muted/50">
                <TableCell>
                  <Badge className={methodColor[r.method] ?? "bg-muted"}>{methodLabel[r.method] ?? r.method}</Badge>
                </TableCell>
                <TableCell className="text-right text-emerald-600 font-medium">{money(r.sales)}</TableCell>
                 <TableCell className="text-right text-emerald-600 font-medium">{money(r.due_collections)}</TableCell>
                <TableCell className="text-right text-destructive">{money(r.refunds)}</TableCell>
                <TableCell className="text-right text-destructive">{money(r.supplier_payments)}</TableCell>
                <TableCell className="text-right text-emerald-600">{money(r.manual_in)}</TableCell>
                <TableCell className="text-right text-destructive">{money(r.manual_out)}</TableCell>
                <TableCell className="text-right tabular-nums"><span className="text-emerald-600">{money(r.cancelled_in)}</span> / <span className="text-destructive">{money(r.cancelled_out)}</span></TableCell>
                <TableCell className="text-right font-semibold">{money(r.net)}</TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No payments recorded yet</TableCell></TableRow>}
            {rows.length > 0 && (
              <TableRow className="border-t-2 font-bold bg-muted/40">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{money(totals.sales)}</TableCell>
               <TableCell className="text-right">{money(totals.due)}</TableCell>
                <TableCell className="text-right">{money(totals.refunds)}</TableCell>
                <TableCell className="text-right">{money(totals.sup)}</TableCell>
                <TableCell className="text-right">{money(totals.mIn)}</TableCell>
                <TableCell className="text-right">{money(totals.mOut)}</TableCell>
                <TableCell className="text-right"><span className="text-emerald-600">{money(totals.cancelledIn)}</span> / <span className="text-destructive">{money(totals.cancelledOut)}</span></TableCell>
                <TableCell className="text-right text-primary">{money(totals.net)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      <MethodTxDialog shiftId={shiftId} method={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

function MethodTxDialog({ shiftId, method, onClose }: { shiftId: string; method: string | null; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (method) { setSearch(""); setFromDate(""); setToDate(""); }
  }, [method]);

  const q = useQuery({
    queryKey: ["cash_shift_method_transactions", shiftId, method],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cash_shift_method_transactions", { _shift_id: shiftId, _method: method ?? "" });
      if (error) throw error;
      return (data ?? []) as { kind: string; id: string; occurred_at: string; amount: number; reference: string | null; party: string | null; note: string | null }[];
    },
    enabled: !!method,
  });
  const all = q.data ?? [];
  const rows = all.filter((r) => {
    const t = new Date(r.occurred_at).getTime();
    if (fromDate && t < new Date(fromDate + "T00:00:00").getTime()) return false;
    if (toDate && t > new Date(toDate + "T23:59:59").getTime()) return false;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      const hay = `${r.reference ?? ""} ${r.party ?? ""} ${r.note ?? ""} ${r.kind} ${r.amount}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
  const isOutflow = (kind: string) => kind === "refund" || kind === "supplier_payment" || kind === "expense" || kind === "manual_out";
  const totalIn = rows.filter((r) => !isOutflow(r.kind)).reduce((a, r) => a + Number(r.amount), 0);
  const totalOut = rows.filter((r) => isOutflow(r.kind)).reduce((a, r) => a + Number(r.amount), 0);

  return (
    <Dialog open={!!method} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{method ? methodLabel[method] ?? method : ""} — Transactions</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Search</Label>
            <Input placeholder="Reference, party, note…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>{rows.length} of {all.length} transactions</div>
          <div className="flex gap-3">
            <span className="text-emerald-600">In: {money(totalIn)}</span>
            <span className="text-destructive">Out: {money(totalOut)}</span>
            <button className="underline" onClick={() => { setSearch(""); setFromDate(""); setToDate(""); }}>Clear</button>
          </div>
        </div>
        <div className="max-h-[55vh] overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Party / Note</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isOut = isOutflow(r.kind);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.occurred_at), "dd MMM HH:mm")}</TableCell>
                    <TableCell>
                      <Badge variant={isOut ? "destructive" : "default"} className="capitalize">
                        {r.kind === "due_collection" ? "Due collection" : r.kind.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.reference ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.party ?? r.note ?? "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${isOut ? "text-destructive" : "text-emerald-600"}`}>
                      {isOut ? "− " : "+ "}{money(r.amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {q.isLoading ? "Loading…" : "No transactions"}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}


type MethodBalance = { method: string; inflow: number; outflow: number; balance: number };
type MethodBreakdown = {
  method: string;
  opening: number;
  received: number;
  refunded: number;
  other_in: number;
  other_out: number;
  closing: number;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash (drawer)",
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  card: "Card",
  bank: "Bank",
  due: "Due (unpaid)",
};

const RANGES = [
  { key: "today", label: "Today" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
] as const;

function rangeDates(key: string) {
  const now = new Date();
  const d = (x: Date) => format(x, "yyyy-MM-dd");
  if (key === "today") return { from: d(now), to: d(now) };
  if (key === "month") return { from: d(new Date(now.getFullYear(), now.getMonth(), 1)), to: d(now) };
  return { from: undefined, to: undefined };
}

const METHOD_ORDER = ["cash", "bkash", "nagad", "rocket", "card", "bank"] as const;

function AccountBalances({
  expectedDrawer,
  openingBalance,
}: {
  expectedDrawer: number | null;
  openingBalance?: number | null;
}) {
  const [range, setRange] = useState<string>("today");
  const { from, to } = rangeDates(range);

  const q = useQuery({
    queryKey: ["account_balances_breakdown", range],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("account_balances_breakdown", {
        _from: from ?? null,
        _to: to ?? null,
      });
      if (error) throw error;
      return (data ?? []) as MethodBreakdown[];
    },
    refetchInterval: 20000,
  });

  const byMethod = new Map((q.data ?? []).map((r) => [r.method, r]));
  const rows: MethodBreakdown[] = METHOD_ORDER.map(
    (m) =>
      byMethod.get(m) ?? {
        method: m,
        opening: 0,
        received: 0,
        refunded: 0,
        other_in: 0,
        other_out: 0,
        closing: 0,
      },
  );
  const totalIn = rows.reduce((s, r) => s + Number(r.received || 0) + Number(r.other_in || 0), 0);
  const totalOut = rows.reduce((s, r) => s + Number(r.refunded || 0) + Number(r.other_out || 0), 0);
  const totalBal = rows.reduce((s, r) => s + Number(r.closing || 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">Account Balances — money by method</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Opening, today's Received / Refunded and Closing for each method
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button key={r.key} size="sm" variant={range === r.key ? "default" : "outline"} onClick={() => setRange(r.key)}>
              {r.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const isCash = r.method === "cash";
            const shiftOpening = isCash && openingBalance != null ? Number(openingBalance) : null;
            const opening = shiftOpening ?? Number(r.opening || 0);
            const received = Number(r.received || 0) + Number(r.other_in || 0);
            const refunded = Number(r.refunded || 0);
            const otherOut = Number(r.other_out || 0);
            const closing = opening + received - refunded - otherOut;
            return (
              <Card key={r.method} className={isCash ? "border-primary" : ""}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      {METHOD_LABELS[r.method] ?? r.method}
                    </span>
                    {isCash && <Wallet className="h-3.5 w-3.5 text-primary" />}
                  </div>
                  <div className={`text-xl font-semibold mt-1 ${closing < 0 ? "text-destructive" : ""}`}>
                    {money(closing)}
                  </div>

                  <div className="mt-2 space-y-1 border-t pt-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Opening{shiftOpening != null ? " (shift)" : ""}
                      </span>
                      <span className="font-medium">{money(opening)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {range === "today" ? "Today " : ""}Received
                      </span>
                      <span className="font-medium text-emerald-600">+ {money(received)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {range === "today" ? "Today " : ""}Refunded
                      </span>
                      <span className="font-medium text-destructive">− {money(refunded)}</span>
                    </div>
                    {otherOut > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Paid out (expense/supplier)</span>
                        <span className="font-medium text-destructive">− {money(otherOut)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t pt-1">
                      <span className="font-medium">Closing</span>
                      <span className={`font-semibold ${closing < 0 ? "text-destructive" : ""}`}>{money(closing)}</span>
                    </div>
                  </div>

                  {isCash && expectedDrawer != null && (
                    <div className="text-[11px] text-primary mt-2">Drawer expected now: {money(expectedDrawer)}</div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>


        {!!rows.length && (
          <div className="flex flex-wrap items-center gap-4 rounded-md border p-3 text-sm">
            <span className="flex items-center gap-1 text-emerald-600">
              <ArrowDownCircle className="h-4 w-4" /> Total In {money(totalIn)}
            </span>
            <span className="flex items-center gap-1 text-destructive">
              <ArrowUpCircle className="h-4 w-4" /> Total Out {money(totalOut)}
            </span>
            <span className="font-semibold">Net {money(totalBal)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReconciliationReport({
  cashOpening,
  cashExpected,
  cashCounted,
}: {
  cashOpening: number | null;
  cashExpected: number | null;
  cashCounted: number | null;
}) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [actuals, setActuals] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["account_balances_breakdown", "today", "recon"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("account_balances_breakdown", {
        _from: today,
        _to: today,
      });
      if (error) throw error;
      return (data ?? []) as MethodBreakdown[];
    },
    refetchInterval: 20000,
  });

  const byMethod = new Map((q.data ?? []).map((r) => [r.method, r]));

  const rows = METHOD_ORDER.map((m) => {
    const r =
      byMethod.get(m) ??
      ({ method: m, opening: 0, received: 0, refunded: 0, other_in: 0, other_out: 0, closing: 0 } as MethodBreakdown);
    const isCash = m === "cash";
    const opening = isCash && cashOpening != null ? cashOpening : Number(r.opening || 0);
    const inflow = Number(r.received || 0) + Number(r.other_in || 0);
    const outflow = Number(r.refunded || 0) + Number(r.other_out || 0);
    const expected = isCash && cashExpected != null ? cashExpected : opening + inflow - outflow;
    const typed = actuals[m];
    const fallback = isCash && cashCounted != null ? cashCounted : null;
    const actual = typed !== undefined && typed !== "" ? Number(typed) : fallback;
    const variance = actual == null ? null : actual - expected;
    return { method: m, opening, inflow, outflow, expected, actual, variance };
  });

  const tExpected = rows.reduce((s, r) => s + r.expected, 0);
  const tActual = rows.reduce((s, r) => s + (r.actual ?? 0), 0);
  const anyActual = rows.some((r) => r.actual != null);
  const tVariance = anyActual ? tActual - tExpected : null;

  const printReport = () => {
    const CLINIC = getClinic();
    const paper = getThermalSettings().paperWidth || 80;
    const row = (label: string, val: string, cls = "") =>
      `<div class="tr ${cls}"><span>${label}</span><span class="amt">${val}</span></div>`;

    const sections = rows
      .map(
        (r) => `<div class="sec">
        <div class="sec-t">${METHOD_LABELS[r.method] ?? r.method}</div>
        ${row("Opening", sMoney(r.opening))}
        ${row("In", sMoney(r.inflow))}
        ${row("Out", sMoney(-Math.abs(r.outflow)), "neg")}
        ${row("Expected", sMoney(r.expected), "total")}
        ${row("Actual", r.actual == null ? "—" : sMoney(r.actual))}
        ${row("Variance", r.variance == null ? "—" : sMoney(r.variance))}
      </div>`,
      )
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Drawer Reconciliation</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#000;
    font:500 12px/1.45 ui-sans-serif,system-ui,"Segoe UI",Roboto,Arial,sans-serif}
  .sheet{width:${paper}mm;max-width:${paper}mm;margin:0 auto;padding:4mm 4mm 6mm}
  .center{text-align:center}.amt{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
  h1{margin:0;font-size:16px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
  .sub{font-size:11px;font-weight:700;margin-top:2px;letter-spacing:.04em}
  .tag{font-size:10px;margin-top:1px}
  .rule{border-top:2px solid #000;margin:6px 0}
  .dash{border-top:1px dashed #000;margin:6px 0}
  .meta{font-size:10.5px}.meta .tr{padding:1px 0}
  .tr{display:flex;justify-content:space-between;gap:8px;padding:2.5px 0}
  .sec{margin-top:8px}
  .sec-t{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;
    border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:3px}
  .hero{display:flex;gap:4mm;margin:7px 0 2px}
  .box{flex:1;border:2px solid #000;padding:5px 6px;text-align:center}
  .box .k{font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
  .box .v{font-size:15px;font-weight:800;margin-top:2px}
  .total{font-weight:800;border-top:1.5px solid #000;border-bottom:2px double #000;padding:4px 0;margin-top:3px;font-size:12.5px}
  .neg{font-weight:600}
  .badge{margin-top:6px;text-align:center;font-size:12px;font-weight:800;letter-spacing:.06em;
    border:2px solid #000;padding:4px;text-transform:uppercase}
  .sign{display:flex;gap:6mm;margin-top:12mm;font-size:10px}
  .sign div{flex:1;text-align:center;border-top:1px solid #000;padding-top:3px}
  .foot{margin-top:8px;text-align:center;font-size:10px}
  .bar{display:flex;gap:8px;justify-content:center;padding:8px;background:#f4f4f5}
  .bar button{padding:6px 14px;font-size:13px;border:1px solid #999;border-radius:6px;background:#fff;cursor:pointer}
  @page{size:${paper}mm auto;margin:0}
  @media print{.no{display:none!important}.sec,.hero,.box,.tr{page-break-inside:avoid}}
</style></head><body>
<div class="bar no"><button onclick="window.print()">Print</button><button onclick="window.close()">Close</button></div>
<div class="sheet">
  <div class="center">
    <h1>${CLINIC.name}</h1>
    <div class="tag">${CLINIC.address}<br/>Tel: ${CLINIC.phone}</div>
    <div class="sub">Drawer Reconciliation Summary</div>
  </div>
  <div class="rule"></div>

  <div class="meta">
    ${row("Date", format(new Date(), "dd MMM yyyy"))}
    ${row("Printed At", format(new Date(), "hh:mm a"))}
  </div>

  <div class="hero">
    <div class="box"><div class="k">Total Expected</div><div class="v">${sMoney(tExpected)}</div></div>
    <div class="box"><div class="k">Total Actual</div><div class="v">${anyActual ? sMoney(tActual) : "—"}</div></div>
  </div>

  ${sections}

  <div class="dash"></div>
  <div class="sec">
    <div class="sec-t">Final Position</div>
    ${row("Expected Total", sMoney(tExpected), "total")}
    ${row("Actual Total", anyActual ? sMoney(tActual) : "—")}
    ${row("Variance", tVariance == null ? "—" : sMoney(tVariance))}
    ${
      tVariance == null ? ""
      : Math.abs(tVariance) < 0.005
        ? `<div class="badge">Balanced ✓</div>`
        : `<div class="badge">${tVariance > 0 ? "Excess" : "Short"}: ${sMoney(Math.abs(tVariance))}</div>`
    }
  </div>

  <div class="sign"><div>Counted By</div><div>Signature</div></div>

  <div class="dash"></div>
  <div class="foot"><b>${CLINIC.name}</b><br/>Drawer Reconciliation Report</div>
</div>
</body></html>`;

    const w = window.open("", "_blank", `width=${Math.max(420, paper * 6)},height=900`);
    if (!w) { toast.error("Enable pop-ups to print the report"); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 400);
  };


  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">Drawer Reconciliation — Expected vs Actual</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Today's Cash, bKash, Nagad, Rocket, Card and Bank combined — enter Actual to see Variance
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={printReport}>
          <Printer className="h-4 w-4 mr-2" /> Print
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right w-[130px]">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.method}>
                  <TableCell className="font-medium">{METHOD_LABELS[r.method] ?? r.method}</TableCell>
                  <TableCell className="text-right">{money(r.opening)}</TableCell>
                  <TableCell className="text-right text-emerald-600">{money(r.inflow)}</TableCell>
                  <TableCell className="text-right text-destructive">{money(r.outflow)}</TableCell>
                  <TableCell className="text-right font-semibold">{money(r.expected)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      inputMode="decimal"
                      className="h-8 text-right"
                      placeholder={r.actual != null ? String(r.actual) : "count"}
                      value={actuals[r.method] ?? ""}
                      onChange={(e) => setActuals((p) => ({ ...p, [r.method]: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      r.variance == null ? "" : r.variance < 0 ? "text-destructive" : r.variance > 0 ? "text-emerald-600" : ""
                    }`}
                  >
                    {r.variance == null ? "—" : money(r.variance)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40">
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell colSpan={3} />
                <TableCell className="text-right font-semibold">{money(tExpected)}</TableCell>
                <TableCell className="text-right font-semibold">{anyActual ? money(tActual) : "—"}</TableCell>
                <TableCell
                  className={`text-right font-bold ${
                    tVariance == null ? "" : tVariance < 0 ? "text-destructive" : tVariance > 0 ? "text-emerald-600" : ""
                  }`}
                >
                  {tVariance == null ? "—" : money(tVariance)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        {tVariance != null && Math.abs(tVariance) > 0.004 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Total {tVariance < 0 ? "short" : "over"} {money(Math.abs(tVariance))} — see above which account has a mismatch.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
