/**
 * New vs Repeat customer tracking.
 *
 * Identity rule: customers are matched by normalised mobile number when one
 * exists, otherwise by customer id. This keeps one person from being counted
 * as "new" again when a duplicate account row was created for them.
 */

export type OwnerLite = { id: string; phone?: string | null; full_name?: string | null };
export type SaleLite = {
  id: string;
  owner_id: string | null;
  created_at: string;
  total: number | string;
  status?: string | null;
};

const VOID_STATUSES = new Set(["void", "refunded"]);

/** Keep digits only and drop a leading country code so 8801X… === 01X…. */
export function normalizePhone(phone?: string | null): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 11 && digits.startsWith("880")) return `0${digits.slice(3)}`;
  return digits;
}

/** Stable identity key for a customer: phone when available, else the row id. */
export function customerKey(owner: OwnerLite | undefined | null, ownerId?: string | null): string {
  const phone = normalizePhone(owner?.phone);
  if (phone) return `p:${phone}`;
  const id = owner?.id ?? ownerId;
  return id ? `c:${id}` : "";
}

export function buildKeyByOwnerId(owners: OwnerLite[]): Map<string, string> {
  const m = new Map<string, string>();
  owners.forEach((o) => m.set(o.id, customerKey(o)));
  return m;
}

export function isCountableSale(s: SaleLite) {
  return !!s.owner_id && !VOID_STATUSES.has(String(s.status ?? ""));
}

export type CustomerStat = {
  key: string;
  firstPurchase: string;
  lastPurchase: string;
  orders: number;
  amount: number;
  /** All purchase timestamps, oldest first. */
  dates: string[];
};

/** Aggregate lifetime stats per customer identity from a sales list. */
export function aggregateCustomerStats(
  sales: SaleLite[],
  keyByOwnerId: Map<string, string>,
): Map<string, CustomerStat> {
  const m = new Map<string, CustomerStat>();
  sales.filter(isCountableSale).forEach((s) => {
    const key = keyByOwnerId.get(s.owner_id as string) ?? `c:${s.owner_id}`;
    const cur =
      m.get(key) ??
      ({ key, firstPurchase: s.created_at, lastPurchase: s.created_at, orders: 0, amount: 0, dates: [] } as CustomerStat);
    cur.orders += 1;
    cur.amount += Number(s.total || 0);
    if (s.created_at < cur.firstPurchase) cur.firstPurchase = s.created_at;
    if (s.created_at > cur.lastPurchase) cur.lastPurchase = s.created_at;
    cur.dates.push(s.created_at);
    m.set(key, cur);
  });
  m.forEach((v) => v.dates.sort());
  return m;
}

/** Local (device timezone) day bucket, e.g. 2026-08-14. */
export function localDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function localMonthKey(iso: string | Date): string {
  return localDayKey(iso).slice(0, 7);
}

export type PeriodCustomerSummary = {
  period: string;
  total: number;
  newCustomers: number;
  repeatCustomers: number;
  repeatRate: number;
  newAmount: number;
  repeatAmount: number;
};

/**
 * Bucket sales into periods and split them into new vs repeat purchases.
 *
 * Classification is per sale: a customer's very first purchase ever is a "new"
 * purchase, every later purchase is a "repeat" purchase. So a customer who
 * bought for the first time this month and came back again in the same month
 * counts once in New and once in Repeat (Total counts them once).
 */
export function summarizeByPeriod(
  sales: SaleLite[],
  keyByOwnerId: Map<string, string>,
  granularity: "day" | "month",
  range?: { fromISO: string; toISO: string },
): PeriodCustomerSummary[] {
  const stats = aggregateCustomerStats(sales, keyByOwnerId);
  const bucket = granularity === "day" ? localDayKey : localMonthKey;
  const periods = new Map<
    string,
    { all: Set<string>; newSet: Set<string>; repeatSet: Set<string>; newAmt: number; repAmt: number }
  >();

  sales.filter(isCountableSale).forEach((s) => {
    if (range && (s.created_at < range.fromISO || s.created_at > range.toISO)) return;
    const key = keyByOwnerId.get(s.owner_id as string) ?? `c:${s.owner_id}`;
    const stat = stats.get(key);
    if (!stat) return;
    const p = bucket(s.created_at);
    const cur =
      periods.get(p) ??
      { all: new Set<string>(), newSet: new Set<string>(), repeatSet: new Set<string>(), newAmt: 0, repAmt: 0 };
    cur.all.add(key);
    // Only the customer's very first purchase ever is a "new" purchase.
    const isFirstEver = s.created_at === stat.firstPurchase;
    if (isFirstEver) {
      cur.newSet.add(key);
      cur.newAmt += Number(s.total || 0);
    } else {
      cur.repeatSet.add(key);
      cur.repAmt += Number(s.total || 0);
    }
    periods.set(p, cur);
  });

  return Array.from(periods.entries())
    .map(([period, v]) => {
      const total = v.all.size;
      return {
        period,
        total,
        newCustomers: v.newSet.size,
        repeatCustomers: v.repeatSet.size,
        repeatRate: total > 0 ? (v.repeatSet.size / total) * 100 : 0,
        newAmount: v.newAmt,
        repeatAmount: v.repAmt,
      };
    })
    .sort((a, b) => b.period.localeCompare(a.period));
}


/** Gap in days between the last two purchases of a customer. */
export function daysBetweenLastTwo(stat: CustomerStat | undefined): number | null {
  if (!stat || stat.dates.length < 2) return null;
  const last = new Date(stat.dates[stat.dates.length - 1]).getTime();
  const prev = new Date(stat.dates[stat.dates.length - 2]).getTime();
  return Math.round((last - prev) / 86_400_000);
}

export function daysSince(iso: string | undefined | null): number | null {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
