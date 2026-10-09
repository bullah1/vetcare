import { dayRangeISO } from "./sales-ledger";

/** Calendar keys never depend on the device's timezone. */
export function dhakaDayKey(value: Date | string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type Money = number | string | null;
type Sale = { id: string; total: Money; created_at: string };
type CostLine = { quantity: Money; cost_price?: Money; products?: { purchase_price: Money } | null };
type Item = CostLine & { sale_id: string };
type ReturnLine = { quantity: Money; sale_items: Omit<CostLine, "quantity"> | null };
type Return = { id: string; refund_amount: Money; created_at: string; sale_return_items?: ReturnLine[] | null };
export type SalesDay = { gross: number; refund: number; rev: number; cogs: number };

const costOf = (line: Omit<CostLine, "quantity">) =>
  Number(line.cost_price || 0) > 0 ? Number(line.cost_price) : Number(line.products?.purchase_price || 0);
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Immutable invoices on sale date; each authoritative return value and its line
 * cost on processing date. Current status never rewrites prior-period revenue.
 * In particular, fetching an old invoice for a return cannot add new gross sales.
 */
export function summarizeSales(sales: Sale[], items: Item[], returns: Return[], from: string, to: string) {
  const { fromISO, toISO } = dayRangeISO(from, to);
  const inRange = (date: string) => {
    const time = new Date(date).getTime();
    return time >= Date.parse(fromISO) && time <= Date.parse(toISO);
  };
  const daily = new Map<string, SalesDay>();
  const getDay = (date: string) => {
    const key = dhakaDayKey(date);
    let row = daily.get(key);
    if (!row) { row = { gross: 0, refund: 0, rev: 0, cogs: 0 }; daily.set(key, row); }
    return row;
  };
  const saleDates = new Map<string, string>();
  for (const sale of sales) {
    if (!inRange(sale.created_at) || saleDates.has(sale.id)) continue;
    saleDates.set(sale.id, sale.created_at);
    getDay(sale.created_at).gross += Number(sale.total || 0);
  }
  for (const item of items) {
    const date = saleDates.get(item.sale_id);
    if (date) getDay(date).cogs += Number(item.quantity || 0) * costOf(item);
  }
  const seenReturns = new Set<string>();
  for (const ret of returns) {
    if (!inRange(ret.created_at) || seenReturns.has(ret.id)) continue;
    seenReturns.add(ret.id);
    const row = getDay(ret.created_at);
    row.refund += Number(ret.refund_amount || 0);
    for (const item of ret.sale_return_items ?? []) {
      if (item.sale_items) row.cogs -= Number(item.quantity || 0) * costOf(item.sale_items);
    }
  }
  const totals: SalesDay = { gross: 0, refund: 0, rev: 0, cogs: 0 };
  for (const row of daily.values()) {
    row.gross = roundMoney(row.gross);
    row.refund = roundMoney(row.refund);
    row.cogs = roundMoney(row.cogs);
    row.rev = roundMoney(row.gross - row.refund);
    for (const key of ["gross", "refund", "rev", "cogs"] as const) totals[key] = roundMoney(totals[key] + row[key]);
  }
  return { daily, totals };
}