import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const METHODS = ["cash", "bkash", "nagad", "rocket", "card", "bank"] as const;
export const money = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

export type ApptForPayment = {
  id: string;
  serial_no: number | null;
  fee: number;
  paid: number;
  pet_name?: string | null;
  owner_name?: string | null;
};

export function ReceiveAppointmentCashDialog({
  appointment,
  onClose,
}: {
  appointment: ApptForPayment | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const due = Math.max(Number(appointment?.fee ?? 0) - Number(appointment?.paid ?? 0), 0);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");

  useEffect(() => {
    if (appointment) {
      setAmount(due > 0 ? String(due) : "");
      setMethod("cash");
      setReference("");
    }
  }, [appointment?.id]);

  const receive = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("Enter an amount");
      const { data, error } = await supabase.rpc("receive_appointment_payment" as any, {
        _appointment_id: appointment!.id,
        _amount: amt,
        _method: method as any,
        _reference: reference.trim() || null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      toast.success(`Received ${money(Number(amount))} · sales entry created`);
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["cash"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
      onClose();
      void res;
    },
    onError: (e: any) => toast.error(e.message ?? "Payment failed"),
  });

  return (
    <Dialog open={!!appointment} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Receive payment</DialogTitle>
        </DialogHeader>

        {appointment && (
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="font-medium">
                #{appointment.serial_no ?? "-"} · {appointment.pet_name ?? "—"}
              </div>
              <div className="text-muted-foreground text-xs">{appointment.owner_name ?? "—"}</div>
              <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
                <div><div className="text-muted-foreground">Fee</div><div className="font-medium tabular-nums">{money(appointment.fee)}</div></div>
                <div><div className="text-muted-foreground">Paid</div><div className="font-medium tabular-nums">{money(appointment.paid)}</div></div>
                <div><div className="text-muted-foreground">Due</div><div className="font-medium tabular-nums text-destructive">{money(due)}</div></div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Amount</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              {due > 0 && (
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setAmount(String(due))}>Full {money(due)}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setAmount(String(Math.round(due / 2)))}>Half</Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {method !== "cash" && (
              <div className="space-y-2">
                <Label>Reference</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="TrxID / last 4 digits" />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => receive.mutate()} disabled={receive.isPending || !Number(amount)}>
            Receive {amount ? money(Number(amount)) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
