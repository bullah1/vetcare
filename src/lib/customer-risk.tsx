import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { courierStage, localStage, phoneKey, type ParcelStage } from "@/lib/courier-status";

const db = supabase as any;

export type DeliveryRecord = {
  total: number;
  delivered: number;
  cancelled: number;
  inProgress: number;
  /** Cancelled / returned share of parcels that finished (0–1). */
  cancelRate: number;
  level: "none" | "good" | "watch" | "risky";
};

/**
 * The customer's parcel history in THIS shop (courier + local delivery),
 * matched by mobile number. Read-only.
 */
export async function fetchDeliveryRecord(phone: string | null | undefined): Promise<DeliveryRecord> {
  const key = phoneKey(phone);
  const empty: DeliveryRecord = { total: 0, delivered: 0, cancelled: 0, inProgress: 0, cancelRate: 0, level: "none" };
  if (!key) return empty;

  const [c, l] = await Promise.all([
    db.from("courier_orders").select("status").ilike("recipient_phone", `%${key}`).neq("status", "failed").limit(500),
    db.from("deliveries").select("status").ilike("customer_phone", `%${key}`).limit(500),
  ]);
  const stages: ParcelStage[] = [
    ...((c.data ?? []) as { status: string }[]).map((r) => courierStage(r.status)),
    ...((l.error ? [] : l.data ?? []) as { status: string }[]).map((r) => localStage(r.status)),
  ];
  const delivered = stages.filter((s) => s === "delivered").length;
  const cancelled = stages.filter((s) => s === "cancelled").length;
  const finished = delivered + cancelled;
  const cancelRate = finished ? cancelled / finished : 0;
  const level: DeliveryRecord["level"] =
    stages.length === 0 ? "none" : cancelled === 0 ? "good" : cancelled >= 2 && cancelRate >= 0.3 ? "risky" : "watch";
  return { total: stages.length, delivered, cancelled, inProgress: stages.length - finished, cancelRate, level };
}

export function useDeliveryRecord(phone: string | null | undefined) {
  const key = phoneKey(phone);
  return useQuery({
    queryKey: ["delivery-record", key],
    enabled: !!key,
    staleTime: 60_000,
    queryFn: () => fetchDeliveryRecord(phone),
  });
}

/**
 * Small badge: good / watch / risky delivery history. Renders nothing for a
 * customer who has never had a parcel.
 */
export function DeliveryRiskBadge({ phone, className = "" }: { phone: string | null | undefined; className?: string }) {
  const { data } = useDeliveryRecord(phone);
  if (!data || data.level === "none") return null;
  const pct = Math.round(data.cancelRate * 100);
  if (data.level === "good") {
    return (
      <div className={`flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800 ${className}`}>
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        <span>Good delivery record — {data.delivered} of {data.delivered + data.cancelled || data.total} parcels received</span>
      </div>
    );
  }
  const risky = data.level === "risky";
  return (
    <div
      className={`flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
        risky ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-amber-300 bg-amber-50 text-amber-800"
      } ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <b>{risky ? "Risky customer" : "Check before sending"}:</b> {data.cancelled} of {data.delivered + data.cancelled} parcels cancelled / returned ({pct}%)
        {risky ? " — consider taking advance payment." : "."}
      </span>
    </div>
  );
}
