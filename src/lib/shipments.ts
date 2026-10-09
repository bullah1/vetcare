// One list of every parcel — courier (Steadfast …) and local delivery (own
// rider) — used by the Delivery Report, the settlement screens and the
// Business Report. Read-only.
import { supabase } from "@/integrations/supabase/client";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import { dayRangeISO } from "@/lib/sales-ledger";
import { dhakaDayKey } from "@/lib/sales-summary";
import { courierName } from "@/lib/invoice-print";
import { DELIVERY_STATUS_LABEL } from "@/lib/deliveries";
import { courierStage, localStage, type ParcelStage } from "@/lib/courier-status";

const db = supabase as any;
const num = (v: unknown) => Number(v) || 0;
const human = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

export type ShipmentKind = "courier" | "local";

export type Shipment = {
  id: string;
  /** Row id in deliveries / courier_orders. */
  rowId: string;
  kind: ShipmentKind;
  at: string;
  day: string;
  saleId: string;
  invoiceNo: string;
  customer: string;
  phone: string | null;
  address: string | null;
  agentKey: string;
  agent: string;
  agentPhone: string | null;
  tracking: string | null;
  status: string;
  statusLabel: string;
  stage: ParcelStage;
  productValue: number;
  /** Delivery / courier charge on the parcel. */
  charge: number;
  /** Courier COD charge added to the COD (customer pays). */
  codCharge: number;
  /** Delivery income that is ours: the charges the CUSTOMER pays. */
  chargeIncome: number;
  /** What the rider / courier collects from the customer. */
  collect: number;
  /** Goods already taken back in POS (sale refunded / partly refunded / cancelled). */
  returnedInPos: boolean;
  /** Real delivery cost (rider fee, or courier deduction + return charge). null = not entered yet. */
  cost: number | null;
  // Local delivery settlement
  riderFee: number;
  riderPaid: boolean;
  cashReceived: boolean;
  // Courier settlement
  actualCharge: number | null;
  returnCharge: number;
  codReceived: number | null;
  paidBy: "customer" | "shop";
  /** Settlement fields exist in the database (migration applied). */
  settlementReady: boolean;
};

const COURIER_COLS =
  "id,sale_id,invoice_no,courier,status,consignment_id,tracking_code,recipient_name,recipient_phone,recipient_address,sales_total,courier_charge,paid_by,cod_amount,sent_at,created_at";
const COURIER_SETTLE_COLS = ",actual_charge,return_charge,cod_received,cod_received_at";

export async function loadShipments(from: string, to: string): Promise<Shipment[]> {
  const { fromISO, toISO } = dayRangeISO(from, to);
  const courierQuery = (cols: string) =>
    fetchAll<any>(() =>
      db.from("courier_orders").select(cols).gte("created_at", fromISO).lte("created_at", toISO)
        .neq("status", "failed") // never reached the courier
        .order("created_at").order("id"),
    );

  let settlementReady = true;
  const [locals, couriers] = await Promise.all([
    fetchAll<any>(() =>
      db.from("deliveries").select("*").gte("created_at", fromISO).lte("created_at", toISO).order("created_at").order("id"),
    ).catch(() => [] as any[]), // delivery tables not created yet → courier only
    // Before the delivery-cost migration the settlement columns do not exist.
    courierQuery(COURIER_COLS + COURIER_SETTLE_COLS).catch(() => {
      settlementReady = false;
      return courierQuery(COURIER_COLS);
    }),
  ]);
  if (locals.length && !("rider_fee" in locals[0])) settlementReady = false;

  // Rider collects the unpaid product amount + the delivery charge; the sale
  // status shows whether returned parcels were taken back in POS.
  const sales = await fetchAllIn<{ id: string; total: number; due: number; status: string }>(
    [...locals.map((d) => d.sale_id), ...couriers.map((c: any) => c.sale_id)],
    (ids) => db.from("sales").select("id,total,due,status").in("id", ids).order("id"),
  );
  const RETURNED = new Set(["refunded", "partial_refund", "void"]);
  const saleById = new Map(sales.map((s) => [s.id, s]));

  const out: Shipment[] = [];
  for (const d of locals) {
    const s = saleById.get(d.sale_id);
    const charge = num(d.delivery_charge);
    const riderFee = num(d.rider_fee);
    out.push({
      id: `L-${d.id}`,
      rowId: d.id,
      kind: "local",
      at: d.created_at,
      day: dhakaDayKey(d.created_at),
      saleId: d.sale_id,
      invoiceNo: d.invoice_no,
      customer: d.customer_name || "Walk-in",
      phone: d.customer_phone,
      address: d.customer_address,
      agentKey: `L:${d.delivery_man_id ?? d.delivery_man_name}`,
      agent: d.delivery_man_name,
      agentPhone: d.delivery_man_phone,
      tracking: null,
      status: d.status,
      statusLabel: (DELIVERY_STATUS_LABEL as any)[d.status] ?? human(d.status),
      stage: localStage(d.status),
      productValue: num(s?.total),
      charge,
      codCharge: 0,
      chargeIncome: charge,
      collect: num(s?.due) + charge,
      returnedInPos: RETURNED.has(String(s?.status)),
      // A fee of 0 that was never paid = not entered yet.
      cost: riderFee > 0 || d.rider_paid_at ? riderFee : null,
      riderFee,
      riderPaid: !!d.rider_paid_at,
      cashReceived: !!d.cash_received_at,
      actualCharge: null,
      returnCharge: 0,
      codReceived: null,
      paidBy: "customer",
      settlementReady,
    });
  }
  for (const c of couriers) {
    const salesTotal = num(c.sales_total);
    const charge = num(c.courier_charge);
    const cod = num(c.cod_amount);
    const at = c.sent_at ?? c.created_at;
    const st = String(c.status || "pending");
    const customerPays = c.paid_by !== "shop";
    const codCharge = customerPays ? Math.max(0, cod - salesTotal - charge) : 0;
    const actual = c.actual_charge == null ? null : num(c.actual_charge);
    const returnCharge = num(c.return_charge);
    out.push({
      id: `C-${c.id}`,
      rowId: c.id,
      kind: "courier",
      at,
      day: dhakaDayKey(at),
      saleId: c.sale_id,
      invoiceNo: c.invoice_no,
      customer: c.recipient_name || "—",
      phone: c.recipient_phone,
      address: c.recipient_address,
      agentKey: `C:${c.courier}`,
      agent: courierName(c.courier),
      agentPhone: null,
      tracking: c.tracking_code ?? c.consignment_id ?? null,
      status: st,
      statusLabel: human(st),
      stage: courierStage(st),
      productValue: salesTotal,
      charge,
      codCharge,
      chargeIncome: customerPays ? charge + codCharge : 0,
      collect: cod,
      returnedInPos: RETURNED.has(String(saleById.get(c.sale_id)?.status)),
      cost: actual == null && returnCharge === 0 ? null : (actual ?? 0) + returnCharge,
      riderFee: 0,
      riderPaid: false,
      cashReceived: false,
      actualCharge: actual,
      returnCharge,
      codReceived: c.cod_received == null ? null : num(c.cod_received),
      paidBy: customerPays ? "customer" : "shop",
      settlementReady,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Suggested courier deduction: delivery charge + 1% COD fee (Steadfast). */
export const suggestedCourierCharge = (s: Shipment) =>
  s.stage === "cancelled" ? s.charge : s.charge + Math.ceil(s.collect * 0.01);

/**
 * Delivery money for a set of parcels. Delivery charge income only counts on
 * delivered parcels (a cancelled parcel's charge is never collected); costs
 * count on every parcel they were entered for (a return still costs money).
 */
export function deliveryMoney(list: Shipment[]) {
  let income = 0, cost = 0, costMissing = 0, codPending = 0, cashPending = 0, riderFeeUnpaid = 0;
  for (const s of list) {
    if (s.stage === "delivered") income += s.chargeIncome;
    if (s.cost != null) cost += s.cost;
    else if (s.stage !== "progress") costMissing += 1;
    if (s.kind === "courier" && s.stage === "delivered" && s.codReceived == null) codPending += s.collect;
    if (s.kind === "local" && s.stage === "delivered" && !s.cashReceived) cashPending += s.collect;
    if (s.kind === "local" && !s.riderPaid && s.stage !== "progress") riderFeeUnpaid += s.riderFee;
  }
  return { income, cost, net: income - cost, costMissing, codPending, cashPending, riderFeeUnpaid };
}
