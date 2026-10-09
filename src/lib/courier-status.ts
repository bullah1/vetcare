// Steadfast delivery statuses (portal.packzy.com / portal.steadfast.com.bd):
// pending, in_review, hold, unknown, delivered, partial_delivered, cancelled
// and the *_approval_pending versions of the final ones.

export type ParcelStage = "delivered" | "progress" | "cancelled";

const DELIVERED = new Set(["delivered", "partial_delivered", "delivered_approval_pending", "partial_delivered_approval_pending"]);
const CANCELLED = new Set(["cancelled", "cancelled_approval_pending", "returned", "return", "partial_returned"]);

/** Statuses that will not change any more — no need to ask the courier again. */
export const COURIER_FINAL_STATUSES = ["delivered", "partial_delivered", "cancelled", "failed"];

export function courierStage(status: string | null | undefined): ParcelStage {
  const s = String(status || "").toLowerCase();
  if (DELIVERED.has(s)) return "delivered";
  if (CANCELLED.has(s)) return "cancelled";
  return "progress";
}

export function localStage(status: string | null | undefined): ParcelStage {
  return status === "delivered" ? "delivered" : status === "cancelled" ? "cancelled" : "progress";
}

/** Last 10 digits of a Bangladeshi mobile number (drops 0 / 880 prefixes). */
export function phoneKey(phone: string | null | undefined): string {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}
