// Print / send a held (pending) bill. It is printed as "PENDING BILL — UNPAID";
// nothing about the sale, stock or cash changes.
import { MessageCircle, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { heldBillReceipt, type HeldBill } from "@/lib/held-bills";
import { printInvoice, printThermal, shareInvoiceOnWhatsApp } from "@/lib/invoice-print";

/** Opens the print window right away (call inside the click), so the browser does not block it. */
export function openPrintWindow(kind: "thermal" | "a4" | "whatsapp") {
  return kind === "a4" ? window.open("", "_blank", "width=900,height=1000") : kind === "whatsapp" ? window.open("", "_blank") : window.open("", "_blank", "width=480,height=800");
}

export async function printHeldBill(bill: HeldBill, kind: "thermal" | "a4" | "whatsapp", preOpened?: Window | null) {
  const w = preOpened ?? openPrintWindow(kind);
  try {
    const r = await heldBillReceipt(bill);
    if (kind === "a4") printInvoice(r, w);
    else if (kind === "whatsapp") shareInvoiceOnWhatsApp(r, undefined, w);
    else printThermal(r, undefined, w);
  } catch (e: any) {
    w?.close();
    toast.error(e?.message ?? "Could not print the bill");
  }
}

export function HeldBillPrintMenu({ bill, size = "icon" }: { bill: HeldBill; size?: "icon" | "sm" }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {size === "icon" ? (
          <Button size="icon" variant="ghost" className="h-8 w-8" title="Print pending bill" aria-label="Print pending bill">
            <Printer className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm" variant="outline"><Printer className="h-4 w-4" /> Print</Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void printHeldBill(bill, "thermal")}><Printer className="h-4 w-4" /> Thermal 80mm</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void printHeldBill(bill, "a4")}><Printer className="h-4 w-4" /> A4</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void printHeldBill(bill, "whatsapp")}><MessageCircle className="h-4 w-4" /> WhatsApp</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
