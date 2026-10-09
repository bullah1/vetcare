import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bike, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_TONE,
  createDelivery,
  fetchActiveDelivery,
  fetchDeliveryMen,
  saveDeliveryMan,
  type Delivery,
} from "@/lib/deliveries";

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

/**
 * "Delivery" from an invoice. Customer, phone, address and products come from
 * the invoice; the cashier only picks the delivery man and the charge.
 * Creating a delivery never changes the invoice, payment, stock or cash.
 */
export function DeliveryDialog({
  saleId,
  open,
  onOpenChange,
  onCreated,
}: {
  saleId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (d: Delivery | null) => void;
}) {
  const [manId, setManId] = useState("");
  const [charge, setCharge] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const { data: sale } = useQuery({
    queryKey: ["delivery-sale", saleId],
    enabled: open && !!saleId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,invoice_no,total,paid,due,status, owner:pet_owners(full_name,phone,address), sale_items(name,quantity,returned_quantity)")
        .eq("id", saleId!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: active, isFetching: activeLoading } = useQuery({
    queryKey: ["delivery-active", saleId],
    enabled: open && !!saleId,
    staleTime: 0,
    queryFn: () => fetchActiveDelivery(saleId!),
  });

  const { data: men = [], refetch: refetchMen } = useQuery({
    queryKey: ["delivery-men", "active"],
    enabled: open,
    queryFn: () => fetchDeliveryMen(false),
  });

  useEffect(() => {
    if (!open) return;
    setManId("");
    setCharge("");
    setNote("");
    setAdding(false);
    setNewName("");
    setNewPhone("");
  }, [open, saleId]);

  useEffect(() => {
    if (open) setAddress(sale?.owner?.address ?? "");
  }, [open, sale?.id, sale?.owner?.address]);

  useEffect(() => {
    if (open && !manId && men.length === 1) setManId(men[0].id);
  }, [open, men, manId]);

  const addMan = useMutation({
    mutationFn: () => saveDeliveryMan({ name: newName, phone: newPhone || null }),
    onSuccess: async (m) => {
      await refetchMen();
      setManId(m.id);
      setAdding(false);
      setNewName("");
      setNewPhone("");
      toast.success(`Delivery man ${m.name} added`);
    },
    onError: (e: any) => toast.error(e.message ?? "Could not add delivery man"),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!saleId) throw new Error("No invoice selected");
      if (!manId) throw new Error("Choose a delivery man");
      const c = charge.trim() === "" ? 0 : Number(charge);
      if (!(c >= 0)) throw new Error("Delivery charge must be 0 or more");
      await createDelivery({ saleId, deliveryManId: manId, charge: c, note, address });
      return fetchActiveDelivery(saleId);
    },
    onSuccess: (d) => {
      toast.success(`Delivery created for ${sale?.invoice_no ?? "invoice"} — Pending`);
      onCreated?.(d);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Could not create delivery"),
  });

  const items: { name: string; quantity: number; returned_quantity: number }[] = sale?.sale_items ?? [];
  const productTotal = Number(sale?.total ?? 0);
  const c = Number(charge) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bike className="h-4 w-4" /> Delivery — {sale?.invoice_no ?? "…"}
          </DialogTitle>
        </DialogHeader>

        {active && !activeLoading ? (
          <div className="space-y-3 text-sm">
            <p>This invoice already has a delivery:</p>
            <div className="rounded-md border p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">{active.delivery_man_name}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${DELIVERY_STATUS_TONE[active.status]}`}>
                  {DELIVERY_STATUS_LABEL[active.status]}
                </span>
              </div>
              <div className="text-muted-foreground">Charge {fmt(active.delivery_charge)} · {active.customer_address || "No address"}</div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button asChild>
                <Link to="/deliveries">Open Deliveries</Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Customer</span>
                <span className="text-right">
                  {sale?.owner?.full_name ?? "Walk-in"}
                  {sale?.owner?.phone ? ` · ${sale.owner.phone}` : ""}
                </span>
              </div>
              <div className="text-muted-foreground">Products</div>
              <ul className="list-inside list-disc text-xs">
                {items
                  .filter((it) => Number(it.quantity) > Number(it.returned_quantity))
                  .map((it, i) => (
                    <li key={i}>
                      {it.name.trim()} × {Number(it.quantity) - Number(it.returned_quantity)}
                    </li>
                  ))}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Delivery man</Label>
                {!adding && (
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdding(true)}>
                    <Plus className="h-3 w-3" /> New
                  </Button>
                )}
              </div>
              {adding ? (
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                  <Input placeholder="Phone" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                  <Button type="button" disabled={!newName.trim() || addMan.isPending} onClick={() => addMan.mutate()}>
                    Save
                  </Button>
                </div>
              ) : (
                <Select value={manId} onValueChange={setManId}>
                  <SelectTrigger>
                    <SelectValue placeholder={men.length ? "Choose delivery man" : "No delivery man yet — add one"} />
                  </SelectTrigger>
                  <SelectContent>
                    {men.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                        {m.phone ? ` · ${m.phone}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Delivery charge</Label>
                <Input inputMode="decimal" placeholder="0" value={charge} onChange={(e) => setCharge(e.target.value)} />
              </div>
              <div className="rounded-md border p-2 text-xs space-y-0.5 self-end">
                <div className="flex justify-between"><span className="text-muted-foreground">Product total</span><span>{fmt(productTotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span>{fmt(c)}</span></div>
                <div className="flex justify-between font-semibold"><span>Total bill</span><span>{fmt(productTotal + c)}</span></div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address" />
            </div>
            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. call before coming" />
            </div>

            <p className="text-xs text-muted-foreground">
              Tracking only — the invoice, payment, stock and cash are not changed. The delivery charge is shown on the
              invoice but is not added to sales or profit.
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={create.isPending || !manId || sale?.status === "void"} onClick={() => create.mutate()}>
                {create.isPending ? "Saving…" : "Create delivery"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
