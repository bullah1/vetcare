import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bike, HandCoins, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { suggestedCourierCharge, type Shipment } from "@/lib/shipments";

const db = supabase as any;
const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 0 })}`;

type Group = { key: string; name: string; kind: "local" | "courier"; list: Shipment[]; owed: number; pending: number; open: number };

/**
 * Rider & courier settlement. Records what each delivery really cost and
 * whether the money was settled — tracking only: the sale, payments, stock
 * and accounts are never changed here.
 */
export function DeliverySettlement({ shipments, onChanged }: { shipments: Shipment[]; onChanged: () => void }) {
  const [open, setOpen] = useState<Group | null>(null);
  const ready = shipments.length === 0 || shipments.every((s) => s.settlementReady);

  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const s of shipments) {
      if (s.stage === "progress") continue; // settle once the parcel is finished
      const g = m.get(s.agentKey) ?? { key: s.agentKey, name: s.agent, kind: s.kind, list: [], owed: 0, pending: 0, open: 0 };
      g.list.push(s);
      if (s.kind === "local") {
        if (!s.riderPaid) g.owed += s.riderFee;
        if (s.stage === "delivered" && !s.cashReceived) g.pending += s.collect;
        if (!s.riderPaid || (s.stage === "delivered" && !s.cashReceived) || s.cost == null) g.open += 1;
      } else {
        if (s.stage === "delivered" && s.codReceived == null) g.pending += s.collect;
        if (s.codReceived == null || s.cost == null) g.open += 1;
      }
      m.set(s.agentKey, g);
    }
    return [...m.values()].sort((a, b) => b.open - a.open);
  }, [shipments]);

  if (!groups.length) return null;

  return (
    <Card className="mb-4">
      <CardContent className="p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Rider & courier settlement</p>
          <p className="text-[11px] text-muted-foreground">Tracking only — sales, stock and accounts are not changed</p>
        </div>
        {!ready && (
          <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            Run the new SQL (delivery costs) once to start recording rider fees and courier settlement.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <div key={g.key} className="flex items-center gap-3 rounded-lg border p-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${g.kind === "courier" ? "bg-primary/10 text-primary" : "bg-sky-100 text-sky-800"}`}>
                {g.kind === "courier" ? <Truck className="h-4 w-4" /> : <Bike className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{g.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {g.kind === "courier" ? `COD to receive ${fmt(g.pending)}` : `Cash to receive ${fmt(g.pending)} · fee owed ${fmt(g.owed)}`}
                </p>
              </div>
              <Button size="sm" variant={g.open ? "default" : "outline"} disabled={!ready} onClick={() => setOpen(g)}>
                <HandCoins className="h-3.5 w-3.5" /> {g.open ? `Settle (${g.open})` : "View"}
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
      {open && open.kind === "local" && <RiderDialog group={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onChanged(); }} />}
      {open && open.kind === "courier" && <CourierDialog group={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onChanged(); }} />}
    </Card>
  );
}

function RiderDialog({ group, onClose, onSaved }: { group: Group; onClose: () => void; onSaved: () => void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(group.list.filter((s) => !s.riderPaid || (s.stage === "delivered" && !s.cashReceived)).map((s) => s.rowId)));
  const [fees, setFees] = useState<Record<string, string>>(() => Object.fromEntries(group.list.map((s) => [s.rowId, s.riderFee ? String(s.riderFee) : ""])));
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = group.list.filter((s) => sel.has(s.rowId));
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const run = async (paid: boolean | null, cash: boolean | null) => {
    if (!picked.length) { toast.error("Select at least one delivery"); return; }
    setBusy(true);
    try {
      // Save each changed fee, then the paid / received marks for the selection.
      for (const s of picked) {
        const f = fees[s.rowId];
        const val = f === "" ? 0 : Number(f);
        if (!(val >= 0)) throw new Error(`Invalid fee for ${s.invoiceNo}`);
        if (val !== s.riderFee) {
          const { error } = await db.rpc("set_delivery_settlement", { _delivery_ids: [s.rowId], _rider_fee: val, _rider_paid: null, _cash_received: null });
          if (error) throw error;
        }
      }
      if (paid !== null || cash !== null) {
        const ids = picked.filter((s) => cash === null || s.stage === "delivered").map((s) => s.rowId);
        const { error } = await db.rpc("set_delivery_settlement", { _delivery_ids: ids, _rider_fee: null, _rider_paid: paid, _cash_received: cash });
        if (error) throw error;
      }
      toast.success("Settlement saved");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const feeTotal = picked.reduce((a, s) => a + (Number(fees[s.rowId]) || 0), 0);
  const cashTotal = picked.filter((s) => s.stage === "delivered" && !s.cashReceived).reduce((a, s) => a + s.collect, 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Bike className="h-4 w-4" /> Settle rider — {group.name}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Fee per delivery for selected:</span>
          <Input value={bulk} onChange={(e) => setBulk(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 40" className="h-8 w-24" inputMode="decimal" />
          <Button size="sm" variant="outline" onClick={() => setFees((f) => ({ ...f, ...Object.fromEntries(picked.map((s) => [s.rowId, bulk])) }))}>Apply</Button>
        </div>
        <div className="divide-y rounded-md border text-sm">
          {group.list.map((s) => (
            <label key={s.rowId} className="flex items-center gap-2 px-2.5 py-2">
              <Checkbox checked={sel.has(s.rowId)} onCheckedChange={() => toggle(s.rowId)} />
              <div className="min-w-0 flex-1">
                <p className="truncate"><b>{s.invoiceNo}</b> · {s.customer} <span className="text-xs text-muted-foreground">· {s.statusLabel}</span></p>
                <p className="text-[11px] text-muted-foreground">
                  Charge {fmt(s.charge)} · collects {s.stage === "delivered" ? fmt(s.collect) : "—"}
                  {s.riderPaid ? " · fee paid" : ""}{s.cashReceived ? " · cash received" : ""}
                </p>
              </div>
              <Input
                value={fees[s.rowId] ?? ""}
                onChange={(e) => setFees((f) => ({ ...f, [s.rowId]: e.target.value.replace(/[^0-9.]/g, "") }))}
                placeholder="Fee"
                className="h-8 w-20 text-right"
                inputMode="decimal"
                onClick={(e) => e.stopPropagation()}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Selected: fee {fmt(feeTotal)} · cash to receive {fmt(cashTotal)}. Collect the invoice due itself from Due Bills as usual.</p>
        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="outline" onClick={() => run(null, null)} disabled={busy}>Save fees</Button>
          <Button variant="outline" onClick={() => run(null, true)} disabled={busy}>Cash received</Button>
          <Button onClick={() => run(true, null)} disabled={busy}>Fee paid to rider</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CourierDialog({ group, onClose, onSaved }: { group: Group; onClose: () => void; onSaved: () => void }) {
  const init = (s: Shipment) => ({
    actual: s.actualCharge != null ? String(s.actualCharge) : String(suggestedCourierCharge(s)),
    ret: s.returnCharge ? String(s.returnCharge) : "",
    cod: s.codReceived != null ? String(s.codReceived) : "",
  });
  const [vals, setVals] = useState<Record<string, { actual: string; ret: string; cod: string }>>(() => Object.fromEntries(group.list.map((s) => [s.rowId, init(s)])));
  const [sel, setSel] = useState<Set<string>>(() => new Set(group.list.filter((s) => s.codReceived == null || s.cost == null).map((s) => s.rowId)));
  const [busy, setBusy] = useState(false);
  const set = (id: string, k: "actual" | "ret" | "cod", v: string) => setVals((p) => ({ ...p, [id]: { ...p[id], [k]: v.replace(/[^0-9.]/g, "") } }));
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Delivered: courier pays COD minus its deduction. Returned: nothing comes back.
  const autoCod = (s: Shipment) => {
    const v = vals[s.rowId];
    return s.stage === "delivered" ? Math.max(0, s.collect - (Number(v.actual) || 0)) : 0;
  };

  const save = async () => {
    const picked = group.list.filter((s) => sel.has(s.rowId));
    if (!picked.length) { toast.error("Select at least one parcel"); return; }
    setBusy(true);
    try {
      for (const s of picked) {
        const v = vals[s.rowId];
        const actual = Number(v.actual);
        const ret = v.ret === "" ? 0 : Number(v.ret);
        const cod = v.cod === "" ? autoCod(s) : Number(v.cod);
        if (!(actual >= 0) || !(ret >= 0) || !(cod >= 0)) throw new Error(`Invalid amount for ${s.invoiceNo}`);
        const { error } = await db
          .from("courier_orders")
          .update({ actual_charge: actual, return_charge: ret, cod_received: cod, cod_received_at: new Date().toISOString() })
          .eq("id", s.rowId);
        if (error) throw error;
      }
      toast.success(`${picked.length} parcel(s) settled`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Truck className="h-4 w-4" /> Courier settlement — {group.name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          From the courier's payment statement: <b>Courier charge</b> = what they deducted (delivery + COD fee), <b>Return charge</b> for returned parcels,
          <b> COD received</b> = money they paid to you (empty = COD − courier charge).
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr><th className="p-2" /><th className="p-2 text-left">Parcel</th><th className="p-2 text-right">COD</th><th className="p-2 text-right">Courier charge</th><th className="p-2 text-right">Return charge</th><th className="p-2 text-right">COD received</th></tr>
            </thead>
            <tbody className="divide-y">
              {group.list.map((s) => (
                <tr key={s.rowId}>
                  <td className="p-2"><Checkbox checked={sel.has(s.rowId)} onCheckedChange={() => toggle(s.rowId)} /></td>
                  <td className="p-2">
                    <p className="font-medium">{s.invoiceNo}</p>
                    <p className="text-[11px] text-muted-foreground">{s.statusLabel}{s.codReceived != null ? " · settled" : ""}</p>
                  </td>
                  <td className="p-2 text-right tabular-nums">{s.stage === "delivered" ? fmt(s.collect) : "—"}</td>
                  <td className="p-2"><Input value={vals[s.rowId].actual} onChange={(e) => set(s.rowId, "actual", e.target.value)} className="ml-auto h-8 w-24 text-right" inputMode="decimal" /></td>
                  <td className="p-2"><Input value={vals[s.rowId].ret} onChange={(e) => set(s.rowId, "ret", e.target.value)} placeholder="0" className="ml-auto h-8 w-20 text-right" inputMode="decimal" /></td>
                  <td className="p-2"><Input value={vals[s.rowId].cod} onChange={(e) => set(s.rowId, "cod", e.target.value)} placeholder={String(autoCod(s))} className="ml-auto h-8 w-24 text-right" inputMode="decimal" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Receiving the COD does not collect the invoice due by itself — collect it from Due Bills (same as before) so accounts stay correct.</p>
        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settlement"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
