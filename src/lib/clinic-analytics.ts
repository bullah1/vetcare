/**
 * Pure helpers for the clinic-only analytics dashboard.
 * No shop / POS / inventory data is touched here.
 */
import { dhakaDayKey, shiftDay } from "@/lib/sales-summary";

export type RangePreset = "today" | "7d" | "month" | "last_month" | "custom";

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  "7d": "7 Days",
  month: "This Month",
  last_month: "Last Month",
  custom: "Custom",
};

export const todayKey = () => dhakaDayKey(new Date());

/** Inclusive day-key range (YYYY-MM-DD) for a preset. */
export function presetRange(preset: RangePreset): { from: string; to: string } {
  const today = todayKey();
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: shiftDay(today, -6), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const pm = m === 1 ? 12 : m - 1;
      const py = m === 1 ? y - 1 : y;
      const mm = String(pm).padStart(2, "0");
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, "0")}` };
    }
    default:
      return { from: today, to: today };
  }
}

/** All day keys from -> to, inclusive. */
export function dayKeysBetween(from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to && out.length < cap) {
    out.push(d);
    d = shiftDay(d, 1);
  }
  return out;
}

export const inRange = (iso: string | null | undefined, from: string, to: string) => {
  if (!iso) return false;
  const k = dhakaDayKey(iso);
  return k >= from && k <= to;
};

export type Counted = { name: string; count: number };

/** Frequency table sorted high -> low. */
export function topCounts(values: (string | null | undefined)[], limit = 6): Counted[] {
  const m = new Map<string, number>();
  for (const raw of values) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  return Array.from(m, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export const SPECIES_LABELS: Record<string, string> = {
  dog: "Dog",
  cat: "Cat",
  bird: "Bird",
  cow: "Cow",
  goat: "Goat",
  rabbit: "Rabbit",
  other: "Other",
};

export const speciesLabel = (s?: string | null) => SPECIES_LABELS[String(s ?? "other")] ?? "Other";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Dhaka-local weekday index and hour for an ISO timestamp. */
export function dhakaParts(iso: string): { weekday: number; hour: number } {
  const shifted = new Date(new Date(iso).getTime() + 6 * 60 * 60 * 1000);
  return { weekday: shifted.getUTCDay(), hour: shifted.getUTCHours() };
}

export const money = (n: number) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n || 0);

export const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
