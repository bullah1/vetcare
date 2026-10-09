import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Bike, FileText, History, MessageCircle, Pencil, Plus, Search, Users } from "lucide-react";
import { printInvoice, shareInvoiceOnWhatsApp } from "@/lib/invoice-print";
import { fetchSaleReceipt } from "@/lib/sale-receipt";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchAll } from "@/lib/fetch-all";
import { dayRangeISO, todayDhaka } from "@/lib/sales-ledger";
import { shiftDay } from "@/lib/sales-summary";
import {
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_TONE,
  NEXT_STATUSES,
  fetchDeliveryHistory,
  fetchDeliveryMen,
  saveDeliveryMan,
  setDeliveryStatus,
  updateDeliveryDetails,
  type Delivery,
  type DeliveryMan,
  type DeliveryStatus,
} from "@/lib/deliveries";

export const Route = createFileRoute("/_authenticated/deliveries")({
  head: () => ({
    meta: [
      { title: "Deliveries — Delivery Tracking | Pet Care Vet ERP" },
      { name: "description", content: "Track which invoice is out with which delivery man, where it is going, the delivery charge and its status." },
      { property: "og:title", content: "Deliveries — Delivery Tracking | Pet Care Vet ERP" },
      { property: "og:description", content: "Delivery tracking only — no effect on sales, payments, stock or cash." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeliveriesPage,
});

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const STATUSES: DeliveryStatus[] = ["pending", "out_for_delivery", "delivered", "cancelled"];
const db = supabase as any;

function StatusBadge({ s }: { s: DeliveryStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${DELIVERY_STATUS_TONE[s]}`}>
      {DELIVERY_STATUS_LABEL[s]}
    </span>
  );
}

function DeliveriesPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Deliveries"
        description="Who is delivering which invoice, where, the charge and the status — tracking only, no effect on sales or cash."
        icon={Bike}
      />
      <Tabs defaultValue="deliveries">
        <TabsList>
          <TabsTrigger value="deliveries"><Bike className="h-4 w-4" /> Deliveries</TabsTrigger>
          <TabsTrigger value="men"><Users className="h-4 w-4" /> Delivery Men</TabsTrigger>
        </TabsList>
        <TabsContent value="deliveries" className="mt-4"><DeliveriesTab /></TabsContent>
        <TabsContent value="men" className="mt-4"><DeliveryMenTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ----------------------------- Deliveries ----------------------------- */

function DeliveriesTab() {
  const [from, setFrom] = useState(shiftDay(todayDhaka(), -29));
  const [to, setTo] = useState(todayDhaka());
  const [manFilter, setManFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | DeliveryStatus>("all");
  const [q, setQ] = useState("");
  const [historyFor, setHistoryFor] = useState<Delivery | null>(null);

  // The window is opened on the click itself (so it is not blocked as a pop-up),
  // then filled once the invoice has loaded.
  const openInvoice = async (saleId: string, mode: "print" | "whatsapp", phone?: string | null) => {
    const w = window.open("", "_blank", mode === "print" ? "width=900,height=1000" : undefined);
    if (!w) { toast.error("Enable pop-ups to open the invoice"); return; }
    w.document.write("<p style=\"font:14px system-ui;padding:24px\">Loading invoice…</p>");
    try {
      const r = await fetchSaleReceipt(saleId);
      if (mode === "print") printInvoice(r, w);
      else shareInvoiceOnWhatsApp(r, phone ?? undefined, w);
    } catch (e: any) {
      w.close();
      toast.error(e?.message ?? "Could not load the invoice");
    }
  };
  const [editFor, setEditFor] = useState<Delivery | null>(null);
  const [cancelFor, setCancelFor] = useState<Delivery | null>(null);

  const { data: men = [] } = useQuery({ queryKey: ["delivery-men", "all"], queryFn: () => fetchDeliveryMen(true) });

  const { data: rows = [], isFetching, error } = useQuery({
    queryKey: ["deliveries", from, to],
    queryFn: async () => {
      const { fromISO, toISO } = dayRangeISO(from, to);
      return fetchAll<Delivery>(() =>
        db.from("deliveries").select("*").gte("created_at", fromISO).lte("created_at", toISO).order("created_at", { ascending: false }).order("id"),
      );
    },
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((d) => {
      if (manFilter !== "all" && d.delivery_man_id !== manFilter) return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (!term) return true;
      return [d.invoice_no, d.customer_name, d.customer_phone, d.delivery_man_name, d.delivery_man_phone]
        .some((v) => (v ?? "").toLowerCase().includes(term));
    });
  }, [rows, manFilter, statusFilter, q]);

  const summary = useMemo(() => {
    const by = (s: DeliveryStatus) => filtered.filter((d) => d.status === s);
    const live = filtered.filter((d) => d.status !== "cancelled");
    return {
      pending: by("pending").length,
      out: by("out_for_delivery").length,
      delivered: by("delivered").length,
      cancelled: by("cancelled").length,
      charge: live.reduce((a, d) => a + Number(d.delivery_charge || 0), 0),
    };
  }, [filtered]);

  const change = useMutation({
    mutationFn: ({ d, status, note }: { d: Delivery; status: DeliveryStatus; note?: string }) => setDeliveryStatus(d.id, status, note),
    onSuccess: (_r, v) => toast.success(`${v.d.invoice_no}: ${DELIVERY_STATUS_LABEL[v.status]}`),
    onError: (e: any) => toast.error(e.message ?? "Could not change status"),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {([
          ["Pending", summary.pending, "pending"],
          ["Out for Delivery", summary.out, "out_for_delivery"],
          ["Delivered", summary.delivered, "delivered"],
          ["Cancelled", summary.cancelled, "cancelled"],
        ] as const).map(([label, n, s]) => (
          <button key={s} type="button" className="text-left" onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}>
            <Card className={statusFilter === s ? "ring-2 ring-primary" : ""}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-2xl font-semibold tabular-nums">{n}</div>
              </CardContent>
            </Card>
          </button>
        ))}
        <Card className="col-span-2 lg:col-span-1"><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Delivery charges (not cancelled)</div>
          <div className="text-2xl font-semibold tabular-nums">{fmt(summary.charge)}</div>
          <div className="text-[11px] text-muted-foreground">info only — not in sales</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_170px_140px_140px]">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Invoice, customer, phone or delivery man" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={manFilter} onValueChange={setManFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All delivery men</SelectItem>
                {men.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{DELIVERY_STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Could not load deliveries: {(error as Error).message}. If this is the first time, the delivery database update has to be applied.
            </p>
          )}

          <div className="-mx-3 overflow-x-auto sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Delivery man</TableHead>
                  <TableHead className="text-right">Charge</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isFetching && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isFetching && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No deliveries found.</TableCell></TableRow>
                )}
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="align-top">
                      <div className="font-medium">{d.invoice_no}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(d.created_at), "dd MMM yyyy, hh:mm a")}</div>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <div>{d.customer_name || "Walk-in"}</div>
                      {d.customer_phone && <div className="text-xs text-muted-foreground">{d.customer_phone}</div>}
                      {d.customer_address && <div className="max-w-[16rem] text-xs text-muted-foreground">{d.customer_address}</div>}
                      {d.note && <div className="mt-1 text-xs italic text-muted-foreground">“{d.note}”</div>}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {(d.items ?? []).map((it, i) => <div key={i}>{String(it.name).trim()} × {Number(it.quantity)}</div>)}
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <div>{d.delivery_man_name}</div>
                      {d.delivery_man_phone && <div className="text-xs text-muted-foreground">{d.delivery_man_phone}</div>}
                    </TableCell>
                    <TableCell className="align-top text-right tabular-nums">{fmt(d.delivery_charge)}</TableCell>
                    <TableCell className="align-top"><StatusBadge s={d.status} /></TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap justify-end gap-1">
                        {NEXT_STATUSES[d.status].filter((s) => s !== "cancelled").map((s) => (
                          <Button key={s} size="sm" disabled={change.isPending} onClick={() => change.mutate({ d, status: s })}>
                            {s === "out_for_delivery" ? "Out for delivery" : "Delivered"}
                          </Button>
                        ))}
                        {NEXT_STATUSES[d.status].includes("cancelled") && (
                          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCancelFor(d)}>Cancel</Button>
                        )}
                        {(d.status === "pending" || d.status === "out_for_delivery") && (
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => setEditFor(d)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Delivery invoice (rider details)" onClick={() => openInvoice(d.sale_id, "print")}>
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-700" title="Send invoice to customer (WhatsApp)" onClick={() => openInvoice(d.sale_id, "whatsapp", d.customer_phone)}>
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Status history" onClick={() => setHistoryFor(d)}>
                          <History className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <CancelDialog
        d={cancelFor}
        onClose={() => setCancelFor(null)}
        onConfirm={(note) => {
          if (cancelFor) change.mutate({ d: cancelFor, status: "cancelled", note });
          setCancelFor(null);
        }}
      />
      <HistoryDialog d={historyFor} onClose={() => setHistoryFor(null)} />
      <EditDialog d={editFor} men={men} onClose={() => setEditFor(null)} />
    </div>
  );
}

function CancelDialog({ d, onClose, onConfirm }: { d: Delivery | null; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog open={!!d} onOpenChange={(o) => { if (!o) { onClose(); setNote(""); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Cancel delivery — {d?.invoice_no}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Only the delivery status becomes Cancelled. The invoice, payment, stock, cash and reports stay exactly as they are,
          and no refund is made.
        </p>
        <div className="space-y-2">
          <Label>Reason (optional)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. customer not at home" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Back</Button>
          <Button variant="destructive" onClick={() => { onConfirm(note); setNote(""); }}>Cancel delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ d, onClose }: { d: Delivery | null; onClose: () => void }) {
  const { data = [], isFetching } = useQuery({
    queryKey: ["delivery-history", d?.id],
    enabled: !!d,
    staleTime: 0,
    queryFn: () => fetchDeliveryHistory(d!.id),
  });
  return (
    <Dialog open={!!d} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Status history — {d?.invoice_no}</DialogTitle></DialogHeader>
        <ol className="space-y-3">
          {isFetching && data.length === 0 && <li className="text-sm text-muted-foreground">Loading…</li>}
          {data.map((h) => (
            <li key={h.id} className="rounded-md border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {h.from_status && h.from_status !== h.to_status && (<><StatusBadge s={h.from_status} /><span>→</span></>)}
                <StatusBadge s={h.to_status} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {format(new Date(h.changed_at), "dd MMM yyyy, hh:mm a")} · by {h.changed_by_name || "staff"}
              </div>
              {h.note && <div className="mt-1 text-xs">{h.note}</div>}
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ d, men, onClose }: { d: Delivery | null; men: DeliveryMan[]; onClose: () => void }) {
  const [manId, setManId] = useState("");
  const [charge, setCharge] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (d && loadedFor !== d.id) {
    setLoadedFor(d.id);
    setManId(d.delivery_man_id ?? "");
    setCharge(String(Number(d.delivery_charge)));
    setAddress(d.customer_address ?? "");
    setNote(d.note ?? "");
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!d) return;
      if (!manId) throw new Error("Choose a delivery man");
      const c = Number(charge);
      if (!(c >= 0)) throw new Error("Delivery charge must be 0 or more");
      await updateDeliveryDetails({ id: d.id, deliveryManId: manId, charge: c, address: address || null, note: note || null });
    },
    onSuccess: () => { toast.success("Delivery updated"); setLoadedFor(null); onClose(); },
    onError: (e: any) => toast.error(e.message ?? "Could not update"),
  });
  const choices = men.filter((m) => m.is_active || m.id === d?.delivery_man_id);
  return (
    <Dialog open={!!d} onOpenChange={(o) => { if (!o) { setLoadedFor(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit delivery — {d?.invoice_no}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Delivery man</Label>
            <Select value={manId} onValueChange={setManId}>
              <SelectTrigger><SelectValue placeholder="Choose delivery man" /></SelectTrigger>
              <SelectContent>
                {choices.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}{m.phone ? ` · ${m.phone}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Delivery charge</Label>
            <Input inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setLoadedFor(null); onClose(); }}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Delivery men ----------------------------- */

function DeliveryMenTab() {
  const { data: men = [], isFetching } = useQuery({ queryKey: ["delivery-men", "all"], queryFn: () => fetchDeliveryMen(true) });
  const { data: counts } = useQuery({
    queryKey: ["deliveries", "per-man"],
    queryFn: async () => {
      const rows = await fetchAll<{ delivery_man_id: string | null; status: DeliveryStatus }>(() =>
        db.from("deliveries").select("delivery_man_id,status").order("id"),
      );
      const m = new Map<string, { total: number; active: number; delivered: number }>();
      for (const r of rows) {
        if (!r.delivery_man_id) continue;
        const c = m.get(r.delivery_man_id) ?? { total: 0, active: 0, delivered: 0 };
        c.total++;
        if (r.status === "pending" || r.status === "out_for_delivery") c.active++;
        if (r.status === "delivered") c.delivered++;
        m.set(r.delivery_man_id, c);
      }
      return m;
    },
  });
  const [edit, setEdit] = useState<{ id?: string; name: string; phone: string; is_active: boolean } | null>(null);

  const save = useMutation({
    mutationFn: () => saveDeliveryMan({ id: edit?.id, name: edit?.name ?? "", phone: edit?.phone || null, is_active: edit?.is_active }),
    onSuccess: (m) => { toast.success(`${m.name} saved`); setEdit(null); },
    onError: (e: any) => toast.error(e.message ?? "Could not save"),
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{men.length} delivery m{men.length === 1 ? "an" : "en"}</p>
          <Button size="sm" onClick={() => setEdit({ name: "", phone: "", is_active: true })}><Plus className="h-4 w-4" /> Add delivery man</Button>
        </div>
        <div className="-mx-3 overflow-x-auto sm:mx-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">All</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isFetching && men.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No delivery men yet — add one.</TableCell></TableRow>
              )}
              {men.map((m) => {
                const c = counts?.get(m.id);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.phone || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c?.active ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{c?.delivered ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{c?.total ?? 0}</TableCell>
                    <TableCell>{m.is_active ? "Active" : <span className="text-muted-foreground">Inactive</span>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => setEdit({ id: m.id, name: m.name, phone: m.phone ?? "", is_active: m.is_active })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{edit?.id ? "Edit delivery man" : "Add delivery man"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input inputMode="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="01XXXXXXXXX" />
              </div>
              {edit.id && (
                <div className="flex items-center justify-between rounded-md border p-2">
                  <Label htmlFor="dm-active">Active (can get new deliveries)</Label>
                  <Switch id="dm-active" checked={edit.is_active} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button disabled={save.isPending || !edit?.name.trim()} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
