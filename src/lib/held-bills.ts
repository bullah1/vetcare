import { supabase } from "@/integrations/supabase/client";

/**
 * A "Pending Bill" is a bill that is NOT finalised yet: the customer will come
 * back for it, or it is an online / delivery order still being prepared. It
 * never touches stock, cash or revenue. Once it is completed at the POS it
 * becomes a real sale (which may then be Paid or Due).
 */
export type HeldBillItem = {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  discount: number;
  tax_percent: number;
};

export type HeldBill = {
  id: string;
  bill_no: string;
  owner_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  items: HeldBillItem[];
  subtotal: number;
  discount: number;
  total: number;
  note: string | null;
  channel: string;
  status: "pending" | "converted" | "cancelled";
  converted_sale_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Channels a pending bill can come from. */
export const HELD_CHANNELS = ["counter", "online", "delivery", "phone"] as const;
export const HELD_CHANNEL_LABELS: Record<string, string> = {
  counter: "Counter hold",
  online: "Online order",
  delivery: "Delivery",
  phone: "Phone order",
};

/** POS reads this key on mount to resume a pending bill into the cart. */
export const RESUME_BILL_KEY = "pos-resume-pending-bill-v1";

export function queueResume(bill: HeldBill) {
  try {
    localStorage.setItem(RESUME_BILL_KEY, JSON.stringify(bill));
  } catch {
    /* storage unavailable */
  }
}

export function takeQueuedResume(): HeldBill | null {
  try {
    const raw = localStorage.getItem(RESUME_BILL_KEY);
    if (!raw) return null;
    localStorage.removeItem(RESUME_BILL_KEY);
    return JSON.parse(raw) as HeldBill;
  } catch {
    return null;
  }
}

export async function fetchHeldBills(status?: HeldBill["status"]) {
  let query = supabase
    .from("held_bills")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as HeldBill[];
}

export type SaveHeldBillInput = {
  owner_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  items: HeldBillItem[];
  discount: number;
  note: string | null;
  channel: string;
};

function lineTotals(items: HeldBillItem[]) {
  let sub = 0;
  let tax = 0;
  for (const it of items) {
    const lineSub = it.unit_price * it.quantity - it.discount;
    sub += lineSub;
    tax += lineSub * ((it.tax_percent || 0) / 100);
  }
  return { sub, tax };
}

/** Save the current cart as a Pending Bill (no stock / cash movement). */
export async function saveHeldBill(input: SaveHeldBillInput) {
  const { sub, tax } = lineTotals(input.items);
  const total = Math.max(0, sub + tax - (input.discount || 0));
  const { data: user } = await supabase.auth.getUser();

  let lastError: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: billNo, error: noErr } = await (supabase.rpc as any)("next_held_bill_no");
    if (noErr) throw noErr;
    const { data, error } = await supabase
      .from("held_bills")
      .insert({
        bill_no: billNo as unknown as string,
        owner_id: input.owner_id,
        customer_name: input.customer_name,
        customer_phone: input.customer_phone,
        items: input.items as any,
        subtotal: sub,
        discount: input.discount || 0,
        total,
        note: input.note,
        channel: input.channel,
        created_by: user.user?.id ?? null,
      })
      .select("*")
      .single();
    if (!error) return data as unknown as HeldBill;
    lastError = error;
    // 23505 = unique violation on bill_no → regenerate and retry
    if ((error as any).code !== "23505") throw error;
  }
  throw lastError;
}


export async function cancelHeldBill(id: string) {
  const { error } = await supabase.from("held_bills").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

export async function reopenHeldBill(id: string) {
  const { error } = await supabase.from("held_bills").update({ status: "pending" }).eq("id", id);
  if (error) throw error;
}

export async function markHeldBillConverted(id: string, saleId: string | null) {
  const { error } = await supabase
    .from("held_bills")
    .update({ status: "converted", converted_sale_id: saleId })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteHeldBill(id: string) {
  const { error } = await supabase.from("held_bills").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Put a bill that was taken back into the cart on hold again. Updates the same
 * record (same bill number) instead of creating a new pending bill each time.
 */
export async function updateHeldBill(id: string, input: SaveHeldBillInput) {
  const { sub, tax } = lineTotals(input.items);
  const total = Math.max(0, sub + tax - (input.discount || 0));
  const { data, error } = await supabase
    .from("held_bills")
    .update({
      owner_id: input.owner_id,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      items: input.items as any,
      subtotal: sub,
      discount: input.discount || 0,
      total,
      note: input.note,
      channel: input.channel,
      status: "pending",
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as HeldBill;
}
