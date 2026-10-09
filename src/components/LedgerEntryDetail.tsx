import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type LedgerEntry = {
  id: string;
  kind: "sale" | "payment" | "return";
  at: string;
  particulars: string;
  ref?: string | null;
  saleId?: string | null;
  sourceId: string;
  debit: number;
  credit: number;
};

const fmt = (n: number) =>
  `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function LedgerEntryDetail({
  entry,
  ownerId,
  onOpenChange,
}: {
  entry: LedgerEntry | null;
  ownerId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const saleId = entry?.saleId ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["ledger-entry-detail", entry?.id, saleId, ownerId],
    enabled: !!entry,
    queryFn: async () => {
      const dayStart = new Date(entry!.at);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const [saleRes, itemsRes, paysRes, retsRes, apptRes] = await Promise.all([
        saleId
          ? supabase.from("sales").select("id,invoice_no,created_at,subtotal,discount,tax,total,paid,due,status,notes").eq("id", saleId).maybeSingle()
          : Promise.resolve({ data: null as any }),
        saleId
          ? supabase.from("sale_items").select("id,name,quantity,unit_price,discount,tax,line_total,returned_quantity").eq("sale_id", saleId)
          : Promise.resolve({ data: [] as any[] }),
        saleId
          ? supabase.from("payments").select("id,amount,method,reference,received_at").eq("sale_id", saleId).order("received_at")
          : Promise.resolve({ data: [] as any[] }),
        saleId
          ? supabase.from("sale_returns").select("id,return_no,refund_amount,refund_method,reason,created_at").eq("sale_id", saleId).order("created_at")
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("appointments")
          .select("id,serial_no,scheduled_at,status,reason,notes,doctor_id,pet_id")
          .eq("owner_id", ownerId)
          .gte("scheduled_at", dayStart.toISOString())
          .lt("scheduled_at", dayEnd.toISOString())
          .order("scheduled_at"),
      ]);

      const appts = (apptRes.data ?? []) as any[];
      const doctorIds = [...new Set(appts.map((a) => a.doctor_id).filter(Boolean))];
      const petIds = [...new Set(appts.map((a) => a.pet_id).filter(Boolean))];
      const [docRes, petRes] = await Promise.all([
        doctorIds.length ? supabase.from("doctors").select("id,full_name").in("id", doctorIds) : Promise.resolve({ data: [] as any[] }),
        petIds.length ? supabase.from("pets").select("id,name,species").in("id", petIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const docMap = new Map((docRes.data ?? []).map((d: any) => [d.id, d.full_name]));
      const petMap = new Map((petRes.data ?? []).map((p: any) => [p.id, p]));

      return {
        sale: saleRes.data as any,
        items: (itemsRes.data ?? []) as any[],
        payments: (paysRes.data ?? []) as any[],
        returns: (retsRes.data ?? []) as any[],
        appointments: appts.map((a) => ({
          ...a,
          doctor_name: a.doctor_id ? docMap.get(a.doctor_id) : null,
          pet: a.pet_id ? petMap.get(a.pet_id) : null,
        })),
      };
    },
  });

  const focusPayment = entry?.kind === "payment" ? data?.payments.find((p: any) => p.id === entry.sourceId) : null;
  const focusReturn = entry?.kind === "return" ? data?.returns.find((r: any) => r.id === entry.sourceId) : null;

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entry?.particulars ?? "Ledger entry"}</DialogTitle>
          <DialogDescription>
            {entry ? format(new Date(entry.at), "dd MMM yyyy, hh:mm a") : ""}
            {entry?.ref ? ` · ${entry.ref}` : ""}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading details…</div>
        ) : (
          <div className="space-y-5">
            {focusPayment && (
              <section className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-2">This entry — payment</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Info label="Amount" value={fmt(Math.abs(Number(focusPayment.amount)))} />
                  <Info label="Method" value={String(focusPayment.method)} />
                  <Info label="Reference" value={focusPayment.reference || "—"} />
                  <Info label="Received" value={format(new Date(focusPayment.received_at), "dd MMM, hh:mm a")} />
                </div>
              </section>
            )}

            {focusReturn && (
              <section className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-2">This entry — sale return</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Info label="Return no" value={focusReturn.return_no} />
                  <Info label="Refund" value={fmt(Number(focusReturn.refund_amount))} />
                  <Info label="Method" value={focusReturn.refund_method || "Adjusted to due"} />
                  <Info label="Reason" value={focusReturn.reason || "—"} />
                </div>
              </section>
            )}

            {data?.sale ? (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Invoice {data.sale.invoice_no}</span>
                  <Badge variant={data.sale.status === "completed" ? "secondary" : "outline"}>{data.sale.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(data.sale.created_at), "dd MMM yyyy, hh:mm a")}
                  </span>
                </div>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No items</TableCell></TableRow>
                      )}
                      {data.items.map((it: any) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-sm">
                            {it.name}
                            {Number(it.returned_quantity) > 0 && (
                              <span className="ml-2 text-xs text-amber-600">returned {it.returned_quantity}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(Number(it.unit_price))}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(Number(it.line_total))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-sm">
                  <Info label="Subtotal" value={fmt(Number(data.sale.subtotal))} />
                  <Info label="Discount" value={fmt(Number(data.sale.discount))} />
                  <Info label="Total" value={fmt(Number(data.sale.total))} />
                  <Info label="Paid" value={fmt(Number(data.sale.paid))} />
                  <Info label="Due" value={fmt(Number(data.sale.due))} />
                </div>
              </section>
            ) : (
              <div className="text-sm text-muted-foreground">No invoice linked to this entry.</div>
            )}

            {data?.payments?.length ? (
              <>
                <Separator />
                <section className="space-y-2">
                  <div className="font-medium text-sm">Payments / refunds on this invoice</div>
                  {data.payments.map((p: any) => (
                    <div
                      key={p.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm ${
                        p.id === entry?.sourceId ? "border-primary/60 bg-primary/5" : ""
                      }`}
                    >
                      <span>
                        {format(new Date(p.received_at), "dd MMM yyyy, hh:mm a")} · {p.method}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </span>
                      <span className={`tabular-nums font-medium ${Number(p.amount) < 0 ? "text-destructive" : "text-emerald-600"}`}>
                        {fmt(Number(p.amount))}
                      </span>
                    </div>
                  ))}
                </section>
              </>
            ) : null}

            {data?.returns?.length ? (
              <>
                <Separator />
                <section className="space-y-2">
                  <div className="font-medium text-sm">Returns on this invoice</div>
                  {data.returns.map((r: any) => (
                    <div
                      key={r.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm ${
                        r.id === entry?.sourceId ? "border-primary/60 bg-primary/5" : ""
                      }`}
                    >
                      <span>
                        {r.return_no} · {format(new Date(r.created_at), "dd MMM yyyy, hh:mm a")}
                        {r.reason ? ` · ${r.reason}` : ""}
                      </span>
                      <span className="tabular-nums font-medium text-amber-600">{fmt(Number(r.refund_amount))}</span>
                    </div>
                  ))}
                </section>
              </>
            ) : null}

            <Separator />
            <section className="space-y-2">
              <div className="font-medium text-sm">Appointments on this day</div>
              {data?.appointments?.length ? (
                data.appointments.map((a: any) => (
                  <div key={a.id} className="rounded-md border p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {a.serial_no ? `#${a.serial_no} · ` : ""}
                        {format(new Date(a.scheduled_at), "hh:mm a")}
                      </span>
                      <Badge variant="outline">{a.status}</Badge>
                      {a.pet && <span className="text-xs text-muted-foreground">{a.pet.name} ({a.pet.species})</span>}
                      {a.doctor_name && <span className="text-xs text-muted-foreground">Dr. {a.doctor_name}</span>}
                    </div>
                    {(a.reason || a.notes) && (
                      <div className="mt-1 text-xs text-muted-foreground">{a.reason || a.notes}</div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No appointment on this day.</div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular-nums font-medium">{value}</div>
    </div>
  );
}
