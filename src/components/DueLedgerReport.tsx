import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const dayKey = (d: string) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

/** a negative payment created by a refund / cancellation (money handed back) */
const isRefundPayment = (p: any) => {
  const r = String(p.reference || "");
  return Number(p.amount || 0) < 0 && (r.startsWith("Refund ") || r.startsWith("Cancelled "));
};

/**
 * Due Ledger: explains how "Reports" (accrual) and "Cash Closed" (cash) differ.
 *  - Due created  = sale.due on the sale's own day (revenue counted, cash NOT in drawer)
 *  - Due collected = payments received on that day against sales made EARLIER (refunds excluded)
 *  - Due refund adj = refund value on an older invoice that was never paid → lowers the due only
 *  - Net cash from sales = Sell Value − Due created + Due collected
 *
 * Single source of truth: sale_returns rows. sales.total is already net of refunds,
 * so a refund is never deducted twice — it is added back for days before the refund
 * happened, and shown as an adjustment on the day it actually happened.
 */
export function DueLedgerReport({ from, to }: { from: string; to: string }) {
  const [sales, setSales] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const toISO = new Date(`${to}T23:59:59.999`).toISOString();
      // full history up to the end of range — needed for due carry-forward
      const [s, p, r] = await Promise.all([
        fetchAll(() => supabase
          .from("sales")
          .select("id,invoice_no,total,paid,due,status,created_at, pet_owners(full_name,phone)")
          .lte("created_at", toISO)
          .neq("status", "void")
          .order("created_at", { ascending: false })),
        fetchAll(() => supabase
          .from("payments")
          .select("id,sale_id,amount,method,reference,received_at")
          .lte("received_at", toISO)
          .order("received_at")),
        fetchAll(() => supabase
          .from("sale_returns")
          .select("id,sale_id,refund_amount,refund_paid,created_at")
          .lte("created_at", toISO)
          .order("created_at")),
      ]);
      setSales(s || []);
      setPayments(p || []);
      setReturns(r || []);
      setLoading(false);
    })();
  }, [from, to]);

  // Outstanding right now
  const outstanding = useMemo(
    () =>
      sales
        .filter((s) => Number(s.due || 0) > 0 && s.status !== "void")
        .sort((a, b) => Number(b.due) - Number(a.due)),
    [sales],
  );
  const totalOutstanding = outstanding.reduce((a, s) => a + Number(s.due || 0), 0);

  // Daily due movement with carry-forward opening/remaining due
  const daily = useMemo(() => {
    const live = sales.filter((s) => s.status !== "void");
    const saleCreated = new Map<string, string>(live.map((s) => [s.id, s.created_at]));
    const pays = payments.filter((p) => saleCreated.has(p.sale_id));
    const rets = returns.filter((r) => saleCreated.has(r.sale_id));

    // refunds of a sale that happened AFTER the sale's own day — added back so the
    // sale day keeps its original value and the refund lands on the refund day.
    const laterRefundBySale = new Map<string, number>();
    rets.forEach((r) => {
      const saleDay = dayKey(saleCreated.get(r.sale_id)!);
      if (dayKey(r.created_at) > saleDay) {
        laterRefundBySale.set(r.sale_id, (laterRefundBySale.get(r.sale_id) ?? 0) + Number(r.refund_amount || 0));
      }
    });

    type Row = {
      sell: number; dueNew: number; collected: number; collectedSameDay: number;
      refundAdj: number; cashRefund: number; opening: number; remaining: number;
    };
    const blank = (): Row => ({ sell: 0, dueNew: 0, collected: 0, collectedSameDay: 0, refundAdj: 0, cashRefund: 0, opening: 0, remaining: 0 });
    const m = new Map<string, Row>();
    const touch = (d: string) => {
      const cur = m.get(d) || blank();
      m.set(d, cur);
      return cur;
    };

    // sales per day (full history so carry-forward is exact)
    live.forEach((s) => {
      const cur = touch(dayKey(s.created_at));
      cur.sell += Number(s.total || 0) + (laterRefundBySale.get(s.id) ?? 0);
    });

    // payments per day, split by whether the sale was made earlier (old due) or same day
    pays.forEach((p) => {
      const payDay = dayKey(p.received_at);
      const saleDay = dayKey(saleCreated.get(p.sale_id)!);
      const cur = touch(payDay);
      if (isRefundPayment(p)) {
        cur.cashRefund += Math.abs(Number(p.amount || 0));
        // money handed back: never counted as due collection.
        if (saleDay === payDay) cur.collectedSameDay += Number(p.amount || 0);
        return;
      }
      if (saleDay < payDay) cur.collected += Number(p.amount || 0);
      else cur.collectedSameDay += Number(p.amount || 0);
    });

    // refunds on OLDER invoices reduce the outstanding due by the unpaid part only
    rets.forEach((r) => {
      const refundDay = dayKey(r.created_at);
      const saleDay = dayKey(saleCreated.get(r.sale_id)!);
      if (refundDay === saleDay) return; // already netted inside that day's sell value
      const cur = touch(refundDay);
      cur.refundAdj += Number(r.refund_amount || 0) - Number(r.refund_paid || 0);
    });

    // ascending walk: opening = previous day remaining
    const asc = Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let carry = 0;
    asc.forEach(([, v]) => {
      v.dueNew = v.sell - v.collectedSameDay;
      v.opening = carry;
      v.remaining = carry + v.dueNew - v.collected - v.refundAdj;
      carry = v.remaining;
    });

    // only show the selected range (carry-forward already baked in)
    return asc.filter(([d]) => d >= from && d <= to).reverse();
  }, [sales, payments, returns, from, to]);

  const dailyTotals = daily.reduce(
    (a, [, v]) => ({
      sell: a.sell + v.sell,
      dueNew: a.dueNew + v.dueNew,
      collected: a.collected + v.collected,
      collectedSameDay: a.collectedSameDay + v.collectedSameDay,
      refundAdj: a.refundAdj + v.refundAdj,
      cashRefund: a.cashRefund + v.cashRefund,
    }),
    { sell: 0, dueNew: 0, collected: 0, collectedSameDay: 0, refundAdj: 0, cashRefund: 0 },
  );
  const netCash = dailyTotals.collectedSameDay + dailyTotals.collected;
  const openingDue = daily.length ? daily[daily.length - 1][1].opening : 0;
  const closingDue = daily.length ? daily[0][1].remaining : totalOutstanding;


  if (loading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading due ledger…</div>;


  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <Card><CardContent className="p-3 sm:p-4">
          <div className="text-xs text-muted-foreground">Sell Value (range)</div>
          <div className="text-lg font-semibold sm:text-2xl">{fmt(dailyTotals.sell)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4">
          <div className="text-xs text-muted-foreground">New Due Created</div>
          <div className="text-lg font-semibold text-amber-600 sm:text-2xl">−{fmt(dailyTotals.dueNew)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">counted in sales, not in drawer</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4">
          <div className="text-xs text-muted-foreground">Old Due Collected</div>
          <div className="text-lg font-semibold text-emerald-600 sm:text-2xl">+{fmt(dailyTotals.collected)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">cash in, never added to sales</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4">
          <div className="text-xs text-muted-foreground">Remaining Due (closing)</div>
          <div className="text-lg font-semibold sm:text-2xl">{fmt(closingDue)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            opening {fmt(openingDue)} + new due − collected − refund adj {fmt(dailyTotals.refundAdj)}
          </div>
        </CardContent></Card>
      </div>

      {/* Daily reconciliation */}
      <Card>
        <CardHeader><CardTitle>Daily Due Movement (carry forward)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Sell Value</TableHead>
              <TableHead className="text-right">Opening Due</TableHead>
              <TableHead className="text-right">New Due (unpaid)</TableHead>
              <TableHead className="text-right">Same-day Paid</TableHead>
              <TableHead className="text-right">Due Collected</TableHead>
              <TableHead className="text-right">Due Refund Adj</TableHead>
              <TableHead className="text-right">Remaining Due</TableHead>
              <TableHead className="text-right">Cash from Sales</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {daily.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No data in range</TableCell></TableRow>}
              {daily.map(([d, v]) => (
                <TableRow key={d}>
                  <TableCell>{d}</TableCell>
                  <TableCell className="text-right">{fmt(v.sell)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmt(v.opening)}</TableCell>
                  <TableCell className="text-right text-amber-600">{v.dueNew === 0 ? "—" : v.dueNew > 0 ? `+${fmt(v.dueNew)}` : `−${fmt(Math.abs(v.dueNew))}`}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmt(v.collectedSameDay)}</TableCell>
                  <TableCell className="text-right text-emerald-600">{v.collected === 0 ? "—" : v.collected > 0 ? `−${fmt(v.collected)}` : `+${fmt(Math.abs(v.collected))}`}</TableCell>
                  <TableCell className="text-right text-sky-600">
                    {v.refundAdj === 0 ? "—" : `−${fmt(v.refundAdj)}`}
                    {v.cashRefund > 0 && <div className="text-[10px] text-muted-foreground">cash back {fmt(v.cashRefund)}</div>}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{fmt(v.remaining)}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(v.collectedSameDay + v.collected)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

        </CardContent>
      </Card>


      {/* Outstanding dues */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span>Outstanding Due Bills ({outstanding.length})</span>
            <Badge variant="destructive" className="text-sm">{fmt(totalOutstanding)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Due</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {outstanding.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No outstanding dues 🎉</TableCell></TableRow>}
              {outstanding.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <Link to="/due-bills" className="text-primary hover:underline">{s.invoice_no}</Link>
                  </TableCell>
                  <TableCell>{dayKey(s.created_at)}</TableCell>
                  <TableCell>
                    <div>{s.pet_owners?.full_name || "Walk-in"}</div>
                    {s.pet_owners?.phone && <div className="text-xs text-muted-foreground">{s.pet_owners.phone}</div>}
                  </TableCell>
                  <TableCell className="text-right">{fmt(s.total)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmt(s.paid)}</TableCell>
                  <TableCell className="text-right font-semibold text-amber-600">{fmt(s.due)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
