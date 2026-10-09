import { useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { sendInvoiceWhatsApp } from "@/lib/whatsapp.functions";
import { shareInvoiceOnWhatsApp, type Receipt } from "@/lib/invoice-print";

// Remembered after the first call: is the Cloud API set up on the server?
// null = not known yet. The manual button must open wa.me synchronously (a
// window opened after an await is blocked as a pop-up), so it only goes
// through the API once we know the API works.
let apiReady: boolean | null = null;

/**
 * Sends an invoice on WhatsApp.
 *  - auto: true  → right after a sale; sends silently through the Cloud API and
 *    never opens a window. Skips when the API is not set up or there is no
 *    customer mobile number.
 *  - auto: false → the WhatsApp button; uses the Cloud API when it is known to
 *    work, otherwise the old wa.me window (you press Send yourself).
 */
export function useWhatsAppInvoice() {
  const send = useServerFn(sendInvoiceWhatsApp);

  return useCallback(
    async (receipt: Receipt, saleId: string | null | undefined, opts: { auto?: boolean } = {}) => {
      const auto = !!opts.auto;
      if (!auto && (apiReady !== true || !saleId || !receipt.owner?.phone)) {
        shareInvoiceOnWhatsApp(receipt);
        return;
      }
      if (!saleId || !receipt.owner?.phone) return;
      try {
        const res = await send({ data: { saleId } });
        if (res.ok) {
          apiReady = true;
          toast.success(`Invoice ${receipt.invoice_no} sent on WhatsApp to +${res.to}`);
          return;
        }
        if (res.reason === "not_configured") {
          apiReady = false;
          return;
        }
        apiReady = true;
        toast.error(`WhatsApp not sent: ${res.message}`);
      } catch (e: any) {
        toast.error(`WhatsApp not sent: ${e?.message ?? "unknown error"}`);
      }
    },
    [send],
  );
}
