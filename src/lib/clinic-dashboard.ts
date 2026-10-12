// Clinic dashboard numbers. Money comes only from clinic bills (sales.source = 'clinic'),
// so a booking is never revenue and nothing is counted twice with POS.
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { dayRangeISO } from "@/lib/sales-ledger";
import { dhakaDayKey, shiftDay } from "@/lib/sales-summary";

const db = supabase as any;
const n = (v: unknown) => Number(v || 0);

export type DashAppt = {
  id: string;
  status: string;
  scheduled_at: string;
  serial_no: number | null;
  fee: number | null;
  reason: string | null;
  problem_id: string | null;
  doctor_id: string | null;
  sale_id: string | null;
  guest_name?: string | null;
  guest_phone?: string | null;
  guest_pet_name?: string | null;
  pet: { id: string; name: string; species: string | null; owner: { full_name: string; phone: string | null } | null } | null;
  doctor: { full_name: string } | null;
  problem: { name: string } | null;
};
export type DashItem = {
  name: string;
  quantity: number;
  line_total: number;
  cost_price: number | null;
  item_type: string | null;
  service_id: string | null;
  product_id: string | null;
  doctor_id: string | null;
  doctor_fee: number | null;
};
export type DashSale = {
  id: string;
  invoice_no: string;
  created_at: string;
  total: number;
  paid: number;
  due: number;
  discount: number;
  status: string;
  appointment_id: string | null;
  owner: { full_name: string; phone: string | null } | null;
  appointment: { doctor_id: string | null; problem_id: string | null; pet: { id: string; name: string } | null } | null;
  items: DashItem[];
};
export type DashReturn = { sale_id: string; refund_amount: number; created_at: string };

export async function loadClinicDashboard(from: string, to: string) {
  const { fromISO, toISO } = dayRangeISO(from, to);
  const [appts, sales, returns, services, doctors, problems] = await Promise.all([
    fetchAll<DashAppt>(() =>
      db
        .from("appointments")
        .select(
          "id,status,scheduled_at,serial_no,fee,reason,problem_id,doctor_id,sale_id,guest_name,guest_phone,guest_pet_name, pet:pets(id,name,species,owner:pet_owners(full_name,phone)), doctor:doctors(full_name), problem:clinic_problems(name)",
        )
        .gte("scheduled_at", fromISO)
        .lte("scheduled_at", toISO)
        .order("scheduled_at", { ascending: false })
        .order("id"),
    ),
    fetchAll<DashSale>(() =>
      db
        .from("sales")
        .select(
          "id,invoice_no,created_at,total,paid,due,discount,status,appointment_id, owner:pet_owners(full_name,phone), appointment:appointments!sales_appointment_id_fkey(doctor_id,problem_id,pet:pets(id,name)), items:sale_items(name,quantity,line_total,cost_price,item_type,service_id,product_id,doctor_id,doctor_fee)",
        )
        .eq("source", "clinic")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: false })
        .order("id"),
    ),
    fetchAll<DashReturn>(() =>
      db
        .from("sale_returns")
        .select("sale_id,refund_amount,created_at, sale:sales!inner(source)")
        .eq("sale.source", "clinic")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("id"),
    ),
    db.from("clinic_services").select("id,name,category").then((r: any) => r.data ?? []),
    db.from("doctors").select("id,full_name").then((r: any) => r.data ?? []),
    db.from("clinic_problems").select("id,name").then((r: any) => r.data ?? []),
  ]);
  return { appts, sales, returns, services, doctors, problems } as {
    appts: DashAppt[];
    sales: DashSale[];
    returns: DashReturn[];
    services: { id: string; name: string; category: string }[];
    doctors: { id: string; full_name: string }[];
    problems: { id: string; name: string }[];
  };
}

export type Row = { key: string; label: string; sub?: string; count: number; qty: number; revenue: number; cost: number; doctorFee: number; profit: number; extra?: number };
const blank = (key: string, label: string, sub?: string): Row => ({ key, label, sub, count: 0, qty: 0, revenue: 0, cost: 0, doctorFee: 0, profit: 0, extra: 0 });

export const isCancelledSale = (s: { status: string }) => s.status === "void" || s.status === "refunded";

export function computeClinicDashboard(data: Awaited<ReturnType<typeof loadClinicDashboard>>, from: string, to: string) {
  const { appts, sales, returns, services, doctors, problems } = data;
  const svcName = new Map(services.map((s) => [s.id, s]));
  const docName = new Map(doctors.map((d) => [d.id, d.full_name]));
  const probName = new Map(problems.map((p) => [p.id, p.name]));
  const withReturn = new Set(returns.map((r) => r.sale_id));

  // Older cancelled bills with no return row would stay as revenue forever: leave them out.
  const counted = sales.filter((s) => !(isCancelledSale(s) && !withReturn.has(s.id)));
  const live = counted.filter((s) => !isCancelledSale(s));

  const k = {
    appointments: appts.length,
    booked: 0,
    arrived: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    notBilled: 0,
    bills: live.length,
    gross: 0,
    reversals: 0,
    net: 0,
    collected: 0,
    due: 0,
    consultation: 0,
    services: 0,
    products: 0,
    billDiscount: 0,
    serviceCost: 0,
    productCost: 0,
    doctorFee: 0,
    profit: 0,
  };
  for (const a of appts) {
    const st = a.status === "confirmed" ? "pending" : a.status;
    if (st === "pending") k.booked++;
    else if (st === "in_progress") k.arrived++;
    else if (st === "completed") k.completed++;
    else if (st === "cancelled") k.cancelled++;
    else if (st === "no_show") k.noShow++;
    if (!a.sale_id && st !== "cancelled" && st !== "no_show") k.notBilled++;
  }

  const saleDoctor = (s: DashSale) => s.items.find((i) => i.doctor_id)?.doctor_id ?? s.appointment?.doctor_id ?? null;

  const byDoctor = new Map<string, Row>();
  const byItem = new Map<string, Row>();
  const byProblem = new Map<string, Row>();
  const doctorRow = (id: string | null) => {
    const key = id ?? "none";
    if (!byDoctor.has(key)) byDoctor.set(key, blank(key, id ? `Dr. ${docName.get(id) ?? "—"}` : "No doctor"));
    return byDoctor.get(key)!;
  };
  const problemRow = (id: string | null, fallback?: string | null) => {
    const key = id ?? "none";
    if (!byProblem.has(key)) byProblem.set(key, blank(key, id ? probName.get(id) ?? fallback ?? "—" : "Not set"));
    return byProblem.get(key)!;
  };

  for (const s of counted) k.gross += n(s.total);
  for (const r of returns) k.reversals += n(r.refund_amount);
  const refundsBySale = new Map<string, number>();
  for (const r of returns) refundsBySale.set(r.sale_id, (refundsBySale.get(r.sale_id) ?? 0) + n(r.refund_amount));

  for (const s of live) {
    k.collected += n(s.paid);
    k.due += Math.max(n(s.due), 0);
    k.billDiscount += n(s.discount);
    const net = n(s.total) - (refundsBySale.get(s.id) ?? 0);
    const dr = doctorRow(saleDoctor(s));
    dr.extra! += 1; // bills
    dr.revenue += net;
    let saleCost = 0;
    let saleFee = 0;
    for (const i of s.items) {
      const qty = n(i.quantity);
      const lt = n(i.line_total);
      const cost = n(i.cost_price) * qty;
      const fee = n(i.doctor_fee);
      saleCost += cost;
      saleFee += fee;
      let key: string, label: string, sub: string;
      if (i.item_type === "consultation") {
        k.consultation += lt;
        key = "consultation";
        label = "Consultation";
        sub = "Consultation";
      } else if (i.item_type === "service") {
        k.services += lt;
        k.serviceCost += cost;
        key = `s:${i.service_id ?? i.name}`;
        const svc = i.service_id ? svcName.get(i.service_id) : null;
        label = svc?.name ?? i.name;
        sub = "Service";
      } else {
        k.products += lt;
        k.productCost += cost;
        key = `p:${i.product_id ?? i.name}`;
        label = i.name;
        sub = "Medicine / product";
      }
      k.doctorFee += fee;
      if (!byItem.has(key)) byItem.set(key, blank(key, label, sub));
      const row = byItem.get(key)!;
      row.count += 1;
      row.qty += qty;
      row.revenue += lt;
      row.cost += cost;
      row.doctorFee += fee;
    }
    dr.cost += saleCost;
    dr.doctorFee += saleFee;
    dr.profit += net - saleCost - saleFee;
  }
  k.net = k.gross - k.reversals;
  k.profit = k.net - k.serviceCost - k.productCost - k.doctorFee;

  // Appointments per doctor and per problem; problem revenue from the bill of that visit.
  const saleById = new Map(live.map((s) => [s.id, s]));
  for (const a of appts) {
    doctorRow(a.doctor_id).count += 1;
    const pr = problemRow(a.problem_id, a.reason);
    pr.count += 1;
    if ((a.status === "completed")) pr.qty += 1;
    const s = a.sale_id ? saleById.get(a.sale_id) : null;
    if (s) pr.revenue += n(s.total) - (refundsBySale.get(s.id) ?? 0);
  }
  for (const r of byItem.values()) r.profit = r.revenue - r.cost - r.doctorFee;

  // Daily (or monthly for long periods) trend.
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 400; d = shiftDay(d, 1)) days.push(d);
  const monthly = days.length > 62;
  const bucket = (day: string) => (monthly ? day.slice(0, 7) : day);
  const trend = new Map<string, { key: string; revenue: number; collected: number; appointments: number }>();
  for (const d of days) if (!trend.has(bucket(d))) trend.set(bucket(d), { key: bucket(d), revenue: 0, collected: 0, appointments: 0 });
  for (const s of counted) {
    const t = trend.get(bucket(dhakaDayKey(s.created_at)));
    if (t) t.revenue += n(s.total);
  }
  for (const s of live) {
    const t = trend.get(bucket(dhakaDayKey(s.created_at)));
    if (t) t.collected += n(s.paid);
  }
  for (const r of returns) {
    const t = trend.get(bucket(dhakaDayKey(r.created_at)));
    if (t) t.revenue -= n(r.refund_amount);
  }
  for (const a of appts) {
    const t = trend.get(bucket(dhakaDayKey(a.scheduled_at)));
    if (t) t.appointments += 1;
  }

  const sortRev = (a: Row, b: Row) => b.revenue - a.revenue || b.count - a.count;
  return {
    k,
    byDoctor: [...byDoctor.values()].sort(sortRev),
    byItem: [...byItem.values()].sort(sortRev),
    byProblem: [...byProblem.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue),
    trend: [...trend.values()],
    monthly,
    refundsBySale,
  };
}
