import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Sends a sale invoice to the customer through the official WhatsApp Business
// Cloud API (Meta). Runs on the server so the access token never reaches the
// browser.
//
// Required secrets (Lovable Cloud → Secrets):
//   WHATSAPP_ACCESS_TOKEN      permanent System User token from Meta
//   WHATSAPP_PHONE_NUMBER_ID   "Phone number ID" from WhatsApp → API Setup
// Optional:
//   WHATSAPP_TEMPLATE_NAME     approved template name (default: invoice_receipt)
//   WHATSAPP_TEMPLATE_LANG     template language code (default: en)
//   WHATSAPP_API_VERSION       Graph API version (default: v21.0)
//
// The template body must have exactly 5 variables, in this order:
//   {{1}} customer name, {{2}} invoice no, {{3}} total, {{4}} paid, {{5}} due

export type WhatsAppSendResult =
  | { ok: true; messageId: string | null; to: string }
  | { ok: false; reason: "not_configured" | "no_phone" | "not_found" | "api_error"; message: string };

/** 01XXXXXXXXX / +8801XXXXXXXXX / 8801XXXXXXXXX → 8801XXXXXXXXX (Bangladesh mobile). */
export function normalizeBdPhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("01")) d = `88${d}`;
  if (d.length === 10 && d.startsWith("1")) d = `880${d}`;
  return /^8801[3-9]\d{8}$/.test(d) ? d : null;
}

// Template parameters may not contain new lines, tabs or long runs of spaces.
const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim()
    .slice(0, 200) || "-";

const amount = (n: unknown) => Number(n || 0).toFixed(2);

export const sendInvoiceWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { saleId: string; phone?: string | null }) => input)
  .handler(async ({ data, context }): Promise<WhatsAppSendResult> => {
    const token = process.env["WHATSAPP_ACCESS_TOKEN"];
    const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
    if (!token || !phoneNumberId) {
      return { ok: false, reason: "not_configured", message: "WhatsApp Cloud API is not set up yet." };
    }
    const templateName = process.env["WHATSAPP_TEMPLATE_NAME"] || "invoice_receipt";
    const templateLang = process.env["WHATSAPP_TEMPLATE_LANG"] || "en";
    const version = process.env["WHATSAPP_API_VERSION"] || "v21.0";

    // Amounts are read from the database, never trusted from the browser.
    const { data: sale, error } = await context.supabase
      .from("sales")
      .select("id,invoice_no,total,paid,due,status, owner:pet_owners(full_name,phone)")
      .eq("id", data.saleId)
      .maybeSingle();
    if (error) return { ok: false, reason: "api_error", message: error.message };
    if (!sale) return { ok: false, reason: "not_found", message: "Invoice not found." };

    const owner = (sale as any).owner as { full_name: string | null; phone: string | null } | null;
    const to = normalizeBdPhone(data.phone ?? owner?.phone);
    if (!to) return { ok: false, reason: "no_phone", message: "Customer has no valid mobile number." };

    const params = [
      clean(owner?.full_name || "Customer"),
      clean(sale.invoice_no),
      amount(sale.total),
      amount(sale.paid),
      amount(sale.due),
    ].map((text) => ({ type: "text", text }));

    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLang },
            components: [{ type: "body", parameters: params }],
          },
        }),
      });
    } catch (e: any) {
      return { ok: false, reason: "api_error", message: `Could not reach WhatsApp: ${e?.message ?? e}` };
    }

    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.error_data?.details || body?.error?.message || `WhatsApp error ${res.status}`;
      return { ok: false, reason: "api_error", message: msg };
    }
    return { ok: true, messageId: body?.messages?.[0]?.id ?? null, to };
  });
