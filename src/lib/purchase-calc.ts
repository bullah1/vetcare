// Purchase line + invoice maths. Pure functions, no React — tested in purchase-calc.test.ts.
//
// A line keeps three text fields (qty, unit price, total) and remembers which
// price field the user typed last (`source`). That field is the truth; the other
// one is derived from it. Changing the quantity re-derives the other field from
// the source, so typing never loops and nothing is rounded twice.

export type PriceSource = "unit" | "total";
export type AmountKind = "amt" | "pct";

export type LineInput = {
  quantity: string;
  unit_price: string;
  total: string;
  source: PriceSource;
  disc_value: string;
  disc_kind: AmountKind;
};

/** Parses user text ("1,250.5", " 10 ") → number, or null when empty / invalid / negative. */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[,\s৳]/g, "");
  if (s === "" || s === "." || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Text for a derived money field: up to `dp` decimals, trailing zeros trimmed. */
export function fmtField(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toFixed(dp)));
}

/** Derived field after the quantity changes. */
export function onQuantity(line: LineInput, quantity: string): LineInput {
  const q = num(quantity);
  if (line.source === "total") {
    const t = num(line.total);
    return { ...line, quantity, unit_price: q && t !== null ? fmtField(t / q, 4) : "" };
  }
  const u = num(line.unit_price);
  return { ...line, quantity, total: q !== null && u !== null ? fmtField(q * u, 2) : "" };
}

export function onUnitPrice(line: LineInput, unit_price: string): LineInput {
  const q = num(line.quantity);
  const u = num(unit_price);
  return { ...line, unit_price, source: "unit", total: q !== null && u !== null ? fmtField(q * u, 2) : "" };
}

export function onTotal(line: LineInput, total: string): LineInput {
  const q = num(line.quantity);
  const t = num(total);
  return { ...line, total, source: "total", unit_price: q && t !== null ? fmtField(t / q, 4) : "" };
}

/** Exact per-unit price to save. From a typed total it is total ÷ qty unrounded,
 *  so qty × price on the server gives back exactly the typed total. */
export function exactUnitPrice(line: LineInput): number {
  const q = num(line.quantity) ?? 0;
  if (line.source === "total") {
    const t = num(line.total) ?? 0;
    return q > 0 ? Number((t / q).toPrecision(15)) : 0;
  }
  return num(line.unit_price) ?? 0;
}

/** Gross (before item discount), item discount and final amount for one line. */
export function lineAmounts(line: LineInput) {
  const q = num(line.quantity) ?? 0;
  const gross = line.source === "total" ? (q > 0 ? num(line.total) ?? 0 : 0) : q * (num(line.unit_price) ?? 0);
  const discount = applyAmount(gross, line.disc_value, line.disc_kind);
  return { gross, discount, final: gross - discount };
}

/** A fixed amount or a percentage of `base`, never below 0 nor above `base`. */
export function applyAmount(base: number, value: string, kind: AmountKind): number {
  const v = num(value) ?? 0;
  const amt = kind === "pct" ? (base * Math.min(v, 100)) / 100 : v;
  return round2(Math.max(0, Math.min(amt, Math.max(base, 0))));
}

/** VAT / charges: a fixed amount or a percentage of `base` (no upper cap). */
export function addAmount(base: number, value: string, kind: AmountKind): number {
  const v = num(value) ?? 0;
  return round2(kind === "pct" ? (Math.max(base, 0) * v) / 100 : v);
}

export type InvoiceTotalsInput = {
  overall_disc_value: string; overall_disc_kind: AmountKind;
  vat_value: string; vat_kind: AmountKind;
  charges: string;
};

/**
 * Invoice totals, in this order (same as the server):
 *   gross − item discounts = subtotal
 *   subtotal − overall discount = taxable
 *   taxable + VAT + additional charges = net payable
 * Each discount is applied once.
 */
export function invoiceTotals(lines: LineInput[], t: InvoiceTotalsInput) {
  let gross = 0;
  let itemDiscount = 0;
  for (const l of lines) {
    const a = lineAmounts(l);
    gross += a.gross;
    itemDiscount += a.discount;
  }
  const subtotal = gross - itemDiscount;
  const overallDiscount = applyAmount(subtotal, t.overall_disc_value, t.overall_disc_kind);
  const taxable = subtotal - overallDiscount;
  const vat = addAmount(taxable, t.vat_value, t.vat_kind);
  const charges = round2(num(t.charges) ?? 0);
  const net = round2(taxable + vat + charges);
  return {
    gross: round2(gross), itemDiscount: round2(itemDiscount), subtotal: round2(subtotal),
    overallDiscount, taxable: round2(taxable), vat, charges, net,
  };
}

/** Problem with a line, or null when it can be saved. */
export function lineError(line: LineInput): string | null {
  const q = num(line.quantity);
  if (q === null || q <= 0) return "Enter a quantity above 0";
  if (line.source === "total" ? num(line.total) === null : num(line.unit_price) === null) return "Enter the price";
  if (line.disc_value.trim() !== "" && num(line.disc_value) === null) return "Discount is not a number";
  return null;
}
