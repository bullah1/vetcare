// Single source of truth for sales money math across Dashboard, Reports and
// Sales History. Every surface MUST use these helpers so no invoice, payment or
// refund is silently dropped or double counted.
//
// Rules:
//  - "refunded" and "void" (cancelled) invoices STAY counted on their original
//    day; the whole invoice value is reversed on the refund/cancellation day.
//    The cash part is the sale_returns.refund_amount, the rest is a due
//    write-off — both together equal the invoice gross, otherwise reversed
//    credit sales leave phantom revenue behind (this was the ৳ mismatch
//    between Reports and Sales History).
//  - Net Sales = Invoice Sales (valid invoices) − reversals/refunds by their own
//    processing date.

export const DEAD_STATUSES = new Set(["refunded"]);
export const VALID_STATUSES = new Set(["completed", "partial_refund"]);

export const grossOf = (s: any) =>
  s?.total != null ? Number(s.total) : Number(s?.subtotal || 0) - Number(s?.discount || 0);

/**
 * Reversal value to report on the refund/cancellation date.
 * For a cancelled invoice the whole invoice value reverses (cash + due write-off);
 * `seen` makes sure a void invoice is only reversed once even with several rows.
 */
export function reversalAmount(
  ret: { sale_id: string; refund_amount: number | string | null },
  sale: any | undefined,
  seen: Set<string>,
): number {
  const refund = Number(ret.refund_amount || 0);
  if (sale?.status !== "void" && sale?.status !== "refunded") return refund;
  if (seen.has(ret.sale_id)) return 0;
  seen.add(ret.sale_id);
  return grossOf(sale);
}

/** Today's business date (YYYY-MM-DD) in Dhaka, independent of device timezone.
 *  `new Date().toISOString().slice(0, 10)` is the UTC date, which is still
 *  "yesterday" in Bangladesh between 12:00 AM and 6:00 AM. */
export const todayDhaka = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

/** First day (YYYY-MM-01) of the current Dhaka month. */
export const monthStartDhaka = (): string => `${todayDhaka().slice(0, 7)}-01`;

/** Dhaka (UTC+6) business-day boundaries for a YYYY-MM-DD range. */
export const dayRangeISO = (from: string, to: string) => ({
  fromISO: new Date(`${from}T00:00:00+06:00`).toISOString(),
  toISO: new Date(`${to}T23:59:59.999+06:00`).toISOString(),
});

/**
 * Invoices that must be dropped from Invoice Sales completely: "refunded" or
 * cancelled ("void") invoices that have NO reversal row in the data set
 * (older reversals of unpaid credit sales). Without this they stayed in
 * gross sales forever with nothing reversing them — that was the phantom
 * revenue that made Reports disagree with Sales History.
 * Reversed invoices that DO have a reversal row stay counted on their
 * original day and are reversed at full value on the refund/cancellation day.
 */
export function deadSaleIds(sales: any[], returns: { sale_id: string }[]): Set<string> {
  const reversed = new Set(returns.map((r) => r.sale_id));
  const dead = new Set<string>();
  for (const s of sales) {
    if ((DEAD_STATUSES.has(s.status) || s.status === "void") && !reversed.has(s.id)) dead.add(s.id);
  }
  return dead;
}
