import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SendInput = {
  saleId: string;
  courier: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  invoice_no: string;
  item_description: string;
  quantity: number;
  sales_total: number;
  courier_charge: number;
  /** COD charge (e.g. 1%) the courier keeps — added to the COD when the customer pays. */
  cod_charge?: number;
  paid_by: "customer" | "shop";
  note?: string | null;
  resend?: boolean;
};

const SENT_STATUSES = new Set([
  "sent",
  "pending",
  "in_review",
  "picked_up",
  "in_transit",
  "delivered",
  "partial_delivered",
  "hold",
]);

export const sendCourierOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SendInput) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const charge = Number(data.courier_charge) || 0;
    const salesTotal = Number(data.sales_total) || 0;
    const base = salesTotal + charge;
    const codCharge = Math.min(Math.max(0, Number(data.cod_charge) || 0), Math.ceil(base * 0.1));
    const cod = data.paid_by === "customer" ? base + codCharge : salesTotal;

    const { data: existing, error: exErr } = await supabase
      .from("courier_orders")
      .select("id,status,consignment_id")
      .eq("sale_id", data.saleId)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);

    if (existing && SENT_STATUSES.has(existing.status) && !data.resend) {
      throw new Error("This sale is already sent to courier. Use Resend to create a new order.");
    }

    const phone = String(data.recipient_phone || "").replace(/\D/g, "").slice(-11);
    if (phone.length !== 11) throw new Error("A valid 11-digit phone number is required for courier delivery.");
    if (!data.recipient_name?.trim()) throw new Error("Recipient name is required.");
    if (!data.recipient_address?.trim()) throw new Error("Delivery address is required.");

    const baseRow = {
      sale_id: data.saleId,
      courier: data.courier,
      recipient_name: data.recipient_name.trim(),
      recipient_phone: phone,
      recipient_address: data.recipient_address.trim(),
      invoice_no: data.invoice_no,
      item_description: data.item_description,
      quantity: Number(data.quantity) || 1,
      sales_total: salesTotal,
      courier_charge: charge,
      paid_by: data.paid_by,
      cod_amount: cod,
      note: data.note ?? null,
      created_by: userId,
    };

    let apiResult: {
      ok: boolean;
      message?: string;
      consignment_id?: string | null;
      tracking_code?: string | null;
      order_id?: string | null;
      status?: string | null;
      raw?: unknown;
    } = { ok: false, message: "Courier not supported" };

    if (data.courier === "steadfast") {
      const apiKey = process.env["STEADFAST_API_KEY"];
      const secretKey = process.env["STEADFAST_SECRET_KEY"];
      if (!apiKey || !secretKey) {
        apiResult = { ok: false, message: "Steadfast API credentials are not configured." };
      } else {
        try {
          const res = await fetch("https://portal.packzy.com/api/v1/create_order", {
            method: "POST",
            headers: {
              "Api-Key": apiKey,
              "Secret-Key": secretKey,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              invoice: data.resend ? `${data.invoice_no}-R${Date.now().toString().slice(-4)}` : data.invoice_no,
              recipient_name: baseRow.recipient_name,
              recipient_phone: phone,
              recipient_address: baseRow.recipient_address,
              cod_amount: cod,
              note: [data.item_description, data.note].filter(Boolean).join(" | ").slice(0, 500),
            }),
          });
          const text = await res.text();
          let json: any = null;
          try { json = JSON.parse(text); } catch { /* non-json response */ }

          if (res.ok && json && Number(json.status) === 200 && json.consignment) {
            apiResult = {
              ok: true,
              consignment_id: String(json.consignment.consignment_id ?? ""),
              tracking_code: json.consignment.tracking_code ?? null,
              order_id: json.consignment.invoice ?? data.invoice_no,
              status: json.consignment.status ?? "pending",
              raw: json,
            };
          } else {
            const msg =
              json?.message ??
              (json?.errors ? Object.values(json.errors).flat().join(", ") : null) ??
              text.slice(0, 300) ??
              `HTTP ${res.status}`;
            apiResult = { ok: false, message: String(msg), raw: json ?? text.slice(0, 500) };
          }
        } catch (e: any) {
          apiResult = { ok: false, message: e?.message ?? "Network error while contacting courier" };
        }
      }
    }

    const row = {
      ...baseRow,
      status: apiResult.ok ? (apiResult.status || "sent") : "failed",
      consignment_id: apiResult.ok ? apiResult.consignment_id ?? null : existing?.consignment_id ?? null,
      tracking_code: apiResult.ok ? apiResult.tracking_code ?? null : null,
      courier_order_id: apiResult.ok ? apiResult.order_id ?? null : null,
      last_error: apiResult.ok ? null : apiResult.message ?? "Unknown error",
      api_response: (apiResult.raw ?? null) as any,
      sent_at: apiResult.ok ? new Date().toISOString() : null,
    };

    if (existing) {
      const { error } = await supabase.from("courier_orders").update(row).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("courier_orders").insert(row);
      if (error) throw new Error(error.message);
    }

    if (!apiResult.ok) {
      return { ok: false as const, message: apiResult.message ?? "Courier order failed", cod_amount: cod };
    }

    return {
      ok: true as const,
      courier: data.courier,
      consignment_id: row.consignment_id,
      tracking_code: row.tracking_code,
      status: row.status,
      cod_amount: cod,
    };
  });

export const refreshCourierStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { saleId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: order, error } = await supabase
      .from("courier_orders")
      .select("id,courier,consignment_id,status")
      .eq("sale_id", data.saleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order?.consignment_id) return { ok: false as const, message: "No consignment to track yet." };

    if (order.courier !== "steadfast") return { ok: false as const, message: "Tracking not supported for this courier." };

    const apiKey = process.env["STEADFAST_API_KEY"];
    const secretKey = process.env["STEADFAST_SECRET_KEY"];
    if (!apiKey || !secretKey) return { ok: false as const, message: "Steadfast API credentials are not configured." };

    try {
      const res = await fetch(`https://portal.packzy.com/api/v1/status_by_cid/${order.consignment_id}`, {
        headers: { "Api-Key": apiKey, "Secret-Key": secretKey, Accept: "application/json" },
      });
      const json: any = await res.json().catch(() => null);
      const status = json?.delivery_status;
      if (!res.ok || !status) return { ok: false as const, message: json?.message ?? `HTTP ${res.status}` };

      await supabase.from("courier_orders").update({ status: String(status) }).eq("id", order.id);
      return { ok: true as const, status: String(status) };
    } catch (e: any) {
      return { ok: false as const, message: e?.message ?? "Network error" };
    }
  });

/**
 * Asks Steadfast for the latest status of every parcel that is still on the
 * way (up to 150 at a time) and saves any change. Only courier_orders rows
 * change — the sale, stock and payments are never touched.
 */
export const refreshAllCourierStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env["STEADFAST_API_KEY"];
    const secretKey = process.env["STEADFAST_SECRET_KEY"];
    if (!apiKey || !secretKey) return { ok: false as const, message: "Steadfast API credentials are not configured." };

    const { data: orders, error } = await supabase
      .from("courier_orders")
      .select("id,invoice_no,consignment_id,status")
      .eq("courier", "steadfast")
      .not("consignment_id", "is", null)
      .not("status", "in", "(delivered,partial_delivered,cancelled,failed)")
      .order("created_at", { ascending: true })
      .limit(Math.min(150, Math.max(1, Number(data.limit) || 150)));
    if (error) throw new Error(error.message);

    const list = orders ?? [];
    const changed: { invoice_no: string; from: string; to: string }[] = [];
    let failed = 0;
    // A few at a time so the courier API is not flooded.
    for (let i = 0; i < list.length; i += 5) {
      await Promise.all(
        list.slice(i, i + 5).map(async (o) => {
          try {
            const res = await fetch(`https://portal.packzy.com/api/v1/status_by_cid/${o.consignment_id}`, {
              headers: { "Api-Key": apiKey, "Secret-Key": secretKey, Accept: "application/json" },
            });
            const json: any = await res.json().catch(() => null);
            const status = json?.delivery_status ? String(json.delivery_status) : null;
            if (!res.ok || !status) { failed += 1; return; }
            if (status !== o.status) {
              const { error: uErr } = await supabase.from("courier_orders").update({ status }).eq("id", o.id);
              if (uErr) { failed += 1; return; }
              changed.push({ invoice_no: o.invoice_no ?? "", from: o.status, to: status });
            }
          } catch {
            failed += 1;
          }
        }),
      );
    }
    return { ok: true as const, checked: list.length, changed, failed };
  });

/** Connection test: asks Steadfast for the account balance (changes nothing). */
export const checkSteadfastConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const apiKey = process.env["STEADFAST_API_KEY"];
    const secretKey = process.env["STEADFAST_SECRET_KEY"];
    if (!apiKey || !secretKey) {
      return { ok: false as const, reason: "not_configured" as const, message: "STEADFAST_API_KEY / STEADFAST_SECRET_KEY are not set on this server." };
    }
    try {
      const res = await fetch("https://portal.packzy.com/api/v1/get_balance", {
        headers: { "Api-Key": apiKey, "Secret-Key": secretKey, Accept: "application/json" },
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json && Number(json.status) === 200) {
        return { ok: true as const, balance: Number(json.current_balance ?? 0) };
      }
      return { ok: false as const, reason: "rejected" as const, message: json?.message ?? `Steadfast answered HTTP ${res.status} — check the API key and secret key.` };
    } catch (e: any) {
      return { ok: false as const, reason: "network" as const, message: e?.message ?? "Could not reach Steadfast" };
    }
  });
