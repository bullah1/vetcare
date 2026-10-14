// Product-wise sales analysis. Everything comes from the same invoice data as
// Sales History and the Business Report: sales, sale_items, payments, returns.
//  - Sales lines: invoices made in the period (invoice date).
//  - Collection: payments received in the period (payment date), spread over the
//    lines of the invoice they belong to.
import { supabase } from "@/integrations/supabase/client";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import { withSchemaFallback } from "@/lib/schema-fallback";
import { dayRangeISO } from "@/lib/sales-ledger";
import { dhakaDayKey } from "@/lib/sales-summary";

const db = supabase as any;
const n = (v: unknown) => Number(v || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", bkash: "bKash", nagad: "Nagad", rocket: "Rocket", card: "Card", bank: "Bank", due: "Due",
};

type SaleRow = {
  id: string; invoice_no: string; created_at: string; status: string; source?: string | null;
  subtotal: number; discount: number; tax: number; total: number; paid: number; due: number;
  cashier_id: string | null; owner_id: string | null;
  owner: { full_name: string; phone: string | null } | null;
};
type ItemRow = {
  id: string; sale_id: string; product_id: string | null; name: string; quantity: number; unit_price: number;
  discount: number; tax: number; line_total: number; cost_price: number | null; returned_quantity: number | null;
  item_type?: string | null; list_price?: number | null; price_overridden?: boolean | null;
  product: { sku: string | null; category: string | null } | null;
};
type PayRow = { id: string; sale_id: string; method: string; amount: number; received_at: string; return_id?: string | null };

export type Line = {
  id: string; saleId: string; date: string; day: string; month: string; invoiceNo: string; status: string;
  productId: string | null; product: string; sku: string; category: string; type: string;
  qty: number; returnedQty: number; unitPrice: number; listPrice: number | null; priceChanged: boolean;
  lineDiscount: number; invoiceDiscount: number; gross: number; net: number; returnedValue: number; netAfterReturn: number;
  cost: number; profit: number; customer: string; customerPhone: string; employee: string; employeeId: string | null;
  methods: string[]; invoiceDue: number;
};

export type ProductSalesData = Awaited<ReturnType<typeof loadProductSales>>;

async function itemsFor(saleIds: string[]) {
  const base = "id,sale_id,product_id,name,quantity,unit_price,discount,tax,line_total,cost_price,returned_quantity, product:products(sku,category)";
  return withSchemaFallback(
    "sale_items.list_price",
    () => fetchAllIn<ItemRow>(saleIds, (ids) => db.from("sale_items").select(`${base},item_type,list_price,price_overridden`).in("sale_id", ids).order("id")),
    () => fetchAllIn<ItemRow>(saleIds, (ids) => db.from("sale_items").select(base).in("sale_id", ids).order("id")),
  );
}

export async function loadProductSales(from: string, to: string) {
  const { fromISO, toISO } = dayRangeISO(from, to);
  const saleCols = "id,invoice_no,created_at,status,subtotal,discount,tax,total,paid,due,cashier_id,owner_id, owner:pet_owners(full_name,phone)";
  const [sales, periodPays] = await Promise.all([
    fetchAll<SaleRow>(() => db.from("sales").select(saleCols).gte("created_at", fromISO).lte("created_at", toISO).order("created_at").order("id")),
    fetchAll<PayRow>(() => db.from("payments").select("id,sale_id,method,amount,received_at,return_id").gte("received_at", fromISO).lte("received_at", toISO).order("received_at").order("id")),
  ]);
  // Invoices paid in the period but made earlier are needed for the collection report.
  const known = new Set(sales.map((s) => s.id));
  const olderIds = [...new Set(periodPays.map((p) => p.sale_id).filter((id) => !known.has(id)))];
  const older = olderIds.length
    ? await fetchAllIn<SaleRow>(olderIds, (ids) => db.from("sales").select(saleCols).in("id", ids).order("id"))
    : [];
  const allSales = [...sales, ...older];
  const allIds = allSales.map((s) => s.id);
  const [items, salePays, profiles] = await Promise.all([
    itemsFor(allIds),
    fetchAllIn<PayRow>(sales.map((s) => s.id), (ids) => db.from("payments").select("id,sale_id,method,amount,received_at,return_id").in("sale_id", ids).order("id")),
    db.from("profiles").select("id,full_name").then((r: any) => (r.data ?? []) as { id: string; full_name: string | null }[]) as Promise<{ id: string; full_name: string | null }[]>,
  ]);
  return { from, to, sales, older, items, salePays, periodPays, profiles };
}

export type Filters = {
  product: string; category: string; invoice: string; customer: string; employee: string; method: string;
};
export const EMPTY_FILTERS: Filters = { product: "", category: "all", invoice: "", customer: "", employee: "all", method: "all" };

const CANCELLED = new Set(["void", "refunded"]);

export function computeProductSales(d: ProductSalesData, f: Filters) {
  const empName = new Map<string, string>((d.profiles as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || "Staff"]));
  const saleById = new Map([...d.sales, ...d.older].map((s) => [s.id, s]));
  const itemsBySale = new Map<string, ItemRow[]>();
  for (const it of d.items) {
    const list = itemsBySale.get(it.sale_id) ?? [];
    list.push(it);
    itemsBySale.set(it.sale_id, list);
  }
  const methodsBySale = new Map<string, Set<string>>();
  for (const p of d.salePays) {
    if (n(p.amount) <= 0) continue;
    const set = methodsBySale.get(p.sale_id) ?? new Set<string>();
    set.add(p.method);
    methodsBySale.set(p.sale_id, set);
  }
  const employeeOf = (s: SaleRow) => (s.cashier_id ? empName.get(s.cashier_id) ?? "Staff" : "—");

  // Share of the invoice discount and of each payment for every line.
  const shareOf = (s: SaleRow) => {
    const list = itemsBySale.get(s.id) ?? [];
    const sum = list.reduce((a, it) => a + n(it.line_total), 0);
    return (it: ItemRow) => (sum > 0 ? n(it.line_total) / sum : list.length ? 1 / list.length : 0);
  };

  const pq = f.product.trim().toLowerCase();
  const iq = f.invoice.trim().toLowerCase();
  const cq = f.customer.trim().toLowerCase();
  const lineMatches = (l: Line) =>
    (!pq || l.product.toLowerCase().includes(pq) || l.sku.toLowerCase().includes(pq)) &&
    (f.category === "all" || l.category === f.category) &&
    (!iq || l.invoiceNo.toLowerCase().includes(iq)) &&
    (!cq || l.customer.toLowerCase().includes(cq) || l.customerPhone.includes(cq)) &&
    (f.employee === "all" || l.employeeId === f.employee) &&
    (f.method === "all" || (f.method === "due" ? l.invoiceDue > 0.009 : l.methods.includes(f.method)));

  const makeLine = (s: SaleRow, it: ItemRow, share: (it: ItemRow) => number): Line => {
    const qty = n(it.quantity);
    const cancelled = CANCELLED.has(s.status);
    const returnedQty = cancelled ? qty : Math.min(qty, n(it.returned_quantity));
    const gross = n(it.line_total);
    const invoiceDiscount = n(s.discount) * share(it);
    const net = gross - invoiceDiscount;
    const perUnitNet = qty > 0 ? net / qty : 0;
    const returnedValue = returnedQty * perUnitNet;
    const unitCost = n(it.cost_price);
    const keptQty = qty - returnedQty;
    const type = it.product_id ? "Product" : it.item_type === "consultation" ? "Consultation" : it.item_type === "service" ? "Service" : it.name === "Delivery charge" ? "Delivery" : "Service";
    const methods = [...(methodsBySale.get(s.id) ?? [])];
    if (n(s.due) > 0.009 && !cancelled) methods.push("due");
    return {
      id: it.id, saleId: s.id, date: s.created_at, day: dhakaDayKey(s.created_at), month: dhakaDayKey(s.created_at).slice(0, 7),
      invoiceNo: s.invoice_no, status: s.status,
      productId: it.product_id, product: it.name.trim(), sku: it.product?.sku ?? "", category: it.product?.category ?? (it.product_id ? "other" : "service"), type,
      qty, returnedQty, unitPrice: n(it.unit_price), listPrice: it.list_price != null ? n(it.list_price) : null, priceChanged: !!it.price_overridden,
      lineDiscount: n(it.discount), invoiceDiscount: r2(invoiceDiscount), gross, net: r2(net), returnedValue: r2(returnedValue), netAfterReturn: r2(net - returnedValue),
      cost: r2(unitCost * keptQty), profit: r2(net - returnedValue - unitCost * keptQty),
      customer: s.owner?.full_name ?? "Walk-in", customerPhone: s.owner?.phone ?? "", employee: employeeOf(s), employeeId: s.cashier_id,
      methods, invoiceDue: CANCELLED.has(s.status) ? 0 : n(s.due),
    };
  };

  // 1) Lines of invoices made in the period
  const lines: Line[] = [];
  for (const s of d.sales) {
    const share = shareOf(s);
    for (const it of itemsBySale.get(s.id) ?? []) lines.push(makeLine(s, it, share));
  }
  const shown = lines.filter(lineMatches);

  // 2) Per product
  const prodMap = new Map<string, { key: string; product: string; sku: string; category: string; type: string; invoices: Set<string>; qty: number; returnedQty: number; gross: number; discount: number; returnedValue: number; net: number; cost: number; profit: number; last: string; changed: number }>();
  for (const l of shown) {
    const key = l.productId ?? `n:${l.product}`;
    let p = prodMap.get(key);
    if (!p) { p = { key, product: l.product, sku: l.sku, category: l.category, type: l.type, invoices: new Set(), qty: 0, returnedQty: 0, gross: 0, discount: 0, returnedValue: 0, net: 0, cost: 0, profit: 0, last: l.date, changed: 0 }; prodMap.set(key, p); }
    p.invoices.add(l.invoiceNo);
    p.qty += l.qty; p.returnedQty += l.returnedQty; p.gross += l.gross; p.discount += l.lineDiscount + l.invoiceDiscount;
    p.returnedValue += l.returnedValue; p.net += l.netAfterReturn; p.cost += l.cost; p.profit += l.profit;
    if (l.date > p.last) p.last = l.date;
    if (l.priceChanged) p.changed += 1;
  }
  const products = [...prodMap.values()].map((p) => ({
    ...p, invoiceCount: p.invoices.size, soldQty: p.qty - p.returnedQty,
    avgPrice: p.qty - p.returnedQty > 0 ? p.net / (p.qty - p.returnedQty) : 0,
    margin: p.net > 0 ? (p.profit / p.net) * 100 : 0,
  }));

  // 3) Daily / monthly
  const period = (key: "day" | "month") => {
    const m = new Map<string, { key: string; invoices: Set<string>; qty: number; net: number; cost: number; profit: number; discount: number; returned: number }>();
    for (const l of shown) {
      const k = l[key];
      let r = m.get(k);
      if (!r) { r = { key: k, invoices: new Set(), qty: 0, net: 0, cost: 0, profit: 0, discount: 0, returned: 0 }; m.set(k, r); }
      r.invoices.add(l.invoiceNo); r.qty += l.qty - l.returnedQty; r.net += l.netAfterReturn; r.cost += l.cost; r.profit += l.profit;
      r.discount += l.lineDiscount + l.invoiceDiscount; r.returned += l.returnedValue;
    }
    return [...m.values()].map((r) => ({ ...r, invoiceCount: r.invoices.size })).sort((a, b) => (a.key < b.key ? -1 : 1));
  };

  // 4) Invoices (only invoices that have a matching line)
  const invoiceIds = new Set(shown.map((l) => l.saleId));
  const invoices = d.sales.filter((s) => invoiceIds.has(s.id)).map((s) => {
    const ls = lines.filter((l) => l.saleId === s.id);
    return {
      id: s.id, invoiceNo: s.invoice_no, date: s.created_at, status: s.status, customer: s.owner?.full_name ?? "Walk-in", phone: s.owner?.phone ?? "",
      employee: employeeOf(s), items: ls.length, qty: ls.reduce((a, l) => a + l.qty, 0),
      discount: n(s.discount) + ls.reduce((a, l) => a + l.lineDiscount, 0), total: n(s.total), paid: n(s.paid), due: CANCELLED.has(s.status) ? 0 : n(s.due),
      returned: ls.reduce((a, l) => a + l.returnedValue, 0), profit: ls.reduce((a, l) => a + l.profit, 0),
      methods: [...(methodsBySale.get(s.id) ?? [])].map((m) => METHOD_LABEL[m] ?? m).join(", ") || (n(s.due) > 0 ? "Due" : "—"),
      priceChanged: ls.some((l) => l.priceChanged),
    };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));

  // 5) Employees
  const empMap = new Map<string, { key: string; employee: string; invoices: Set<string>; qty: number; net: number; discount: number; profit: number; paid: number; due: number }>();
  for (const l of shown) {
    const key = l.employeeId ?? "none";
    let e = empMap.get(key);
    if (!e) { e = { key, employee: l.employee, invoices: new Set(), qty: 0, net: 0, discount: 0, profit: 0, paid: 0, due: 0 }; empMap.set(key, e); }
    e.invoices.add(l.saleId); e.qty += l.qty - l.returnedQty; e.net += l.netAfterReturn; e.discount += l.lineDiscount + l.invoiceDiscount; e.profit += l.profit;
  }
  for (const e of empMap.values()) {
    for (const id of e.invoices) {
      const s = saleById.get(id);
      if (s && !CANCELLED.has(s.status)) { e.paid += n(s.paid); e.due += n(s.due); }
    }
  }
  const employees = [...empMap.values()].map((e) => ({ ...e, invoiceCount: e.invoices.size })).sort((a, b) => b.net - a.net);

  // 6) Actual collection: payments received in the period, spread over invoice lines
  const collections: { key: string; date: string; day: string; invoiceNo: string; method: string; product: string; productId: string | null; sku: string; category: string; customer: string; employee: string; employeeId: string | null; amount: number; invoiceDate: string }[] = [];
  for (const p of d.periodPays) {
    const s = saleById.get(p.sale_id);
    if (!s) continue;
    const share = shareOf(s);
    const list = itemsBySale.get(s.id) ?? [];
    for (const it of list) {
      const amount = r2(n(p.amount) * share(it));
      if (!amount) continue;
      collections.push({
        key: `${p.id}-${it.id}`, date: p.received_at, day: dhakaDayKey(p.received_at), invoiceNo: s.invoice_no, method: p.method,
        product: it.name.trim(), productId: it.product_id, sku: it.product?.sku ?? "", category: it.product?.category ?? (it.product_id ? "other" : "service"),
        customer: s.owner?.full_name ?? "Walk-in", employee: employeeOf(s), employeeId: s.cashier_id, amount, invoiceDate: s.created_at,
      });
    }
  }
  const collShown = collections.filter((c) =>
    (!pq || c.product.toLowerCase().includes(pq) || c.sku.toLowerCase().includes(pq)) &&
    (f.category === "all" || c.category === f.category) &&
    (!iq || c.invoiceNo.toLowerCase().includes(iq)) &&
    (!cq || c.customer.toLowerCase().includes(cq)) &&
    (f.employee === "all" || c.employeeId === f.employee) &&
    (f.method === "all" || f.method === "due" || c.method === f.method),
  );
  const collByProduct = new Map<string, { key: string; product: string; sku: string; cash: number; bkash: number; nagad: number; rocket: number; card: number; bank: number; refunds: number; total: number }>();
  for (const c of collShown) {
    const key = c.productId ?? `n:${c.product}`;
    let r = collByProduct.get(key);
    if (!r) { r = { key, product: c.product, sku: c.sku, cash: 0, bkash: 0, nagad: 0, rocket: 0, card: 0, bank: 0, refunds: 0, total: 0 }; collByProduct.set(key, r); }
    if (c.amount < 0) r.refunds += c.amount;
    else if (c.method in r) (r as any)[c.method] += c.amount;
    r.total += c.amount;
  }
  const collByDay = new Map<string, { key: string; total: number; byMethod: Record<string, number> }>();
  for (const c of collShown) {
    let r = collByDay.get(c.day);
    if (!r) { r = { key: c.day, total: 0, byMethod: {} }; collByDay.set(c.day, r); }
    r.total += c.amount;
    r.byMethod[c.method] = (r.byMethod[c.method] ?? 0) + c.amount;
  }

  const totals = {
    invoices: invoiceIds.size,
    qty: shown.reduce((a, l) => a + l.qty, 0),
    returnedQty: shown.reduce((a, l) => a + l.returnedQty, 0),
    gross: shown.reduce((a, l) => a + l.gross, 0),
    discount: shown.reduce((a, l) => a + l.lineDiscount + l.invoiceDiscount, 0),
    returned: shown.reduce((a, l) => a + l.returnedValue, 0),
    net: shown.reduce((a, l) => a + l.netAfterReturn, 0),
    cost: shown.reduce((a, l) => a + l.cost, 0),
    profit: shown.reduce((a, l) => a + l.profit, 0),
    collected: collShown.reduce((a, c) => a + c.amount, 0),
    due: invoices.reduce((a, i) => a + i.due, 0),
    priceChanged: shown.filter((l) => l.priceChanged).length,
  };

  const employeeOptions = [...new Map(lines.filter((l) => l.employeeId).map((l) => [l.employeeId!, l.employee])).entries()];
  const categoryOptions = [...new Set(lines.map((l) => l.category))].sort();

  return {
    lines: shown.sort((a, b) => (a.date < b.date ? 1 : -1)),
    products,
    daily: period("day"),
    monthly: period("month"),
    invoices,
    employees,
    collections: collShown.sort((a, b) => (a.date < b.date ? 1 : -1)),
    collByProduct: [...collByProduct.values()].sort((a, b) => b.total - a.total),
    collByDay: [...collByDay.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
    totals,
    employeeOptions,
    categoryOptions,
  };
}
