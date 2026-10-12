import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Pencil, Plus, Printer, Receipt as ReceiptIcon, Search, Stethoscope, Syringe, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerPicker, useOwnerOptions } from "@/components/CustomerPetPicker";
import { fetchAll } from "@/lib/fetch-all";
import { fetchSaleReceipt } from "@/lib/sale-receipt";
import { printInvoice, printThermal } from "@/lib/invoice-print";
import { useAuth } from "@/lib/auth-context";
import {
  SERVICE_CATEGORIES,
  addProblem,
  categoryLabel,
  createClinicBill,
  doctorFeeFor,
  serviceCost,
  useDoctors,
  useProblems,
  useServices,
  type BillLine,
  type ClinicService,
  type ServiceMaterial,
} from "@/lib/clinic";

export const Route = createFileRoute("/_authenticated/clinic-bill")({
  validateSearch: (s: Record<string, unknown>): { appointment?: string } => ({
    appointment: typeof s.appointment === "string" && s.appointment ? s.appointment : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Service Bill — Clinic | Pet Care Vet" },
      { name: "description", content: "Bill clinic services, consultation and medicines in one invoice; manage the service list, problems and doctor fees." },
      { property: "og:title", content: "Service Bill — Clinic | Pet Care Vet" },
      { property: "og:description", content: "One bill for clinic services and products." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClinicBillPage,
});

const db = supabase as any;
const fmt = (v: number) => `৳${(Number(v) || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const METHODS = [
  { value: "cash", label: "Cash" }, { value: "bkash", label: "bKash" }, { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" }, { value: "card", label: "Card" }, { value: "bank", label: "Bank" },
];
const uid = () => Math.random().toString(36).slice(2);

function ClinicBillPage() {
  const { appointment } = Route.useSearch();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  return (
    <div className="min-w-0">
      <PageHeader
        title="Service Bill"
        description="Consultation, services and medicines in one bill — same invoice, payment and cash drawer as POS."
        icon={ReceiptIcon}
        actions={<Button asChild variant="outline"><Link to="/appointments"><CalendarDays className="h-4 w-4" /> Appointments</Link></Button>}
      />
      <Tabs defaultValue="bill">
        <TabsList className="mb-3">
          <TabsTrigger value="bill">New bill</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="setup">Problems & doctors</TabsTrigger>
        </TabsList>
        <TabsContent value="bill"><BillTab appointmentId={appointment ?? null} /></TabsContent>
        <TabsContent value="services"><ServicesTab isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="setup"><SetupTab isAdmin={isAdmin} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New bill

type ProductLite = { id: string; name: string; selling_price: number; stock_quantity: number; unit: string | null; purchase_price: number };

function useProductsLite() {
  return useQuery({
    queryKey: ["clinic-bill-products"],
    staleTime: 60_000,
    queryFn: () =>
      fetchAll<ProductLite>(() => supabase.from("products").select("id,name,selling_price,stock_quantity,unit,purchase_price").eq("is_active", true).order("name").order("id")),
  });
}

function BillTab({ appointmentId }: { appointmentId: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: services = [] } = useServices();
  const { data: doctors = [] } = useDoctors();
  const { data: products = [] } = useProductsLite();
  const { data: owners = [], isLoading: ownersLoading } = useOwnerOptions();

  const { data: appt, isLoading: apptLoading } = useQuery({
    queryKey: ["clinic-bill-appt", appointmentId],
    enabled: !!appointmentId,
    queryFn: async () => {
      const { data, error } = await db
        .from("appointments")
        .select("id,serial_no,scheduled_at,fee,status,sale_id,doctor_id,owner_id,reason,guest_name,guest_phone,guest_pet_name, pet:pets(id,name,species,owner_id, owner:pet_owners(id,full_name,phone)), doctor:doctors(full_name)")
        .eq("id", appointmentId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const [ownerId, setOwnerId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [lines, setLines] = useState<BillLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [payments, setPayments] = useState<{ key: string; method: string; amount: string }[]>([{ key: uid(), method: "cash", amount: "" }]);
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [done, setDone] = useState<{ sale_id: string; invoice_no: string; total: number; paid: number; due: number } | null>(null);
  const [touchedPay, setTouchedPay] = useState(false);

  // Fill from the appointment once.
  useEffect(() => {
    if (!appt) return;
    setOwnerId(appt.pet?.owner?.id ?? appt.owner_id ?? "");
    setDoctorId(appt.doctor_id ?? "");
    const fee = Number(appt.fee || 0);
    if (fee > 0) {
      setLines([{ key: uid(), kind: "consultation", name: `Consultation${appt.doctor?.full_name ? ` — Dr. ${appt.doctor.full_name}` : ""}`, quantity: 1, unit_price: fee, discount: 0 }]);
    }
  }, [appt?.id]);

  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unit_price - l.discount, 0);
  const disc = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, subtotal - disc);
  const paidSum = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  // Until the cashier types an amount, the first payment row follows the total.
  useEffect(() => {
    if (!touchedPay) setPayments((p) => (p.length === 1 ? [{ ...p[0], amount: total ? String(total) : "" }] : p));
  }, [total, touchedPay]);
  const due = Math.max(0, total - paidSum);
  const change = Math.max(0, paidSum - total);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return { svc: services.filter((s) => s.is_active).slice(0, 8), prod: [] as ProductLite[] };
    return {
      svc: services.filter((s) => s.is_active && s.name.toLowerCase().includes(t)).slice(0, 8),
      prod: products.filter((p) => p.name.toLowerCase().includes(t)).slice(0, 8),
    };
  }, [q, services, products]);

  const addService = (s: ClinicService) => {
    setLines((ls) => [...ls, { key: uid(), kind: "service", service_id: s.id, name: s.name.trim(), quantity: 1, unit_price: Number(s.price), discount: 0 }]);
    setQ("");
  };
  const addProduct = (p: ProductLite) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { key: uid(), kind: "product", product_id: p.id, name: p.name.trim(), quantity: 1, unit_price: Number(p.selling_price), discount: 0, stock: Number(p.stock_quantity) }];
    });
    setQ("");
  };
  const setLine = (key: string, patch: Partial<BillLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Add a service or product");
      if (lines.some((l) => !(l.quantity > 0) || l.unit_price < 0)) throw new Error("Check quantity and price");
      if (disc > subtotal) throw new Error("Discount is more than the bill");
      if (due > 0.004 && !ownerId) throw new Error("Choose the customer for a bill with due");
      // Names must be unique per line so each service line is tagged correctly.
      const seen = new Map<string, number>();
      const named = lines.map((l) => {
        const n = (seen.get(l.name) ?? 0) + 1;
        seen.set(l.name, n);
        return n > 1 && l.kind !== "product" ? { ...l, name: `${l.name} (${n})` } : l;
      });
      // Pay no more than the bill: the extra is change given back.
      let left = total;
      const pays = payments.map((p) => {
        const a = Math.min(Number(p.amount) || 0, left);
        left -= a;
        return { method: p.method, amount: Math.round(a * 100) / 100 };
      });
      return createClinicBill({ appointmentId, ownerId: ownerId || null, doctorId: doctorId || null, lines: named, payments: pays, discount: disc, notes });
    },
    onSuccess: (r) => {
      setDone(r);
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["clinic-bill-products"] });
      toast.success(`Bill ${r.invoice_no} saved`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save the bill"),
  });

  const print = async (kind: "a4" | "thermal") => {
    if (!done) return;
    const w = window.open("", "_blank", kind === "a4" ? "width=900,height=1000" : "width=420,height=800");
    try {
      const r = await fetchSaleReceipt(done.sale_id);
      if (kind === "a4") printInvoice(r, w);
      else { w?.close(); printThermal(r); }
    } catch (e: any) {
      w?.close();
      toast.error(e?.message ?? "Could not print");
    }
  };

  const reset = () => {
    setDone(null); setLines([]); setDiscount(""); setNotes(""); setOwnerId(""); setDoctorId(""); setTouchedPay(false);
    setPayments([{ key: uid(), method: "cash", amount: "" }]);
    if (appointmentId) navigate({ to: "/clinic-bill", search: {} });
  };

  if (appointmentId && apptLoading) return <p className="text-sm text-muted-foreground">Loading appointment…</p>;
  if (appt?.sale_id && !done) {
    return (
      <Card><CardContent className="space-y-3 p-4 text-sm sm:p-4">
        <p>This appointment already has a bill. Collect any due from <Link to="/due-bills" className="text-primary underline">Due Bills</Link>.</p>
        <Button variant="outline" onClick={reset}>Start a new bill</Button>
      </CardContent></Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        {/* Patient */}
        <Card><CardContent className="space-y-3 p-3 sm:p-4">
          {appt ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Serial #{appt.serial_no ?? "—"}</span>
              <b>{appt.pet?.name ?? appt.guest_pet_name ?? "—"}</b>
              <span className="text-muted-foreground">{appt.pet?.owner?.full_name ?? appt.guest_name ?? "Walk-in"}{(appt.pet?.owner?.phone ?? appt.guest_phone) ? ` · ${appt.pet?.owner?.phone ?? appt.guest_phone}` : ""}</span>
              {appt.reason && <span className="text-muted-foreground">· {appt.reason}</span>}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Customer</Label>
                <CustomerPicker owners={owners} loading={ownersLoading} value={ownerId} onChange={setOwnerId} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Doctor</Label>
                <Select value={doctorId || "none"} onValueChange={(v) => setDoctorId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Doctor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No doctor</SelectItem>
                    {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent></Card>

        {/* Add */}
        <Card><CardContent className="space-y-2 p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a service or medicine / product…" className="h-11 pl-9" />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {results.svc.map((s) => (
              <button key={s.id} type="button" onClick={() => addService(s)} className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm hover:border-primary/50">
                <span className="min-w-0"><span className="block truncate font-medium">{s.name}</span><span className="text-[11px] text-muted-foreground">{categoryLabel(s.category)}</span></span>
                <span className="shrink-0 font-semibold tabular-nums">{fmt(s.price)}</span>
              </button>
            ))}
            {results.prod.map((p) => (
              <button key={p.id} type="button" onClick={() => addProduct(p)} className="flex items-center justify-between gap-2 rounded-lg border border-dashed bg-card px-3 py-2 text-left text-sm hover:border-primary/50">
                <span className="min-w-0"><span className="block truncate">{p.name.trim()}</span><span className="text-[11px] text-muted-foreground">Product · {Number(p.stock_quantity)} in stock</span></span>
                <span className="shrink-0 tabular-nums">{fmt(p.selling_price)}</span>
              </button>
            ))}
            {!services.length && !q && (
              <p className="text-xs text-muted-foreground sm:col-span-2">No services yet — add them in the <b>Services</b> tab. You can still add products by typing a name.</p>
            )}
          </div>
        </CardContent></Card>

        {/* Lines */}
        <Card><CardContent className="p-0">
          <div className="divide-y">
            {lines.map((l) => (
              <div key={l.key} className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  <p className="text-[11px] text-muted-foreground">{l.kind === "product" ? `Product${l.stock != null ? ` · ${l.stock} in stock` : ""}` : l.kind === "consultation" ? "Consultation" : "Service"}</p>
                </div>
                <Input aria-label="Quantity" value={String(l.quantity)} onChange={(e) => setLine(l.key, { quantity: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} className="h-8 w-14 text-center" inputMode="decimal" />
                <span className="text-xs text-muted-foreground">×</span>
                <Input aria-label="Price" value={String(l.unit_price)} onChange={(e) => setLine(l.key, { unit_price: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} className="h-8 w-24 text-right" inputMode="decimal" />
                <span className="w-24 text-right text-sm font-semibold tabular-nums">{fmt(l.quantity * l.unit_price - l.discount)}</span>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {!lines.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Add services or products to start the bill.</p>}
          </div>
        </CardContent></Card>
      </div>

      {/* Totals & payment */}
      <Card className="h-fit lg:sticky lg:top-20"><CardContent className="space-y-3 p-4 sm:p-4">
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{fmt(subtotal)}</span></div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Discount</span>
          <Input value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="h-8 w-28 text-right" inputMode="decimal" />
        </div>
        <div className="flex items-baseline justify-between border-t pt-2"><span className="font-medium">Total</span><span className="text-2xl font-bold tabular-nums">{fmt(total)}</span></div>

        <div className="space-y-2">
          <Label className="text-xs">Payment</Label>
          {payments.map((p, i) => (
            <div key={p.key} className="flex gap-2">
              <Select value={p.method} onValueChange={(v) => setPayments((ps) => ps.map((x) => (x.key === p.key ? { ...x, method: v } : x)))}>
                <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
              <Input value={p.amount} onChange={(e) => { setTouchedPay(true); setPayments((ps) => ps.map((x) => (x.key === p.key ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, "") } : x))); }} placeholder="0" className="h-9 flex-1 text-right" inputMode="decimal" />
              {i > 0 && <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setPayments((ps) => ps.filter((x) => x.key !== p.key))}><X className="h-4 w-4" /></Button>}
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setTouchedPay(true); setPayments((ps) => [...ps, { key: uid(), method: "bkash", amount: due ? String(due) : "" }]); }}><Plus className="h-3.5 w-3.5" /> Split</Button>
            <Button size="sm" variant="outline" onClick={() => { setTouchedPay(true); setPayments([{ key: uid(), method: "cash", amount: "" }]); }}>Full due</Button>
          </div>
        </div>
        {due > 0.004 && <div className="flex justify-between rounded-md bg-destructive/10 px-2 py-1.5 text-sm font-medium text-destructive"><span>Due (baki)</span><span className="tabular-nums">{fmt(due)}</span></div>}
        {change > 0.004 && <div className="flex justify-between rounded-md bg-emerald-50 px-2 py-1.5 text-sm text-emerald-800"><span>Change to give</span><span className="tabular-nums">{fmt(change)}</span></div>}
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" />
        <Button className="h-11 w-full text-base" disabled={save.isPending || !lines.length} onClick={() => save.mutate()}>
          <ReceiptIcon className="h-4 w-4" /> {save.isPending ? "Saving…" : due > 0.004 ? `Save bill · ${fmt(due)} due` : `Save bill · ${fmt(total)}`}
        </Button>
        <p className="text-[11px] text-muted-foreground">Medicines used by a service come off stock automatically. Booking alone never counts as income — only this bill does.</p>
      </CardContent></Card>

      <Dialog open={!!done} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Bill saved — {done?.invoice_no}</DialogTitle></DialogHeader>
          {done && (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><b className="tabular-nums">{fmt(done.total)}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums">{fmt(done.paid)}</span></div>
              {Number(done.due) > 0 && <div className="flex justify-between text-destructive"><span>Due</span><b className="tabular-nums">{fmt(done.due)}</b></div>}
            </div>
          )}
          <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={() => print("thermal")}><Printer className="h-4 w-4" /> Thermal</Button>
            <Button variant="outline" onClick={() => print("a4")}><Printer className="h-4 w-4" /> A4</Button>
            <Button className="col-span-2" onClick={reset}>New bill</Button>
            {appointmentId && <Button asChild variant="ghost" className="col-span-2"><Link to="/appointments">Back to appointments</Link></Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Services list

type ServiceForm = { id?: string; name: string; category: string; price: string; direct_cost: string; doctor_fee_type: "fixed" | "percent"; doctor_fee_value: string; is_active: boolean; materials: ServiceMaterial[] };
const emptyService = (): ServiceForm => ({ name: "", category: "procedure", price: "", direct_cost: "", doctor_fee_type: "fixed", doctor_fee_value: "", is_active: true, materials: [] });

function ServicesTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: services = [], isLoading } = useServices();
  const { data: products = [] } = useProductsLite();
  const [edit, setEdit] = useState<ServiceForm | null>(null);
  const [pq, setPq] = useState("");
  const [cat, setCat] = useState("all");

  const save = useMutation({
    mutationFn: async (f: ServiceForm) => {
      const row = {
        name: f.name.trim(), category: f.category, price: Number(f.price) || 0, direct_cost: Number(f.direct_cost) || 0,
        doctor_fee_type: f.doctor_fee_type, doctor_fee_value: Number(f.doctor_fee_value) || 0, is_active: f.is_active, updated_at: new Date().toISOString(),
      };
      if (!row.name) throw new Error("Write the service name");
      if (row.doctor_fee_type === "percent" && row.doctor_fee_value > 100) throw new Error("Doctor fee cannot be more than 100%");
      let id = f.id;
      if (id) {
        const { error } = await db.from("clinic_services").update(row).eq("id", id);
        if (error) throw error;
        const { error: dErr } = await db.from("clinic_service_materials").delete().eq("service_id", id);
        if (dErr) throw dErr;
      } else {
        const { data, error } = await db.from("clinic_services").insert(row).select("id").single();
        if (error) throw new Error(error.code === "23505" ? "A service with this name already exists" : error.message);
        id = data.id;
      }
      const mats = f.materials.filter((m) => m.product_id && Number(m.quantity) > 0).map((m) => ({ service_id: id, product_id: m.product_id, quantity: Number(m.quantity) }));
      if (mats.length) {
        const { error } = await db.from("clinic_service_materials").insert(mats);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Service saved"); setEdit(null); qc.invalidateQueries({ queryKey: ["clinic-services"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  const shown = services.filter((s) => cat === "all" || s.category === cat);
  const matCost = (f: ServiceForm) => f.materials.reduce((a, m) => a + Number(m.quantity || 0) * Number(products.find((p) => p.id === m.product_id)?.purchase_price || 0), 0);
  const pMatches = pq.trim() ? products.filter((p) => p.name.toLowerCase().includes(pq.trim().toLowerCase())).slice(0, 6) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {SERVICE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {isAdmin && <Button className="ml-auto" onClick={() => setEdit(emptyService())}><Plus className="h-4 w-4" /> Add service</Button>}
      </div>
      <Card><CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr><th className="p-2.5 text-left">Service</th><th className="p-2.5 text-right">Price</th><th className="p-2.5 text-right">Cost</th><th className="p-2.5 text-right">Doctor</th><th className="p-2.5 text-right">Profit</th><th className="p-2.5" /></tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((s) => {
                const cost = serviceCost(s);
                const docFee = doctorFeeFor(s, s.price, 1);
                return (
                  <tr key={s.id} className={s.is_active ? "" : "opacity-50"}>
                    <td className="p-2.5">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground">{categoryLabel(s.category)}{s.materials.length ? ` · uses ${s.materials.map((m) => `${m.product?.name?.trim() ?? "item"} ×${Number(m.quantity)}`).join(", ")}` : ""}{s.is_active ? "" : " · hidden"}</p>
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{fmt(s.price)}</td>
                    <td className="p-2.5 text-right tabular-nums">{fmt(cost)}</td>
                    <td className="p-2.5 text-right tabular-nums">{s.doctor_fee_type === "percent" ? `${s.doctor_fee_value}%` : fmt(docFee)}</td>
                    <td className="p-2.5 text-right font-medium tabular-nums">{fmt(s.price - cost - docFee)}</td>
                    <td className="p-2.5 text-right">
                      {isAdmin && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEdit({ id: s.id, name: s.name, category: s.category, price: String(s.price), direct_cost: String(s.direct_cost), doctor_fee_type: s.doctor_fee_type, doctor_fee_value: String(s.doctor_fee_value), is_active: s.is_active, materials: s.materials.map((m) => ({ product_id: m.product_id, quantity: Number(m.quantity), product: m.product })) })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{isLoading ? "Loading…" : "No services yet."}</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
      {!isAdmin && <p className="text-xs text-muted-foreground">Only an admin can add or change services and prices.</p>}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Syringe className="h-4 w-4" /> {edit?.id ? "Edit service" : "New service"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Service name</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Rabies vaccine" autoFocus /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select value={edit.category} onValueChange={(v) => setEdit({ ...edit, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SERVICE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Price (customer pays)</Label><Input value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/[^0-9.]/g, "") })} inputMode="decimal" placeholder="0" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Other direct cost</Label><Input value={edit.direct_cost} onChange={(e) => setEdit({ ...edit, direct_cost: e.target.value.replace(/[^0-9.]/g, "") })} inputMode="decimal" placeholder="0" /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Doctor fee</Label>
                  <div className="flex gap-2">
                    <Select value={edit.doctor_fee_type} onValueChange={(v) => setEdit({ ...edit, doctor_fee_type: v as any })}>
                      <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="fixed">৳</SelectItem><SelectItem value="percent">%</SelectItem></SelectContent>
                    </Select>
                    <Input value={edit.doctor_fee_value} onChange={(e) => setEdit({ ...edit, doctor_fee_value: e.target.value.replace(/[^0-9.]/g, "") })} inputMode="decimal" placeholder="0" />
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-medium">Medicines / materials used (come off stock when billed)</p>
                {edit.materials.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{(m.product?.name ?? products.find((p) => p.id === m.product_id)?.name ?? "—").trim()}</span>
                    <Input value={String(m.quantity)} onChange={(e) => setEdit({ ...edit, materials: edit.materials.map((x, k) => (k === i ? { ...x, quantity: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 } : x)) })} className="h-8 w-20 text-right" inputMode="decimal" />
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEdit({ ...edit, materials: edit.materials.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Search a product to add…" className="h-8 text-xs" />
                {pMatches.map((p) => (
                  <button key={p.id} type="button" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted" onClick={() => { setEdit({ ...edit, materials: [...edit.materials.filter((x) => x.product_id !== p.id), { product_id: p.id, quantity: 1, product: { name: p.name, purchase_price: p.purchase_price, unit: p.unit } }] }); setPq(""); }}>
                    {p.name.trim()} <span className="text-muted-foreground">· cost {fmt(p.purchase_price)}</span>
                  </button>
                ))}
              </div>

              <div className="rounded-lg bg-muted/40 p-3 text-xs">
                {(() => {
                  const price = Number(edit.price) || 0;
                  const cost = (Number(edit.direct_cost) || 0) + matCost(edit);
                  const doc = edit.doctor_fee_type === "percent" ? (price * (Number(edit.doctor_fee_value) || 0)) / 100 : Number(edit.doctor_fee_value) || 0;
                  return <span>Price {fmt(price)} − cost {fmt(cost)} − doctor {fmt(doc)} = <b>profit {fmt(price - cost - doc)}</b> per service</span>;
                })()}
              </div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={edit.is_active} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} /> Show in bills</label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button disabled={save.isPending} onClick={() => edit && save.mutate(edit)}>{save.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Problems & doctors

function SetupTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: problems = [] } = useProblems();
  const { data: doctors = [] } = useDoctors(true);
  const [name, setName] = useState("");
  const [fees, setFees] = useState<Record<string, string>>({});

  const add = useMutation({
    mutationFn: () => addProblem(name),
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["clinic-problems"] }); toast.success("Problem added"); },
    onError: (e: any) => toast.error(e?.message ?? "Could not add"),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await db.from("clinic_problems").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clinic-problems"] }),
    onError: (e: any) => toast.error(e?.message ?? "Could not change"),
  });
  const saveDoctor = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from("doctors").update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["doctors"] }); toast.success("Doctor updated"); },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardContent className="space-y-3 p-3 sm:p-4">
        <p className="text-sm font-semibold">Problems (for appointment booking)</p>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Skin allergy" onKeyDown={(e) => e.key === "Enter" && name.trim() && add.mutate()} />
          <Button disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}><Plus className="h-4 w-4" /> Add</Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {problems.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!isAdmin}
              onClick={() => toggle.mutate({ id: p.id, is_active: !p.is_active })}
              title={isAdmin ? (p.is_active ? "Click to hide" : "Click to show") : undefined}
              className={`rounded-full border px-2.5 py-1 text-xs ${p.is_active ? "bg-card" : "bg-muted text-muted-foreground line-through"}`}
            >
              {p.name}
            </button>
          ))}
        </div>
        {isAdmin && <p className="text-[11px] text-muted-foreground">Click a problem to hide it from the list (old appointments keep it).</p>}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-3 sm:p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Stethoscope className="h-4 w-4" /> Doctors & consultation fee</p>
        <div className="divide-y rounded-lg border">
          {doctors.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className={`min-w-0 flex-1 truncate ${d.is_active ? "" : "text-muted-foreground line-through"}`}>{d.full_name}</span>
              <Input
                value={fees[d.id] ?? String(d.consultation_fee ?? 0)}
                onChange={(e) => setFees((f) => ({ ...f, [d.id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                className="h-8 w-24 text-right"
                inputMode="decimal"
                aria-label="Consultation fee"
              />
              <Button size="sm" variant="outline" disabled={fees[d.id] == null || saveDoctor.isPending} onClick={() => saveDoctor.mutate({ id: d.id, patch: { consultation_fee: Number(fees[d.id]) || 0 } })}>Save</Button>
              <Switch checked={d.is_active} onCheckedChange={(v) => saveDoctor.mutate({ id: d.id, patch: { is_active: v } })} aria-label="Active" />
            </div>
          ))}
          {!doctors.length && <p className="p-4 text-center text-sm text-muted-foreground">No doctors yet — add one from Appointments.</p>}
        </div>
        <p className="text-[11px] text-muted-foreground">The consultation fee fills in automatically when booking with this doctor.</p>
      </CardContent></Card>
    </div>
  );
}
