import { supabase } from "@/integrations/supabase/client";

/**
 * Delivery module — TRACKING / DATA ONLY.
 * Nothing in here writes to sales, payments, stock, cash or accounts. The
 * database functions (create_delivery / set_delivery_status /
 * update_delivery_details) only touch the delivery tables.
 */

export type DeliveryStatus = "pending" | "out_for_delivery" | "delivered" | "cancelled";

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: "Pending",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, string> = {
  pending: "border-amber-300 bg-amber-50 text-amber-800",
  out_for_delivery: "border-sky-300 bg-sky-50 text-sky-800",
  delivered: "border-emerald-300 bg-emerald-50 text-emerald-800",
  cancelled: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** Allowed next steps: Pending → Out for Delivery → Delivered, or → Cancelled. */
export const NEXT_STATUSES: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export type DeliveryMan = { id: string; name: string; phone: string | null; is_active: boolean; created_at: string };

export type Delivery = {
  id: string;
  sale_id: string;
  invoice_no: string;
  delivery_man_id: string | null;
  delivery_man_name: string;
  delivery_man_phone: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  items: { name: string; quantity: number }[];
  delivery_charge: number;
  note: string | null;
  status: DeliveryStatus;
  created_at: string;
  updated_at: string;
};

export type DeliveryHistory = {
  id: string;
  delivery_id: string;
  from_status: DeliveryStatus | null;
  to_status: DeliveryStatus;
  note: string | null;
  changed_by_name: string | null;
  changed_at: string;
};

// The new tables are not in the generated Supabase types yet.
const db = supabase as any;

export async function fetchDeliveryMen(includeInactive = true): Promise<DeliveryMan[]> {
  let q = db.from("delivery_men").select("id,name,phone,is_active,created_at").order("name");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as DeliveryMan[];
}

export async function saveDeliveryMan(input: { id?: string; name: string; phone: string | null; is_active?: boolean }) {
  const row = { name: input.name.trim(), phone: input.phone?.trim() || null, is_active: input.is_active ?? true };
  if (!row.name) throw new Error("Name is required");
  const res = input.id
    ? await db.from("delivery_men").update(row).eq("id", input.id).select("*").single()
    : await db.from("delivery_men").insert(row).select("*").single();
  if (res.error) throw res.error;
  return res.data as DeliveryMan;
}

export async function createDelivery(input: {
  saleId: string;
  deliveryManId: string;
  charge: number;
  note?: string | null;
  address?: string | null;
}) {
  const { data, error } = await db.rpc("create_delivery", {
    _sale_id: input.saleId,
    _delivery_man_id: input.deliveryManId,
    _delivery_charge: Number(input.charge) || 0,
    _note: input.note?.trim() || null,
    _address: input.address?.trim() || null,
  });
  if (error) throw error;
  return data as { delivery_id: string; invoice_no: string; status: DeliveryStatus };
}

export async function setDeliveryStatus(deliveryId: string, status: DeliveryStatus, note?: string | null) {
  const { data, error } = await db.rpc("set_delivery_status", {
    _delivery_id: deliveryId,
    _status: status,
    _note: note?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function updateDeliveryDetails(input: {
  id: string;
  deliveryManId: string;
  charge: number;
  address: string | null;
  note: string | null;
}) {
  const { error } = await db.rpc("update_delivery_details", {
    _delivery_id: input.id,
    _delivery_man_id: input.deliveryManId,
    _delivery_charge: Number(input.charge) || 0,
    _address: input.address,
    _note: input.note,
  });
  if (error) throw error;
}

export async function fetchDeliveryHistory(deliveryId: string): Promise<DeliveryHistory[]> {
  const { data, error } = await db
    .from("delivery_status_history")
    .select("*")
    .eq("delivery_id", deliveryId)
    .order("changed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DeliveryHistory[];
}

/** The live (not cancelled) delivery of an invoice, if any. */
export async function fetchActiveDelivery(saleId: string): Promise<Delivery | null> {
  const { data, error } = await db
    .from("deliveries")
    .select("*")
    .eq("sale_id", saleId)
    .neq("status", "cancelled")
    .maybeSingle();
  if (error) return null; // table not created yet → just no delivery info
  return (data as Delivery) ?? null;
}

/** Invoice print info for an active delivery (charge shown, not added to the sale). */
export function deliveryForReceipt(d: Delivery | null | undefined) {
  return d ? { charge: Number(d.delivery_charge) || 0, man: d.delivery_man_name } : null;
}
