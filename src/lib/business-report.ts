// Business Report — one accounting engine for every number on the Business
// Report page, its Excel export and its printed / PDF report, so they always
// agree. Everything is computed from real transactions; nothing is stored.
//
// Accounting rules (same as Sales History):
//  - Invoice Sales: every invoice raised in the period, on its invoice date.
//    Cancelled / refunded invoices stay on their original day and are reversed
//    on the day they were cancelled / refunded. Old cancelled invoices without
//    a reversal row are left out completely ("dead"), so nothing counts twice.
//  - Net Sales  = Invoice Sales − returns, refunds and cancellations of the period.
//  - COGS       = cost of the goods on the period's invoices (cost at sale time)
//                 − cost of goods that came back in the period's returns.
//  - Gross Profit = Net Sales − COGS.
//  - Purchases are NOT an expense: they become stock; only sold goods (COGS) cost.
//  - Net Delivery Income = delivery charges paid by customers on delivered
//    parcels − the real cost (rider fees, courier deductions, return charges).
//  - Net Profit = Gross Profit + Net Delivery Income − Operating Expenses
//                 − stock written off (damaged / expired / lost) + stock found.
//  - Clinic revenue = consultation invoices (appointments create an invoice),
//    so it is already inside Sales — split out, never added twice.
//  - Tax / VAT is not deducted (not tracked separately).
import { supabase } from "@/integrations/supabase/client";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import { dayRangeISO, grossOf } from "@/lib/sales-ledger";
import { dhakaDayKey, shiftDay } from "@/lib/sales-summary";
import { deliveryMoney, loadShipments, type Shipment } from "@/lib/shipments";

const db = supabase as any;
const n = (v: unknown) => Number(v) || 0;
/** "pet_food" → "Pet food" */
export const catLabel = (c: unknown) => { const t = String(c ?? "").replace(/_/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : "Uncategorised"; };
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Expense rows that are really purchases / supplier payments — not operating costs. */
export const isPurchaseExpense = (e: any) =>
  !!e.purchase_invoice_id || ["Supplier Payment", "Purchase"].includes(String(e.category));
const DOCTOR_CATS = new Set(["Doctor Fee", "Doctor Payment", "Doctor Commission"]);
const CLINIC_CATS = new Set(["Clinic", "Clinic Expense", "Medical Supplies"]);
const DELIVERY_CATS = new Set(["Delivery", "Courier", "Delivery Man"]);
export const EXPENSE_CATEGORIES = ["Rent", "Salary", "Utilities", "Marketing", "Transport", "Supplies", "Equipment", "Doctor Fee", "Clinic", "Delivery", "Courier", "Other"];

const MOBILE = new Set(["bkash", "nagad", "rocket"]);
const BANK = new Set(["bank", "card"]);
export const METHOD_LABEL: Record<string, string> = { cash: "Cash", bkash: "bKash", nagad: "Nagad", rocket: "Rocket", card: "Card", bank: "Bank", due: "Due" };

// ---------------------------------------------------------------------------
// Periods

export type Period = { from: string; to: string };

const monthEnd = (ym: string) => shiftDay(`${shiftMonth(ym, 1)}-01`, -1);
function shiftMonth(ym: string, by: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** The period to compare with: the previous month for a month, otherwise the same number of days before. */
export function previousPeriod(p: Period): Period {
  if (p.from.endsWith("-01") && p.from.slice(0, 7) === p.to.slice(0, 7)) {
    const prev = shiftMonth(p.from.slice(0, 7), -1);
    // This month so far → same days of last month (fair comparison).
    const days = Number(p.to.slice(8)) ;
    const end = monthEnd(prev);
    const to = p.to === monthEnd(p.from.slice(0, 7)) ? end : `${prev}-${String(Math.min(days, Number(end.slice(8)))).padStart(2, "0")}`;
    return { from: `${prev}-01`, to };
  }
  const len = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;
  return { from: shiftDay(p.from, -len), to: shiftDay(p.from, -1) };
}

// ---------------------------------------------------------------------------
// Loading

export type PeriodData = Awaited<ReturnType<typeof loadPeriod>>;

export async function loadPeriod({ from, to }: Period) {
  const { fromISO, toISO } = dayRangeISO(from, to);
  const [sales, items, returns, payments, expenses, purchases, purchaseReturns, supplierPayments, appointments, adjustments, shipments, visits, prescriptions, flows] =
    await Promise.all([
      fetchAll<any>(() => db.from("sales").select("id,invoice_no,created_at,subtotal,discount,tax,total,paid,due,status,owner_id, owner:pet_owners(full_name,phone)").gte("created_at", fromISO).lte("created_at", toISO).order("created_at").order("id")),
      fetchAll<any>(() => db.from("sale_items").select("id,sale_id,product_id,name,quantity,returned_quantity,line_total,cost_price, products(purchase_price,category), sales!inner(created_at)").gte("sales.created_at", fromISO).lte("sales.created_at", toISO).order("id")),
      fetchAll<any>(() => db.from("sale_returns").select("id,sale_id,return_no,reason,refund_method,refund_amount,refund_paid,due_reduction,restock,return_type,created_at, sales(invoice_no,status,total,subtotal,discount,created_at), sale_return_items(product_id,name,quantity,line_total, sale_items(cost_price, products(purchase_price)))").gte("created_at", fromISO).lte("created_at", toISO).order("created_at").order("id")),
      fetchAll<any>(() => db.from("payments").select("id,sale_id,method,amount,return_id,received_at").gte("received_at", fromISO).lte("received_at", toISO).order("received_at").order("id")),
      fetchAll<any>(() => db.from("expenses").select("*").gte("expense_date", from).lte("expense_date", to).order("expense_date").order("id")),
      fetchAll<any>(() => db.from("purchase_invoices").select("id,invoice_no,supplier_id,invoice_date,subtotal,discount,total,paid,due,status, suppliers(name)").gte("invoice_date", from).lte("invoice_date", to).order("invoice_date").order("id")),
      fetchAll<any>(() => db.from("purchase_returns").select("id,return_no,refund_amount,created_at").gte("created_at", fromISO).lte("created_at", toISO).order("id")),
      fetchAll<any>(() => db.from("supplier_payments").select("id,supplier_id,amount,method,paid_at, suppliers(name)").gte("paid_at", from).lte("paid_at", to).order("id")),
      fetchAll<any>(() => db.from("appointments").select("id,doctor_id,fee,paid,discount,status,sale_id,scheduled_at, doctors(full_name)").gte("scheduled_at", fromISO).lte("scheduled_at", toISO).order("scheduled_at").order("id")),
      fetchAll<any>(() => db.from("stock_adjustments").select("id,product_id,quantity_change,reason,created_at, products(name,purchase_price,category)").gte("created_at", fromISO).lte("created_at", toISO).order("id")),
      loadShipments(from, to),
      db.from("medical_records").select("id", { count: "exact", head: true }).gte("visit_date", fromISO).lte("visit_date", toISO),
      db.from("prescriptions").select("id", { count: "exact", head: true }).gte("issued_at", fromISO).lte("issued_at", toISO),
      db.rpc("account_balances", { _from: from, _to: to }),
    ]);

  // Old cancelled / refunded invoices without any reversal row are "dead".
  const reversedCandidates = sales.filter((s: any) => s.status === "void" || s.status === "refunded").map((s: any) => s.id);
  const anyReturn = await fetchAllIn<{ sale_id: string }>(reversedCandidates, (ids) => db.from("sale_returns").select("sale_id").in("sale_id", ids).order("id"));
  // For a cancellation, the value reversed is the invoice total minus any
  // earlier partial returns (older cancel rows stored only the cash part).
  const cancelledSaleIds = [...new Set(returns.filter((r: any) => r.return_type === "cancel").map((r: any) => r.sale_id))];
  const cancelledSaleReturns = await fetchAllIn<{ sale_id: string; return_type: string; refund_amount: number }>(cancelledSaleIds, (ids) => db.from("sale_returns").select("sale_id,return_type,refund_amount").in("sale_id", ids).order("id"));
  const partialBySale = new Map<string, number>();
  for (const r of cancelledSaleReturns) if (r.return_type !== "cancel") partialBySale.set(r.sale_id, (partialBySale.get(r.sale_id) ?? 0) + n(r.refund_amount));
  // Which invoices are consultation (clinic) invoices — sales in range AND returned sales from earlier.
  const saleIds = [...new Set([...sales.map((s: any) => s.id), ...returns.map((r: any) => r.sale_id)])];
  const clinicLinks = await fetchAllIn<{ sale_id: string }>(saleIds, (ids) => db.from("appointments").select("sale_id").in("sale_id", ids).order("id"));

  return {
    period: { from, to },
    sales, items, returns, payments, expenses, purchases, purchaseReturns, supplierPayments, appointments, adjustments, shipments,
    visits: visits.count ?? 0,
    prescriptions: prescriptions.count ?? 0,
    flows: (flows.data ?? []) as { method: string; inflow: number; outflow: number; balance: number }[],
    reversedIds: new Set(anyReturn.map((r) => r.sale_id)),
    partialBySale,
    clinicSaleIds: new Set(clinicLinks.map((r) => r.sale_id)),
  };
}

/** Today's position — stock, receivables, payables, balances. Not tied to a period. */
export async function loadSnapshot() {
  const today = dhakaDayKey(new Date());
  const soon = shiftDay(today, 30);
  const [products, batches, suppliers, dueSales, balances, drawer] = await Promise.all([
    fetchAll<any>(() => db.from("products").select("id,name,sku,category,unit,stock_quantity,purchase_price,selling_price,low_stock_threshold,is_active").order("name").order("id")),
    fetchAll<any>(() => db.from("stock_batches").select("id,product_id,batch_no,quantity,purchase_price,expiry_date, products(name,stock_quantity,purchase_price)").not("expiry_date", "is", null).lte("expiry_date", soon).gt("quantity", 0).order("expiry_date").order("id")),
    fetchAll<any>(() => db.from("suppliers").select("id,name,phone,balance_due").order("name").order("id")),
    fetchAll<any>(() => db.from("sales").select("id,invoice_no,created_at,total,paid,due,status, owner:pet_owners(full_name,phone)").gt("due", 0.004).in("status", ["completed", "partial_refund"]).order("created_at").order("id")),
    db.rpc("account_balances", { _from: null, _to: null }),
    db.rpc("cash_shift_summary", {}),
  ]);
  return {
    today,
    products,
    expiring: batches,
    suppliers,
    dueSales,
    balances: (balances.data ?? []) as { method: string; inflow: number; outflow: number; balance: number }[],
    drawer: drawer.error ? null : (drawer.data as any),
  };
}

// ---------------------------------------------------------------------------
// Computing

const unitCost = (line: any) => (n(line?.cost_price) > 0 ? n(line.cost_price) : n(line?.products?.purchase_price));

export type Computed = ReturnType<typeof computePeriod>;

export function computePeriod(d: PeriodData) {
  const { fromISO } = dayRangeISO(d.period.from, d.period.to);
  const dead = new Set(d.sales.filter((s: any) => (s.status === "void" || s.status === "refunded") && !d.reversedIds.has(s.id)).map((s: any) => s.id));
  const live = d.sales.filter((s: any) => !dead.has(s.id));
  const liveIds = new Set(live.map((s: any) => s.id));
  const isClinic = (id: string) => d.clinicSaleIds.has(id);

  // --- Sales
  let beforeDiscount = 0, discounts = 0, invoiceSales = 0, clinicSales = 0, creditSales = 0;
  const daily = new Map<string, { day: string; sales: number; reversals: number; net: number; cogs: number; profit: number; clinic: number }>();
  const dayRow = (iso: string) => {
    const k = dhakaDayKey(iso);
    let r = daily.get(k);
    if (!r) { r = { day: k, sales: 0, reversals: 0, net: 0, cogs: 0, profit: 0, clinic: 0 }; daily.set(k, r); }
    return r;
  };
  for (const s of live) {
    const g = grossOf(s);
    invoiceSales += g;
    discounts += n(s.discount);
    beforeDiscount += g + n(s.discount);
    if (isClinic(s.id)) { clinicSales += g; dayRow(s.created_at).clinic += g; }
    if (s.status !== "void" && s.status !== "refunded") creditSales += n(s.due);
    dayRow(s.created_at).sales += g;
  }

  // --- Reversals (returns, refunds, cancellations) on their own date
  const seen = new Set<string>();
  let reversals = 0, clinicReversals = 0, returnCount = 0, cancelCount = 0, returnedGoods = 0, restockedValue = 0, notRestockedValue = 0, cogsBack = 0;
  const refundByMethod: Record<string, number> = {};
  const returnRows: any[] = [];
  for (const r of d.returns) {
    const sale = r.sales;
    const raisedInRange = sale?.created_at ? sale.created_at >= fromISO : false;
    if (raisedInRange && !liveIds.has(r.sale_id)) continue; // never counted in the first place
    const cancel = r.return_type === "cancel";
    let value = n(r.refund_amount);
    if (cancel) {
      // Whole remaining invoice value, once per invoice.
      if (seen.has(r.sale_id)) value = 0;
      else { seen.add(r.sale_id); value = Math.max(value, grossOf(sale) - (d.partialBySale.get(r.sale_id) ?? 0), 0); }
    }
    reversals += value;
    if (isClinic(r.sale_id)) clinicReversals += value;
    dayRow(r.created_at).reversals += value;
    if (cancel) cancelCount += 1; else returnCount += 1;
    let goods = 0, cost = 0;
    for (const it of r.sale_return_items ?? []) {
      goods += n(it.line_total);
      cost += n(it.quantity) * unitCost(it.sale_items);
    }
    returnedGoods += goods;
    cogsBack += cost;
    dayRow(r.created_at).cogs -= cost;
    if (r.restock) restockedValue += goods; else notRestockedValue += goods;
    if (n(r.refund_paid) > 0) refundByMethod[r.refund_method ?? "cash"] = (refundByMethod[r.refund_method ?? "cash"] ?? 0) + n(r.refund_paid);
    returnRows.push({ date: r.created_at, returnNo: r.return_no, invoiceNo: sale?.invoice_no, type: cancel ? "Cancellation" : "Return", value, goods, refundPaid: n(r.refund_paid), dueReduction: n(r.due_reduction), method: r.refund_method, restock: !!r.restock, reason: r.reason });
  }

  // --- COGS & product / category analysis (net of returned quantity)
  let cogsSold = 0;
  const saleById = new Map(live.map((s: any) => [s.id, s]));
  const products = new Map<string, { key: string; name: string; category: string; qty: number; revenue: number; cost: number }>();
  for (const it of d.items) {
    const s = saleById.get(it.sale_id);
    if (!s) continue;
    const q = n(it.quantity);
    const cost = q * unitCost(it);
    cogsSold += cost;
    dayRow(s.created_at).cogs += cost;
    if (s.status === "void") continue; // cancelled invoices don't rank products
    const netQ = q - n(it.returned_quantity);
    const sub = n(s.subtotal);
    const factor = sub > 0 ? Math.max(0, Math.min(1, grossOf(s) / sub)) : 1; // spread invoice discount
    const rev = q > 0 ? n(it.line_total) * (netQ / q) * factor : 0;
    const key = it.product_id ?? `svc:${it.name}`;
    const p = products.get(key) ?? { key, name: it.name, category: it.product_id ? catLabel(it.products?.category) : isClinic(it.sale_id) ? "Consultation" : "Service", qty: 0, revenue: 0, cost: 0 };
    p.qty += netQ;
    p.revenue += rev;
    p.cost += netQ * unitCost(it);
    products.set(key, p);
  }
  const productRows = [...products.values()].map((p) => ({ ...p, profit: p.revenue - p.cost, margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0 }));
  const catMap = new Map<string, { category: string; qty: number; revenue: number; cost: number }>();
  for (const p of productRows) {
    const c = catMap.get(p.category) ?? { category: p.category, qty: 0, revenue: 0, cost: 0 };
    c.qty += p.qty; c.revenue += p.revenue; c.cost += p.cost;
    catMap.set(p.category, c);
  }
  const categoryRows = [...catMap.values()].map((c) => ({ ...c, profit: c.revenue - c.cost, margin: c.revenue > 0 ? ((c.revenue - c.cost) / c.revenue) * 100 : 0 })).sort((a, b) => b.revenue - a.revenue);

  const cogs = cogsSold - cogsBack;
  const netSales = invoiceSales - reversals;
  const grossProfit = netSales - cogs;

  // --- Collections by payment method (money actually received / refunded in the period)
  const collected: Record<string, number> = {};
  let refundsPaid = 0;
  for (const p of d.payments) {
    const a = n(p.amount);
    if (a >= 0) collected[p.method] = (collected[p.method] ?? 0) + a;
    else refundsPaid += -a;
  }
  const groupMethods = (m: Record<string, number>) => {
    const g = { cash: 0, mobile: 0, bank: 0 };
    for (const [k, v] of Object.entries(m)) {
      if (k === "cash") g.cash += v; else if (MOBILE.has(k)) g.mobile += v; else if (BANK.has(k)) g.bank += v;
    }
    return g;
  };

  // --- Expenses (operating only — purchases are stock, not expense)
  const opexRows = d.expenses.filter((e: any) => !isPurchaseExpense(e));
  let opex = 0, doctorPay = 0, clinicExp = 0, deliveryExp = 0;
  const expByCat = new Map<string, number>();
  const expByMethod: Record<string, number> = {};
  for (const e of opexRows) {
    const a = n(e.amount);
    opex += a;
    expByCat.set(e.category, (expByCat.get(e.category) ?? 0) + a);
    expByMethod[e.method ?? "cash"] = (expByMethod[e.method ?? "cash"] ?? 0) + a;
    if (DOCTOR_CATS.has(e.category)) doctorPay += a;
    if (CLINIC_CATS.has(e.category)) clinicExp += a;
    if (DELIVERY_CATS.has(e.category)) deliveryExp += a;
  }
  const expenseCategories = [...expByCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

  // --- Purchases
  const purchaseTotal = d.purchases.reduce((a: number, p: any) => a + n(p.total), 0);
  const purchaseReturnTotal = d.purchaseReturns.reduce((a: number, p: any) => a + n(p.refund_amount), 0);
  const bySupplier = new Map<string, { supplier: string; invoices: number; total: number; paid: number; due: number }>();
  for (const p of d.purchases) {
    const k = p.supplier_id ?? "none";
    const s = bySupplier.get(k) ?? { supplier: p.suppliers?.name ?? "No supplier", invoices: 0, total: 0, paid: 0, due: 0 };
    s.invoices += 1; s.total += n(p.total); s.paid += n(p.paid); s.due += n(p.due);
    bySupplier.set(k, s);
  }
  const supplierPaid = d.supplierPayments.reduce((a: number, p: any) => a + n(p.amount), 0);

  // --- Stock adjustments (write-offs / found)
  let stockLoss = 0, stockFound = 0;
  const adjByReason: Record<string, { qty: number; value: number }> = {};
  for (const a of d.adjustments) {
    const q = n(a.quantity_change);
    const v = q * n(a.products?.purchase_price);
    const k = String(a.reason);
    adjByReason[k] = adjByReason[k] ?? { qty: 0, value: 0 };
    adjByReason[k].qty += q; adjByReason[k].value += v;
    if (q < 0) stockLoss += -v; else stockFound += v;
  }

  // --- Delivery
  const ships: Shipment[] = d.shipments;
  const local = ships.filter((s) => s.kind === "local");
  const courier = ships.filter((s) => s.kind === "courier");
  const delivery = deliveryMoney(ships);
  const stageCount = (list: Shipment[]) => ({
    total: list.length,
    delivered: list.filter((s) => s.stage === "delivered").length,
    progress: list.filter((s) => s.stage === "progress").length,
    cancelled: list.filter((s) => s.stage === "cancelled").length,
    pending: list.filter((s) => s.status === "pending").length,
    out: list.filter((s) => s.status === "out_for_delivery" || s.status === "in_review" || s.status === "hold").length,
  });
  const agents = new Map<string, any>();
  for (const s of ships) {
    const a = agents.get(s.agentKey) ?? { key: s.agentKey, name: s.agent, kind: s.kind, phone: s.agentPhone, assigned: 0, delivered: 0, cancelled: 0, progress: 0, income: 0, cost: 0, feeUnpaid: 0, feePaid: 0, cashPending: 0, codPending: 0, costMissing: 0 };
    a.assigned += 1;
    if (s.stage === "delivered") { a.delivered += 1; a.income += s.chargeIncome; }
    if (s.stage === "cancelled") a.cancelled += 1;
    if (s.stage === "progress") a.progress += 1;
    if (s.cost != null) a.cost += s.cost; else if (s.stage !== "progress") a.costMissing += 1;
    if (s.kind === "local") {
      if (s.riderPaid) a.feePaid += s.riderFee; else if (s.stage !== "progress") a.feeUnpaid += s.riderFee;
      if (s.stage === "delivered" && !s.cashReceived) a.cashPending += s.collect;
    } else if (s.stage === "delivered" && s.codReceived == null) a.codPending += s.collect;
    agents.set(s.agentKey, a);
  }
  const agentRows = [...agents.values()].map((a) => ({ ...a, net: a.income - a.cost })).sort((a, b) => b.assigned - a.assigned);
  const codCollected = courier.filter((s) => s.codReceived != null).reduce((a, s) => a + (s.codReceived ?? 0), 0);
  const courierDeductions = courier.reduce((a, s) => a + (s.actualCharge ?? 0), 0);
  const returnCost = courier.reduce((a, s) => a + s.returnCharge, 0);

  // --- Clinic
  const doctors = new Map<string, any>();
  let consultations = 0, paidConsult = 0, unpaidConsult = 0, freeConsult = 0, feeTotal = 0, feeCollected = 0, apptCancelled = 0;
  for (const a of d.appointments) {
    const k = a.doctor_id ?? "none";
    const doc = doctors.get(k) ?? { doctor: a.doctors?.full_name ?? "No doctor", count: 0, completed: 0, cancelled: 0, paid: 0, unpaid: 0, free: 0, fee: 0, collected: 0 };
    doc.count += 1;
    const cancelled = a.status === "cancelled" || a.status === "no_show";
    if (cancelled) { doc.cancelled += 1; apptCancelled += 1; }
    else {
      consultations += 1;
      if (a.status === "completed") doc.completed += 1;
      const fee = n(a.fee), paid = n(a.paid);
      doc.fee += fee; doc.collected += paid; feeTotal += fee; feeCollected += paid;
      if (fee <= 0) { doc.free += 1; freeConsult += 1; }
      else if (paid >= fee - 0.004) { doc.paid += 1; paidConsult += 1; }
      else { doc.unpaid += 1; unpaidConsult += 1; }
    }
    doctors.set(k, doc);
  }
  const doctorRows = [...doctors.values()].sort((a, b) => b.count - a.count);
  const clinicNetRevenue = clinicSales - clinicReversals;
  const shopNetSales = netSales - clinicNetRevenue;

  // --- Profit
  const netProfit = grossProfit + delivery.net - opex - stockLoss + stockFound;

  // Daily rows finalised
  const dailyRows = [...daily.values()]
    .map((r) => ({ ...r, net: r.sales - r.reversals, profit: r.sales - r.reversals - r.cogs }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    period: d.period,
    sales: {
      count: live.length, beforeDiscount, discounts, invoiceSales, reversals, netSales, creditSales,
      cancelledInvoices: d.sales.filter((s: any) => s.status === "void").length,
      cancelledValue: d.sales.filter((s: any) => s.status === "void").reduce((a: number, s: any) => a + grossOf(s), 0),
      clinicNet: clinicNetRevenue, shopNet: shopNetSales,
    },
    cogs, cogsSold, cogsBack, grossProfit,
    grossMargin: netSales > 0 ? (grossProfit / netSales) * 100 : 0,
    netProfit,
    netMargin: netSales > 0 ? (netProfit / netSales) * 100 : 0,
    collected, collectedGroups: groupMethods(collected), refundsPaid,
    opex, opexRows, expenseCategories, expByMethod, doctorPay, clinicExp, deliveryExp,
    purchases: { total: purchaseTotal, returns: purchaseReturnTotal, net: purchaseTotal - purchaseReturnTotal, count: d.purchases.length, bySupplier: [...bySupplier.values()].sort((a, b) => b.total - a.total), supplierPaid },
    stockAdj: { loss: stockLoss, found: stockFound, byReason: adjByReason },
    returns: { count: returnCount, cancelCount, returnedGoods, restockedValue, notRestockedValue, refundByMethod, rows: returnRows },
    delivery: {
      ...delivery, local: stageCount(local), courier: stageCount(courier), agents: agentRows,
      localMoney: deliveryMoney(local), courierMoney: deliveryMoney(courier),
      codCollected, courierDeductions, returnCost,
      cancelledDeliveries: ships.filter((s) => s.stage === "cancelled").length,
    },
    clinic: { consultations, paidConsult, unpaidConsult, freeConsult, feeTotal, feeCollected, apptCancelled, doctors: doctorRows, revenue: clinicNetRevenue, expenses: clinicExp + doctorPay, net: clinicNetRevenue - clinicExp - doctorPay, visits: d.visits, prescriptions: d.prescriptions },
    flows: d.flows,
    products: productRows,
    categories: categoryRows,
    daily: dailyRows,
    raw: { live, dead, shipments: ships, purchases: d.purchases },
  };
}

export type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;

export function computeSnapshot(s: Snapshot) {
  let stockValue = 0, retailValue = 0, units = 0, negative = 0, low = 0, out = 0;
  const lowRows: any[] = [];
  const catMap = new Map<string, { category: string; products: number; units: number; value: number; retail: number }>();
  for (const p of s.products) {
    const q = n(p.stock_quantity);
    if (p.is_active === false && q <= 0) continue; // hidden product without stock
    const qPos = Math.max(0, q); // negative stock is a data problem, never negative value
    const v = qPos * n(p.purchase_price);
    stockValue += v; retailValue += qPos * n(p.selling_price); units += qPos;
    if (q < 0) negative += 1;
    const thr = n(p.low_stock_threshold);
    if (q <= 0) { out += 1; lowRows.push({ ...p, state: q < 0 ? "Negative" : "Out of stock" }); }
    else if (thr > 0 && q <= thr) { low += 1; lowRows.push({ ...p, state: "Low" }); }
    const c = catMap.get(catLabel(p.category)) ?? { category: catLabel(p.category), products: 0, units: 0, value: 0, retail: 0 };
    c.products += 1; c.units += qPos; c.value += v; c.retail += qPos * n(p.selling_price);
    catMap.set(c.category, c);
  }
  let expiredValue = 0, expiringValue = 0;
  const expiryRows = s.expiring.map((b: any) => {
    // Remaining quantity of a batch is not tracked per sale, so a batch can't hold more than the product's stock.
    const qty = Math.min(n(b.quantity), Math.max(0, n(b.products?.stock_quantity)));
    const value = qty * n(b.purchase_price || b.products?.purchase_price);
    const expired = b.expiry_date < s.today;
    if (expired) expiredValue += value; else expiringValue += value;
    return { name: b.products?.name ?? "—", batch: b.batch_no, expiry: b.expiry_date, qty, value, expired };
  });
  const receivable = s.dueSales.reduce((a: number, x: any) => a + n(x.due), 0);
  const payable = s.suppliers.reduce((a: number, x: any) => a + Math.max(0, n(x.balance_due)), 0);
  const balances: Record<string, number> = {};
  for (const b of s.balances) balances[b.method] = n(b.balance);
  return {
    stockValue, retailValue, units, negative, low, out,
    lowRows: lowRows.sort((a, b) => n(a.stock_quantity) - n(b.stock_quantity)),
    categories: [...catMap.values()].sort((a, b) => b.value - a.value),
    expiredValue, expiringValue, expiryRows,
    receivable, payable,
    dueRows: s.dueSales, supplierRows: s.suppliers.filter((x: any) => n(x.balance_due) > 0).sort((a: any, b: any) => n(b.balance_due) - n(a.balance_due)),
    balances,
    drawer: s.drawer,
  };
}

export const changePct = (cur: number, prev: number) => (Math.abs(prev) < 0.005 ? null : ((cur - prev) / Math.abs(prev)) * 100);

/** Plain-language alerts and insights for the summary. */
export function buildInsights(c: Computed, p: Computed | null, snap: ReturnType<typeof computeSnapshot> | null) {
  const out: { tone: "good" | "warn" | "bad" | "info"; text: string }[] = [];
  const money = (v: number) => `৳${Math.round(v).toLocaleString("en-BD")}`;
  if (p) {
    const ch = changePct(c.sales.netSales, p.sales.netSales);
    if (ch != null) out.push({ tone: ch >= 0 ? "good" : "warn", text: `Net sales ${ch >= 0 ? "up" : "down"} ${Math.abs(ch).toFixed(1)}% vs previous period (${money(p.sales.netSales)} → ${money(c.sales.netSales)}).` });
    const gm = c.grossMargin - p.grossMargin;
    if (Math.abs(gm) >= 2 && p.sales.netSales > 0) out.push({ tone: gm >= 0 ? "good" : "warn", text: `Gross margin ${gm >= 0 ? "improved" : "fell"} ${Math.abs(gm).toFixed(1)} points to ${c.grossMargin.toFixed(1)}%.` });
    const ex = changePct(c.opex, p.opex);
    if (ex != null && ex > 25) out.push({ tone: "warn", text: `Operating expenses up ${ex.toFixed(0)}% vs previous period.` });
  }
  if (c.netProfit < 0) out.push({ tone: "bad", text: `Net loss of ${money(-c.netProfit)} in this period.` });
  if (c.sales.invoiceSales > 0 && c.sales.reversals / c.sales.invoiceSales > 0.05) out.push({ tone: "warn", text: `Returns & cancellations are ${((c.sales.reversals / c.sales.invoiceSales) * 100).toFixed(1)}% of sales.` });
  if (c.delivery.costMissing) out.push({ tone: "info", text: `${c.delivery.costMissing} finished parcel(s) have no delivery cost entered — Net delivery income may be too high. Settle them in Delivery Report.` });
  if (c.delivery.net < 0) out.push({ tone: "warn", text: `Delivery is costing more than customers pay (${money(c.delivery.net)}).` });
  if (c.delivery.codPending + c.delivery.cashPending > 0) out.push({ tone: "info", text: `${money(c.delivery.codPending + c.delivery.cashPending)} of delivered-parcel money is still with the courier / riders.` });
  const totalShip = c.delivery.local.total + c.delivery.courier.total;
  if (totalShip >= 5 && c.delivery.cancelledDeliveries / totalShip > 0.15) out.push({ tone: "warn", text: `${((c.delivery.cancelledDeliveries / totalShip) * 100).toFixed(0)}% of parcels were cancelled or returned.` });
  if (c.stockAdj.loss > 0) out.push({ tone: "warn", text: `${money(c.stockAdj.loss)} of stock written off (damaged / expired / lost).` });
  if (snap) {
    if (snap.out) out.push({ tone: "warn", text: `${snap.out} product(s) out of stock${snap.negative ? `, ${snap.negative} with negative stock (check stock counts)` : ""}.` });
    if (snap.low) out.push({ tone: "info", text: `${snap.low} product(s) at or below the reorder level.` });
    if (snap.expiredValue > 0) out.push({ tone: "bad", text: `${money(snap.expiredValue)} of stock has already expired.` });
    if (snap.expiringValue > 0) out.push({ tone: "warn", text: `${money(snap.expiringValue)} of stock expires within 30 days.` });
    if (snap.receivable > 0) out.push({ tone: "info", text: `Customers owe ${money(snap.receivable)} (${snap.dueRows.length} invoices).` });
    if (snap.payable > 0) out.push({ tone: "info", text: `You owe suppliers ${money(snap.payable)}.` });
  }
  const top = [...c.products].filter((x) => !x.key.startsWith("svc:")).sort((a, b) => b.revenue - a.revenue)[0];
  if (top && top.revenue > 0) out.push({ tone: "good", text: `Best seller: ${top.name.trim()} — ${money(top.revenue)} (${top.margin.toFixed(0)}% margin).` });
  const lowMargin = c.products.filter((x) => x.revenue > 500 && x.margin < 5 && x.cost > 0).length;
  if (lowMargin) out.push({ tone: "warn", text: `${lowMargin} product(s) sold at under 5% margin.` });
  return out;
}

export { r2 };
