import { createFileRoute } from "@tanstack/react-router";

/**
 * Steadfast → our app: called by Steadfast whenever a parcel's status changes.
 *
 * Steadfast panel → Settings → API / Webhook:
 *   Callback URL : https://<your-site>/api/steadfast-webhook
 *   Auth Token   : the same value as the STEADFAST_WEBHOOK_TOKEN secret
 *
 * Needs the secrets STEADFAST_WEBHOOK_TOKEN and SUPABASE_SERVICE_ROLE_KEY.
 * Only the courier_orders row changes (status) — never the sale, stock,
 * payments or accounts.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/steadfast-webhook")({
  server: {
    handlers: {
      GET: async () => json({ status: "ok", message: "Steadfast webhook endpoint. Use POST." }),
      POST: async ({ request }) => {
        const expected = process.env["STEADFAST_WEBHOOK_TOKEN"];
        if (!expected) return json({ status: "error", message: "Webhook is not configured" }, 503);
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "").trim();
        if (!token || token !== expected) return json({ status: "error", message: "Unauthorized" }, 401);

        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return json({ status: "error", message: "Invalid JSON" }, 400);
        }

        const consignmentId = payload?.consignment_id != null ? String(payload.consignment_id) : "";
        const invoice = payload?.invoice != null ? String(payload.invoice) : "";
        const status = String(payload?.status ?? payload?.delivery_status ?? "").trim().toLowerCase();
        if ((!consignmentId && !invoice) || !status) {
          // Other notification types (e.g. tracking messages) — acknowledge and ignore.
          return json({ status: "success", message: "Ignored" });
        }
        if (!/^[a-z_]{2,40}$/.test(status)) return json({ status: "error", message: "Invalid status" }, 400);

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          let q = supabaseAdmin.from("courier_orders").update({ status }).eq("courier", "steadfast");
          q = consignmentId ? q.eq("consignment_id", consignmentId) : q.eq("invoice_no", invoice);
          const { data, error } = await q.select("id");
          if (error) return json({ status: "error", message: error.message }, 500);
          return json({ status: "success", message: data?.length ? "Updated" : "No matching parcel" });
        } catch (e: any) {
          // e.g. SUPABASE_SERVICE_ROLE_KEY is not set on the server.
          return json({ status: "error", message: e?.message ?? "Server error" }, 500);
        }
      },
    },
  },
});
