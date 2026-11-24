import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { StopCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BIZ, METHOD_LABEL, accIn, creditNet, accOut, cashBreakdown, collectionSplit, ensureCloseReportV2, loadCloseSummary, num, printCloseV2,
  type BizKey, type CloseV2,
} from "@/lib/cash-close-v2";

const money = (n: number) => `৳${num(n).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Line({ label, value, strong, minus, hint }: { label: string; value: number; strong?: boolean; minus?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${strong ? "mt-1 border-t pt-2 font-semibold" : ""}`}>
      <span className="text-sm">
        {label}
        {hint && <span className="ml-1 text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className={`tabular-nums ${minus && value ? "text-destructive" : ""} ${strong ? "text-base" : "text-sm"}`}>
        {minus && value ? "− " : ""}{money(value)}
      </span>
    </div>
  );
}

/** Cash Close for the shared drawer. Only cash is counted by hand; digital accounts close at their expected amount. */
export function CashCloseDialog({ shiftId, onDone }: { shiftId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [biz, setBiz] = useState<BizKey>("all");
  const [counted, setCounted] = useState("");
  const [pending, setPending] = useState("");
  const [notes, setNotes] = useState("");

  const q = useQuery({
    queryKey: ["cash_close_summary", shiftId],
    queryFn: () => loadCloseSummary(shiftId),
    enabled: open,
    refetchInterval: open ? 20000 : false,
  });
  const s = q.data;

  const cash = s?.accounts.find((a) => a.method === "cash");
  const digital = (s?.accounts ?? []).filter((a) => a.method !== "cash" && (num(a.expected) !== 0 || accIn(a) !== 0 || accOut(a) !== 0));
  const expected = num(cash?.expected);
  const countedNum = counted === "" ? null : Number(counted) || 0;
  const pendingNum = Math.max(0, Number(pending) || 0);
  const variance = countedNum === null ? null : num(countedNum - expected);
  const varianceAfter = variance === null ? null : num(variance + pendingNum);

  const mut = useMutation({
    mutationFn: async () => {
      if (countedNum === null) throw new Error("Count the cash in the drawer and enter it first");
      const w = window.open("", "_blank", "width=480,height=900"); // opened inside the click: not pop-up blocked
      const { data, error } = await (supabase.rpc as any)("close_cash_shift_v2", {
        _shift_id: shiftId, _counted: { cash: countedNum, pending_expense: pendingNum }, _settle: true, _notes: notes.trim() || null,
      });
      if (error) { w?.close(); throw error; }
      const frozen = (data as any).close_summary as CloseV2;
      if (!printCloseV2(frozen, w)) toast.error("Enable pop-ups to print the closing report");
      return frozen;
    },
    onSuccess: (frozen) => {
      toast.success("Cash drawer closed");
      setOpen(false);
      onDone();
      ensureCloseReportV2(frozen)
        .then(() => toast.success("Cash Close Report saved (PDF)"))
        .catch((e) => toast.error(`PDF not saved: ${e.message}. Use "Save report" in Cash Close History.`))
        .finally(onDone);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!open) {
    return (
      <Button variant="destructive" onClick={() => { setOpen(true); setCounted(""); setPending(""); setNotes(""); setBiz("all"); }}>
        <StopCircle className="mr-2 h-4 w-4" />Close Shift
      </Button>
    );
  }

  const b = s?.business[biz];
  const methods = (b?.collection.methods ?? []).filter((m) => num(m.collection) !== 0);
  const verdict = (v: number | null) =>
    v === null ? "Enter counted cash" : Math.abs(v) < 0.01 ? "Matched" : v < 0 ? `Short ${money(-v)}` : `Excess ${money(v)}`;
  const verdictTone = (v: number | null) =>
    v === null ? "text-muted-foreground" : Math.abs(v) < 0.01 ? "text-emerald-700" : v < 0 ? "text-destructive" : "text-amber-600";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="cc-title">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden bg-background shadow-xl sm:max-h-[92vh] sm:rounded-xl">
        <header className="border-b px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="cc-title" className="text-lg font-semibold">Cash Close</h2>
            {s && (
              <span className="text-xs text-muted-foreground">
                Opened {new Date(s.opened_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {q.isLoading && <p className="text-sm text-muted-foreground">Calculating…</p>}
          {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}

          {s && b && cash && (
            <>
              {/* Cash drawer — the only thing counted by hand */}
              <section className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4" aria-labelledby="cc-cash">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="cc-cash" className="text-sm font-medium text-muted-foreground">Cash that should be in the drawer</h3>
                    <p className="text-3xl font-bold tabular-nums">{money(expected)}</p>
                  </div>
                  {(() => {
                    const cb = cashBreakdown(s);
                    const out = cb.expenses + cb.supplier + cb.manualOut;
                    return (
                      <dl className="min-w-[13rem] text-xs leading-5 tabular-nums">
                        <div className="flex justify-between gap-4 text-muted-foreground"><dt>Opening</dt><dd>{money(cb.opening)}</dd></div>
                        <div className="flex justify-between gap-4 text-emerald-700"><dt>+ Sales cash</dt><dd>{money(cb.sales)}</dd></div>
                        <div className="flex justify-between gap-4 text-emerald-700"><dt>+ Previous due cash</dt><dd>{money(cb.prevDue)}</dd></div>
                        {cb.refundOld !== 0 && <div className="flex justify-between gap-4 text-destructive"><dt>− Refund (older bills)</dt><dd>{money(cb.refundOld)}</dd></div>}
                        {out !== 0 && <div className="flex justify-between gap-4 text-destructive"><dt>− Expense / cash out</dt><dd>{money(out)}</dd></div>}
                        {cb.manualIn !== 0 && <div className="flex justify-between gap-4 text-emerald-700"><dt>+ Cash in</dt><dd>{money(cb.manualIn)}</dd></div>}
                        {cb.other !== 0 && <div className="flex justify-between gap-4 text-muted-foreground"><dt>Other adjustments</dt><dd>{money(cb.other)}</dd></div>}
                      </dl>
                    );
                  })()}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="cc-counted">Counted cash</Label>
                    <Input id="cc-counted" type="number" inputMode="decimal" autoFocus placeholder="0"
                      className="h-12 bg-background text-right text-xl font-semibold tabular-nums"
                      value={counted} onChange={(e) => setCounted(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cc-pending">Expense not yet entered</Label>
                    <Input id="cc-pending" type="number" inputMode="decimal" min={0} placeholder="0"
                      className="h-12 bg-background text-right text-xl tabular-nums"
                      value={pending} onChange={(e) => setPending(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Only for this count and the print — no expense is saved.</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-primary/20 pt-3">
                  <span className="text-sm font-medium">Difference</span>
                  <span className={`text-xl font-bold tabular-nums ${verdictTone(variance)}`}>{verdict(variance)}</span>
                </div>
                {pendingNum > 0 && variance !== null && (
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-muted-foreground">After the {money(pendingNum)} expense</span>
                    <span className={`text-base font-semibold tabular-nums ${verdictTone(varianceAfter)}`}>{verdict(varianceAfter)}</span>
                  </div>
                )}
              </section>

              {/* Digital accounts — fixed, closed at the software amount */}
              <section aria-labelledby="cc-digital">
                <h3 id="cc-digital" className="mb-1.5 text-sm font-semibold">Digital accounts</h3>
                {digital.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bKash, Nagad, Rocket, Bank or Card money in this shift.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {digital.map((a) => (
                      <li key={a.method} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span>{METHOD_LABEL[a.method] ?? a.method}</span>
                        <span className="font-medium tabular-nums">{money(a.expected)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-muted-foreground">These close at the amounts shown and start from zero next shift.</p>
              </section>

              {/* Sales and collection, per business */}
              <section aria-labelledby="cc-sales" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="cc-sales" className="text-sm font-semibold">Sales and collection</h3>
                  <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Business">
                    {BIZ.map((x) => (
                      <button key={x.key} role="tab" aria-selected={biz === x.key} onClick={() => setBiz(x.key)}
                        className={`rounded px-2.5 py-1 text-xs ${biz === x.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                        {x.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Net sales · {b.sales.bills} bills</p>
                    <p className="text-2xl font-semibold tabular-nums">{money(b.sales.net_sales)}</p>
                    <div className="mt-2 border-t pt-1">
                      <Line label="Total sales" value={b.sales.total_sales} />
                      <Line label="Discount" value={b.sales.discount} minus />
                      <Line label="Refund" value={b.sales.refund} minus />
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Total collection</p>
                    <p className="text-2xl font-semibold tabular-nums">{money(b.collection.total_collection)}</p>
                    <div className="mt-2 border-t pt-1">
                      {methods.length === 0 && <p className="py-1 text-sm text-muted-foreground">No collection yet</p>}
                      {methods.length > 0 && (() => {
                        const sp = collectionSplit(b.collection);
                        return (
                          <>
                            <Line label="Sales collection" hint="this shift's bills" value={sp.salesTotal} strong />
                            {sp.sales.map((m) => <div key={`s-${m.method}`} className="pl-3"><Line label={METHOD_LABEL[m.method] ?? m.method} value={m.amount} /></div>)}
                            <Line label="Previous due collection" hint="older bills" value={sp.prevTotal} strong />
                            {sp.prev.map((m) => <div key={`p-${m.method}`} className="pl-3"><Line label={METHOD_LABEL[m.method] ?? m.method} value={m.amount} /></div>)}
                          </>
                        );
                      })()}
                      {num(b.collection.refund_paid) > 0 && <Line label="Refund paid (older bills)" value={b.collection.refund_paid} minus />}
                      {creditNet(b.collection) !== 0 && (
                        <Line label={creditNet(b.collection) > 0 ? "Store credit kept" : "Store credit used"} value={Math.abs(creditNet(b.collection))} hint="not cash" />
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid gap-x-6 rounded-lg border bg-muted/30 px-3 py-1 sm:grid-cols-2">
                  <Line label="New due" value={b.sales.new_due} />
                  <Line label="Previous due collected" value={b.collection.prev_due_collection} />
                </div>
                {b.sales.cancelled_bills > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {b.sales.cancelled_bills} bill(s) cancelled in this shift ({money(b.sales.cancelled_bills_amount)}) — not counted.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Expenses entered this shift: cash {money(s.expenses.cash)} · all {money(s.expenses.total)}
                  {num(s.expenses.supplier_payments) ? ` · supplier ${money(s.expenses.supplier_payments)}` : ""}
                </p>
              </section>

              <div className="space-y-1">
                <Label htmlFor="close-notes">Closing notes</Label>
                <Textarea id="close-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t bg-background px-4 py-3 sm:px-5">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => mut.mutate()} disabled={!s || countedNum === null || mut.isPending}>
            {mut.isPending ? "Closing…" : "Close & Print"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
