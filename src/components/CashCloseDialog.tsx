import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { StopCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BIZ, METHOD_LABEL, accIn, accOut, ensureCloseReportV2, loadCloseSummary, num, printCloseV2,
  type BizKey, type CloseV2,
} from "@/lib/cash-close-v2";

const money = (n: number) => `৳${num(n).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (v: number) => (v < 0 ? "text-destructive" : v > 0 ? "text-emerald-600" : "");

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

/** Cash Close for the shared drawer: Part A Sales, Part B Collection, Part C Account closing. */
export function CashCloseDialog({ shiftId, onDone }: { shiftId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [biz, setBiz] = useState<BizKey>("all");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [settle, setSettle] = useState(true);
  const [notes, setNotes] = useState("");

  const q = useQuery({
    queryKey: ["cash_close_summary", shiftId],
    queryFn: () => loadCloseSummary(shiftId),
    enabled: open,
    refetchInterval: open ? 20000 : false,
  });
  const s = q.data;

  // Prefill counted with expected once, so only differences need typing.
  useEffect(() => {
    if (!s) return;
    setCounted((prev) => {
      const next = { ...prev };
      for (const a of s.accounts) if (next[a.method] === undefined) next[a.method] = String(num(a.expected));
      return next;
    });
  }, [s]);

  const rows = useMemo(() => (s?.accounts ?? []).map((a) => {
    const cnt = counted[a.method] === undefined || counted[a.method] === "" ? num(a.expected) : Number(counted[a.method]) || 0;
    return { a, cnt, v: num(cnt - num(a.expected)) };
  }), [s, counted]);
  const tot = rows.reduce((t, r) => ({ e: t.e + num(r.a.expected), c: t.c + r.cnt, v: t.v + r.v }), { e: 0, c: 0, v: 0 });

  const mut = useMutation({
    mutationFn: async () => {
      const w = window.open("", "_blank", "width=480,height=900"); // opened inside the click: not pop-up blocked
      const payload: Record<string, number> = {};
      for (const r of rows) payload[r.a.method] = r.cnt;
      const { data, error } = await (supabase.rpc as any)("close_cash_shift_v2", {
        _shift_id: shiftId, _counted: payload, _settle: settle, _notes: notes.trim() || null,
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
      <Button variant="destructive" onClick={() => { setOpen(true); setCounted({}); setNotes(""); setBiz("all"); }}>
        <StopCircle className="mr-2 h-4 w-4" />Close Shift
      </Button>
    );
  }

  const b = s?.business[biz];
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-2 sm:p-6" role="dialog" aria-modal="true">
      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader className="pb-3">
          <CardTitle>Cash Close</CardTitle>
          {s && (
            <p className="text-xs text-muted-foreground">
              Opened {new Date(s.opened_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })} · all figures are from this drawer shift only
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {q.isLoading && <p className="text-sm text-muted-foreground">Calculating…</p>}
          {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}

          {s && b && (
            <>
              <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Business">
                {BIZ.map((x) => (
                  <button
                    key={x.key}
                    role="tab"
                    aria-selected={biz === x.key}
                    onClick={() => setBiz(x.key)}
                    className={`rounded px-3 py-1.5 text-sm ${biz === x.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {x.label}
                  </button>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-md border p-3">
                  <h3 className="mb-1 text-sm font-semibold">A · Sales Summary</h3>
                  <Line label="Total Sales" value={b.sales.total_sales} hint={`${b.sales.bills} bills`} />
                  <Line label="Total Discount" value={b.sales.discount} minus />
                  <Line label="Total Refund" value={b.sales.refund} minus />
                  <Line label="Net Sales" value={b.sales.net_sales} strong />
                  {b.sales.cancelled_bills > 0 && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      {b.sales.cancelled_bills} bill(s) cancelled in this shift ({money(b.sales.cancelled_bills_amount)}) — not counted.
                    </p>
                  )}
                </section>

                <section className="rounded-md border p-3">
                  <h3 className="mb-1 text-sm font-semibold">B · Collection Summary</h3>
                  {b.collection.methods.map((m) => (
                    <Line key={m.method} label={`${METHOD_LABEL[m.method] ?? m.method} Collection`} value={m.collection} />
                  ))}
                  <Line label="Total Collection" value={b.collection.total_collection} strong />
                  {num(b.collection.refund_paid) > 0 && <Line label="Refund paid (older bills)" value={b.collection.refund_paid} minus />}
                </section>
              </div>

              <section className="rounded-md border bg-muted/30 p-3">
                <h3 className="mb-1 text-sm font-semibold">Due</h3>
                <div className="grid gap-x-6 sm:grid-cols-2">
                  <Line label="New Due" value={b.sales.new_due} hint="left unpaid on this shift's bills" />
                  <Line label="Previous Due Collection" value={b.collection.prev_due_collection} hint="paid now for older bills" />
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">C · Account Closing <span className="font-normal text-muted-foreground">(all businesses together)</span></h3>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Opening</TableHead>
                        <TableHead className="text-right">In</TableHead>
                        <TableHead className="text-right">Out</TableHead>
                        <TableHead className="text-right">Expected</TableHead>
                        <TableHead className="w-32 text-right">Counted</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(({ a, v }) => (
                        <TableRow key={a.method}>
                          <TableCell className="whitespace-nowrap">{METHOD_LABEL[a.method] ?? a.method}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(a.opening)}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-700">{money(accIn(a))}</TableCell>
                          <TableCell className="text-right tabular-nums text-destructive">{money(accOut(a))}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{money(a.expected)}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              inputMode="decimal"
                              aria-label={`Counted ${METHOD_LABEL[a.method] ?? a.method}`}
                              className="h-9 text-right"
                              value={counted[a.method] ?? ""}
                              onChange={(e) => setCounted((p) => ({ ...p, [a.method]: e.target.value }))}
                            />
                          </TableCell>
                          <TableCell className={`text-right font-medium tabular-nums ${tone(v)}`}>
                            {money(v)}{v < 0 ? " short" : v > 0 ? " excess" : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/60 font-semibold">
                        <TableCell colSpan={4}>Total</TableCell>
                        <TableCell className="text-right tabular-nums">{money(tot.e)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(tot.c)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${tone(tot.v)}`}>{money(tot.v)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div className="grid gap-x-6 text-sm sm:grid-cols-3">
                  <Line label="Cash expenses" value={s.expenses.cash} />
                  <Line label="All expenses" value={s.expenses.total} />
                  <Line label="Supplier payments" value={s.expenses.supplier_payments} />
                </div>
                <label className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={settle} onChange={(e) => setSettle(e.target.checked)} />
                  <span>
                    Digital Account Settlement — close out bKash, Nagad, Rocket, Bank and Card at their counted amounts
                    <span className="block text-xs text-muted-foreground">Next shift then starts these accounts from zero.</span>
                  </span>
                </label>
              </section>

              <div>
                <Label htmlFor="close-notes">Closing Notes</Label>
                <Textarea id="close-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => mut.mutate()} disabled={!s || mut.isPending}>
              {mut.isPending ? "Closing…" : "Close & Print"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
