import { supabase } from "@/integrations/supabase/client";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import {
  aggregateCustomerStats,
  customerKey,
  daysBetweenLastTwo,
  isCountableSale,
  normalizePhone,
  summarizeByPeriod,
  type CustomerStat,
  type OwnerLite,
  type PeriodCustomerSummary,
  type SaleLite,
} from "@/lib/customer-insights";

export type CustomerMixRow = {
  key: string;
  ownerId: string;
  name: string;
  phone: string | null;
  gender: "male" | "female" | "unknown";
  type: "new" | "repeat";
  ordersInRange: number;
  amountInRange: number;
  firstPurchase: string;
  lastPurchase: string;
  lifetimeOrders: number;
  lifetimeAmount: number;
  /** Days between the customer's last two purchases (null for first-timers). */
  gapDays: number | null;
};

export type GenderSummary = {
  gender: "male" | "female" | "unknown";
  total: number;
  newCustomers: number;
  repeatCustomers: number;
  repeatRate: number;
  amount: number;
};

export type CustomerMix = {
  total: number;
  newCustomers: number;
  repeatCustomers: number;
  repeatRate: number;
  newAmount: number;
  repeatAmount: number;
  rows: CustomerMixRow[];
  daily: PeriodCustomerSummary[];
  monthly: PeriodCustomerSummary[];
  byGender: GenderSummary[];
};

const EMPTY: CustomerMix = {
  total: 0, newCustomers: 0, repeatCustomers: 0, repeatRate: 0,
  newAmount: 0, repeatAmount: 0, rows: [], daily: [], monthly: [], byGender: [],
};

/**
 * New vs repeat customer mix for a date range.
 *
 * Customers are matched by mobile number (falling back to the customer id), so
 * duplicate account rows sharing a phone are treated as one person and never
 * counted as "new" twice.
 */
export async function fetchCustomerMix(fromISO: string, toISO: string): Promise<CustomerMix> {
  const rangeSales = await fetchAll(() => supabase
    .from("sales")
    .select("id,owner_id,created_at,total,status")
    .gte("created_at", fromISO)
    .lte("created_at", toISO)
    .not("owner_id", "is", null)
    .order("id"), 200000);

  const inRange = (rangeSales ?? []).filter(isCountableSale) as SaleLite[];
  if (inRange.length === 0) return EMPTY;

  const ownerIds = Array.from(new Set(inRange.map((s) => s.owner_id as string)));
  // Chunked: hundreds of ids in one URL made the request fail outright.
  const owners = await fetchAllIn<OwnerLite>(ownerIds, (c) => supabase
    .from("pet_owners")
    .select("id,full_name,phone,gender")
    .in("id", c)
    .order("id"));

  // Pull sibling accounts that share a phone number with any of these owners.
  const phones = Array.from(
    new Set((owners ?? []).map((o) => o.phone).filter((p): p is string => !!p && normalizePhone(p) !== "")),
  );
  let allOwners: OwnerLite[] = (owners ?? []) as OwnerLite[];
  if (phones.length) {
    const siblings = await fetchAllIn<OwnerLite>(phones, (c) => supabase
      .from("pet_owners")
      .select("id,full_name,phone,gender")
      .in("phone", c)
      .order("id"));
    const byId = new Map(allOwners.map((o) => [o.id, o]));
    (siblings ?? []).forEach((o) => byId.set(o.id, o as OwnerLite));
    allOwners = Array.from(byId.values());
  }

  const keyByOwnerId = new Map<string, string>();
  allOwners.forEach((o) => keyByOwnerId.set(o.id, customerKey(o)));
  ownerIds.forEach((id) => { if (!keyByOwnerId.has(id)) keyByOwnerId.set(id, `c:${id}`); });

  // Lifetime history for every involved account (needed to know who is new).
  const historySales = await fetchAllIn(Array.from(keyByOwnerId.keys()), (c) => supabase
    .from("sales")
    .select("id,owner_id,created_at,total,status")
    .in("owner_id", c)
    .order("id"));

  const history = (historySales ?? []).filter(isCountableSale) as SaleLite[];
  const stats = aggregateCustomerStats(history, keyByOwnerId);
  const ownerById = new Map(allOwners.map((o) => [o.id, o]));

  const rangeAgg = new Map<string, { orders: number; amount: number; ownerId: string }>();
  inRange.forEach((s) => {
    const key = keyByOwnerId.get(s.owner_id as string) ?? `c:${s.owner_id}`;
    const cur = rangeAgg.get(key) ?? { orders: 0, amount: 0, ownerId: s.owner_id as string };
    cur.orders += 1;
    cur.amount += Number(s.total || 0);
    rangeAgg.set(key, cur);
  });

  const rows: CustomerMixRow[] = Array.from(rangeAgg.entries()).map(([key, agg]) => {
    const stat = stats.get(key) as CustomerStat | undefined;
    const owner = ownerById.get(agg.ownerId);
    // Repeat = has bought more than once (before or inside the range).
    const isNew = !!stat && stat.firstPurchase >= fromISO && stat.firstPurchase <= toISO && stat.orders <= 1;

    return {
      key,
      ownerId: agg.ownerId,
      name: owner?.full_name ?? "Customer",
      phone: owner?.phone ?? null,
      gender: ((owner as any)?.gender === "male" || (owner as any)?.gender === "female"
        ? (owner as any).gender
        : "unknown") as "male" | "female" | "unknown",
      type: (isNew ? "new" : "repeat") as "new" | "repeat",
      ordersInRange: agg.orders,
      amountInRange: agg.amount,
      firstPurchase: stat?.firstPurchase ?? "",
      lastPurchase: stat?.lastPurchase ?? "",
      lifetimeOrders: stat?.orders ?? agg.orders,
      lifetimeAmount: stat?.amount ?? agg.amount,
      gapDays: daysBetweenLastTwo(stat),
    };
  }).sort((a, b) => b.amountInRange - a.amountInRange);

  const newCustomers = rows.filter((r) => r.type === "new").length;
  const repeatCustomers = rows.length - newCustomers;

  return {
    total: rows.length,
    newCustomers,
    repeatCustomers,
    repeatRate: rows.length ? (repeatCustomers / rows.length) * 100 : 0,
    newAmount: rows.filter((r) => r.type === "new").reduce((a, r) => a + r.amountInRange, 0),
    repeatAmount: rows.filter((r) => r.type === "repeat").reduce((a, r) => a + r.amountInRange, 0),
    rows,
    byGender: summarizeByGender(rows),
    daily: summarizeByPeriod(history, keyByOwnerId, "day", { fromISO, toISO }),
    monthly: summarizeByPeriod(history, keyByOwnerId, "month", { fromISO, toISO }),
  };
}

/** Split range customers into male / female / unknown buckets with repeat rates. */
export function summarizeByGender(rows: CustomerMixRow[]): GenderSummary[] {
  const order: GenderSummary["gender"][] = ["male", "female", "unknown"];
  return order
    .map((gender) => {
      const g = rows.filter((r) => r.gender === gender);
      const repeatCustomers = g.filter((r) => r.type === "repeat").length;
      return {
        gender,
        total: g.length,
        newCustomers: g.length - repeatCustomers,
        repeatCustomers,
        repeatRate: g.length ? (repeatCustomers / g.length) * 100 : 0,
        amount: g.reduce((a, r) => a + r.amountInRange, 0),
      };
    })
    .filter((g) => g.gender !== "unknown" || g.total > 0);
}

/** Lifetime profile stats for one customer, matched by phone across duplicates. */
export async function fetchCustomerProfileStats(ownerId: string, phone?: string | null) {
  const ids = new Set<string>([ownerId]);
  const normalized = normalizePhone(phone);
  if (normalized && phone) {
    const siblings = await fetchAll<{ id: string; phone: string | null }>(
      () => supabase.from("pet_owners").select("id,phone").not("phone", "is", null).order("id"),
      200000,
    );
    (siblings ?? []).forEach((o) => {
      if (normalizePhone(o.phone) === normalized) ids.add(o.id);
    });
  }
  const sales = await fetchAllIn(Array.from(ids), (c) => supabase
    .from("sales")
    .select("id,owner_id,created_at,total,status")
    .in("owner_id", c)
    .order("id"));

  const keyByOwnerId = new Map<string, string>();
  ids.forEach((id) => keyByOwnerId.set(id, normalized ? `p:${normalized}` : `c:${ownerId}`));
  const stats = aggregateCustomerStats((sales ?? []).filter(isCountableSale) as SaleLite[], keyByOwnerId);
  const stat = Array.from(stats.values())[0];
  if (!stat) return null;
  return {
    firstPurchase: stat.firstPurchase,
    lastPurchase: stat.lastPurchase,
    orders: stat.orders,
    amount: stat.amount,
    type: stat.orders > 1 ? ("repeat" as const) : ("new" as const),
    gapDays: daysBetweenLastTwo(stat),
    linkedAccounts: ids.size,
  };
}
