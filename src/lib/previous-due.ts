// A customer's unpaid older bills. When a new bill is made, the extra the customer
// pays clears these oldest-first through the normal due collection (same cash
// drawer entries as Due Bills), so nothing is counted twice.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type OpenBill = { id: string; invoice_no: string; created_at: string; due: number };

export async function fetchOpenBills(ownerId: string, excludeSaleId?: string | null): Promise<OpenBill[]> {
  let q = db
    .from("sales")
    .select("id,invoice_no,created_at,due,status")
    .eq("owner_id", ownerId)
    .gt("due", 0.009)
    .not("status", "in", "(void,refunded)")
    .order("created_at", { ascending: true })
    .order("id");
  if (excludeSaleId) q = q.neq("id", excludeSaleId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((s: any) => ({ id: s.id, invoice_no: s.invoice_no, created_at: s.created_at, due: Number(s.due) }));
}

/** Previous due of a customer (0 for walk-in). */
export function usePreviousDue(ownerId: string | null | undefined) {
  const q = useQuery({
    queryKey: ["previous-due", ownerId],
    enabled: !!ownerId,
    staleTime: 0,
    queryFn: () => fetchOpenBills(ownerId!),
  });
  const bills = ownerId ? q.data ?? [] : [];
  return { bills, total: r2(bills.reduce((a, b) => a + b.due, 0)), loading: q.isLoading && !!ownerId };
}

export type PrevDueResult = { before: number; paid: number; after: number; invoices: { invoice_no: string; amount: number }[] };

/**
 * Put `payments` against the customer's older bills, oldest first.
 * Each payment keeps its own method (cash goes to the drawer, bKash to bKash …).
 */
export async function payPreviousDues(
  ownerId: string,
  payments: { method: string; amount: number }[],
  excludeSaleId: string | null,
  forInvoice: string,
): Promise<PrevDueResult> {
  const bills = await fetchOpenBills(ownerId, excludeSaleId);
  const before = r2(bills.reduce((a, b) => a + b.due, 0));
  const invoices: { invoice_no: string; amount: number }[] = [];
  let paid = 0;
  let i = 0;
  for (const p of payments) {
    let left = r2(p.amount);
    while (left > 0.009 && i < bills.length) {
      const b = bills[i];
      const amt = r2(Math.min(left, b.due));
      if (amt > 0.009) {
        const { error } = await db.rpc("collect_sale_due", {
          _sale_id: b.id,
          _amount: amt,
          _method: p.method,
          _reference: `Paid with ${forInvoice}`,
        });
        if (error) throw new Error(`Could not take ${amt} against ${b.invoice_no}: ${error.message}`);
        b.due = r2(b.due - amt);
        left = r2(left - amt);
        paid = r2(paid + amt);
        const row = invoices.find((x) => x.invoice_no === b.invoice_no);
        if (row) row.amount = r2(row.amount + amt);
        else invoices.push({ invoice_no: b.invoice_no, amount: amt });
      }
      if (b.due <= 0.009) i++;
    }
  }
  return { before, paid, after: r2(before - paid), invoices };
}

/**
 * Split what the customer hands over: this bill first, the rest to older dues
 * (up to what is owed). Returns per-method amounts for each part.
 */
export function splitPayments(payments: { method: string; amount: number }[], billTotal: number, prevDue: number) {
  let billLeft = r2(billTotal);
  let oldLeft = r2(prevDue);
  const bill: { method: string; amount: number }[] = [];
  const old: { method: string; amount: number }[] = [];
  let change = 0;
  for (const p of payments) {
    let a = r2(Math.max(0, p.amount));
    const toBill = r2(Math.min(a, billLeft));
    if (toBill > 0) bill.push({ method: p.method, amount: toBill });
    billLeft = r2(billLeft - toBill);
    a = r2(a - toBill);
    const toOld = r2(Math.min(a, oldLeft));
    if (toOld > 0) old.push({ method: p.method, amount: toOld });
    oldLeft = r2(oldLeft - toOld);
    change = r2(change + a - toOld);
  }
  return { bill, old, change, billPaid: r2(billTotal - billLeft), oldPaid: r2(prevDue - oldLeft) };
}
