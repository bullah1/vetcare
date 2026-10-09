import { supabase } from "@/integrations/supabase/client";
import type { Receipt } from "@/lib/invoice-print";
import { fetchReceiptDelivery } from "@/lib/deliveries";

/**
 * Loads a saved sale as a printable invoice, including its local delivery
 * (rider) or courier parcel (tracking no., COD). Read-only.
 */
export async function fetchSaleReceipt(saleId: string): Promise<Receipt> {
  const { data, error } = await supabase
    .from("sales")
    .select(
      "id,invoice_no,created_at,total,paid,due,status,subtotal,discount,tax,notes, owner:pet_owners(full_name,phone), sale_items(name,quantity,unit_price,discount,tax,line_total), payments(method,amount,reference)",
    )
    .eq("id", saleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Invoice not found");
  const d = data as any;
  const delivery = await fetchReceiptDelivery(saleId);
  return {
    sale_id: d.id,
    invoice_no: d.invoice_no,
    subtotal: Number(d.subtotal),
    tax: Number(d.tax),
    discount: Number(d.discount),
    total: Number(d.total),
    paid: Number(d.paid),
    due: Number(d.due),
    method: d.payments?.[0]?.method ?? "—",
    issued_at: d.created_at,
    owner: d.owner ? { full_name: d.owner.full_name, phone: d.owner.phone } : null,
    status: d.status,
    notes: d.notes,
    items: (d.sale_items ?? []).map((it: any) => ({
      name: it.name,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      discount: Number(it.discount),
      tax: Number(it.tax),
      line_total: Number(it.line_total),
    })),
    payments: (d.payments ?? []).map((p: any) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
    delivery,
  };
}
