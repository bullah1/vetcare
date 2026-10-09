import { createFileRoute, Link } from "@tanstack/react-router";

function slipFrom(a: any): AppointmentSlip {
  return {
    serial_no: a.serial_no ?? null,
    scheduled_at: a.scheduled_at,
    duration_minutes: a.duration_minutes,
    pet_name: a.pet?.name ?? a.guest_pet_name ?? "—",
    pet_species: a.pet?.species ?? a.guest_pet_species ?? null,
    owner_name: a.pet?.owner?.full_name ?? a.guest_name ?? "—",
    owner_phone: a.pet?.owner?.phone ?? a.guest_phone ?? null,
    doctor_name: a.doctor?.full_name ?? "—",
    fee: Number(a.fee || 0),
    paid: Number(a.paid || 0),
    reason: a.reason ?? null,
  };
}
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Wallet, Ban, CheckCircle2, Eye, PawPrint, Stethoscope, Printer, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AddPetDialog } from "@/components/AddPetDialog";
import { CustomerPicker, useOwnerOptions } from "@/components/CustomerPetPicker";
import { AddDoctorDialog } from "@/components/AddDoctorDialog";
import { ReceiveAppointmentCashDialog, money, type ApptForPayment } from "@/components/ReceiveAppointmentCashDialog";
import { PetHistorySheet } from "@/components/PetHistorySheet";
import { printAppointmentSlip, type AppointmentSlip } from "@/lib/appointment-slip";
import { dayRangeISO } from "@/lib/sales-ledger";

export const Route = createFileRoute("/_authenticated/appointments")({
  head: () => ({
    meta: [
      { title: "Appointments — Pet Care Vet" },
      { name: "description", content: "Schedule consultations, auto serial numbers, receive cash and auto-create sales entries." },
      { property: "og:title", content: "Appointments — Pet Care Vet" },
      { property: "og:description", content: "Daily appointment queue with serials, payments and consultation tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppointmentsPage,
});

const STATUSES = ["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show"] as const;
const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", confirmed: "default", in_progress: "secondary", completed: "secondary", cancelled: "destructive", no_show: "destructive",
};

const todayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const emptyForm = { owner_id: "", pet_id: "", doctor_id: "", scheduled_at: "", duration_minutes: 30, fee: "", discount: "", reason: "", notes: "", serial_no: "" };

function AppointmentsPage() {
  const qc = useQueryClient();
  const [day, setDay] = useState(todayStr());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [addPet, setAddPet] = useState(false);
  const [addDoctor, setAddDoctor] = useState(false);
  const [payFor, setPayFor] = useState<ApptForPayment | null>(null);
  const [historyPet, setHistoryPet] = useState<string | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);

  const { data: owners = [], isLoading: ownersLoading } = useOwnerOptions();
  const selectedOwner = owners.find((o) => o.id === form.owner_id) ?? null;
  const ownerPets = selectedOwner?.pets ?? [];
  const { data: doctors = [] } = useQuery({
    queryKey: ["doctors", "picker"],
    queryFn: async () =>
      (await supabase.from("doctors").select("id,full_name,consultation_fee").eq("is_active", true).order("full_name")).data ?? [],
  });

  const { data: appts = [] } = useQuery({
    queryKey: ["appointments", day],
    queryFn: async () => {
      // Dhaka day bounds, independent of the device clock's timezone.
      const { fromISO: start, toISO: end } = dayRangeISO(day, day);
      const { data, error } = await supabase
        .from("appointments")
        .select("*, pet:pets(id,name,species,owner:pet_owners(full_name,phone)), doctor:doctors(full_name)")
        .gte("scheduled_at", start)
        .lte("scheduled_at", end)
        .order("serial_no", { ascending: true })
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Auto serial preview for the chosen doctor + date/time
  const { data: serialPreview } = useQuery({
    queryKey: ["appt-serial", form.doctor_id, form.scheduled_at],
    enabled: open && !!form.doctor_id && !!form.scheduled_at,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("next_appointment_serial", {
        _doctor_id: form.doctor_id,
        _scheduled_at: new Date(form.scheduled_at).toISOString(),
      });
      if (error) throw error;
      return data as number;
    },
  });

  const summary = useMemo(() => {
    const s = { total: appts.length, waiting: 0, consulting: 0, completed: 0, cancelled: 0, no_show: 0, fee: 0, collected: 0, due: 0 };
    for (const a of appts as any[]) {
      if (a.status === "pending" || a.status === "confirmed") s.waiting++;
      if (a.status === "in_progress") s.consulting++;
      if (a.status === "completed") s.completed++;
      if (a.status === "cancelled") s.cancelled++;
      if (a.status === "no_show") s.no_show++;
      if (a.status !== "cancelled") {
        s.fee += Number(a.fee || 0);
        s.collected += Number(a.paid || 0);
        s.due += Math.max(Number(a.fee || 0) - Number(a.paid || 0), 0);
      }
    }
    return s;
  }, [appts]);

  const create = useMutation({
    mutationFn: async () => {
      if (!form.pet_id) throw new Error("Select a pet");
      if (!form.doctor_id) throw new Error("Select a doctor");
      if (!form.scheduled_at) throw new Error("Select date & time");
      const grossFee = form.fee ? Number(form.fee) : 0;
      const discount = form.discount ? Number(form.discount) : 0;
      if (!(grossFee >= 0) || !(discount >= 0)) throw new Error("Fee and discount must be positive numbers");
      if (discount > grossFee) throw new Error("Discount cannot be more than the consultation fee");
      const { data, error } = await supabase.rpc("create_appointment", {
        _pet_id: form.pet_id,
        _doctor_id: form.doctor_id,
        _scheduled_at: new Date(form.scheduled_at).toISOString(),
        _duration_minutes: Number(form.duration_minutes) || 30,
        // The fee stored is what the customer pays. The discount used to be
        // saved separately but never subtracted, so the full fee was charged.
        _fee: Math.max(grossFee - discount, 0),
        _reason: form.reason.trim() || undefined,
        _notes: form.notes.trim() || undefined,
        _serial_no: form.serial_no ? Number(form.serial_no) : undefined,
      });
      if (error) throw error;
      const apptId = (data as any)?.appointment_id;
      if (discount > 0 && apptId) {
        const { error: dErr } = await supabase.from("appointments").update({ discount } as any).eq("id", apptId);
        if (dErr) toast.error(`Appointment saved, but the discount note failed: ${dErr.message}`);
      }
      return data as any;
    },
    onSuccess: (res: any) => {
      toast.success(`Appointment saved${res?.serial_no ? ` · Serial #${res.serial_no}` : ""}`);
      qc.invalidateQueries({ queryKey: ["appointments"] });
      // Auto-print the customer slip (serial token)
      try {
        const owner = owners.find((o) => o.id === form.owner_id) ?? null;
        const pet: any = (owner?.pets ?? []).find((p) => p.id === form.pet_id);
        const doc: any = doctors.find((d: any) => d.id === form.doctor_id);
        printAppointmentSlip({
          serial_no: res?.serial_no ?? null,
          scheduled_at: res?.scheduled_at ?? new Date(form.scheduled_at).toISOString(),
          pet_name: pet?.name ?? "—",
          pet_species: pet?.species ?? null,
          owner_name: owner?.full_name ?? "—",
          owner_phone: owner?.phone ?? null,
          doctor_name: doc?.full_name ?? "—",
          fee: form.fee ? Number(form.fee) : 0,
          paid: 0,
          reason: form.reason.trim() || null,
        });
      } catch { /* slip printing is best-effort */ }
      setForm({ ...emptyForm });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save appointment"),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (status === "cancelled") {
        const { data, error } = await supabase.rpc("cancel_appointment" as any, { _appointment_id: id, _reason: null });
        if (error) throw error;
        return data as any;
      }
      const { error } = await supabase.from("appointments").update({ status } as any).eq("id", id);
      if (error) throw error;
      return null;
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["cash"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
      const refunded = Number(res?.refunded ?? 0);
      toast.success(refunded > 0 ? `Cancelled · ${money(refunded)} refunded back` : "Status updated");
    },
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });


  const pickDoctor = (v: string) => {
    const doc: any = doctors.find((d: any) => d.id === v);
    setForm((f) => ({ ...f, doctor_id: v, fee: f.fee || (doc?.consultation_fee ? String(doc.consultation_fee) : "") }));
  };

  const toPayment = (a: any): ApptForPayment => ({
    id: a.id,
    serial_no: a.serial_no,
    fee: Number(a.fee || 0),
    paid: Number(a.paid || 0),
    pet_name: a.pet?.name ?? a.guest_pet_name,
    owner_name: a.pet?.owner?.full_name ?? a.guest_name,
  });

  return (
    <div>
      <PageHeader
        title="Appointments"
        description="Add pet → select doctor → auto serial → consultation → receive cash → auto sales entry."
        icon={CalendarDays}
        actions={
          <>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-9 w-full sm:w-auto" />
            <Button asChild variant="outline">
              <Link to="/appointment-history"><History className="h-4 w-4" /> History</Link>
            </Button>
            <Button onClick={() => { setForm({ ...emptyForm, scheduled_at: `${day}T10:00` }); setOpen(true); }}>
              <Plus className="h-4 w-4" /> New
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8 mb-4">
        {[
          { label: "Total", value: summary.total },
          { label: "Waiting", value: summary.waiting },
          { label: "In consult", value: summary.consulting },
          { label: "Completed", value: summary.completed },
          { label: "Cancelled", value: summary.cancelled },
          { label: "No show", value: summary.no_show },
          { label: "Collected", value: money(summary.collected) },
          { label: "Due", value: money(summary.due) },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="text-lg font-semibold tabular-nums truncate">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        {appts.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            No appointments for {new Date(day).toLocaleDateString()}.
          </CardContent></Card>
        )}

        {(appts as any[]).map((a) => {
          const due = Math.max(Number(a.fee || 0) - Number(a.paid || 0), 0);
          return (
            <Card key={a.id}>
              <CardContent className="p-3 sm:p-4 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2 sm:min-w-24">
                    <Badge variant="secondary" className="tabular-nums">#{a.serial_no ?? "-"}</Badge>
                    <span className="font-semibold tabular-nums">
                      {new Date(a.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        className="font-medium truncate underline-offset-2 hover:underline text-left"
                        onClick={() => a.pet?.id && setHistoryPet(a.pet.id)}
                      >
                        {a.pet?.name ?? a.guest_pet_name ?? "—"}
                      </button>
                      {a.pet?.species && <Badge variant="outline">{a.pet.species}</Badge>}
                      <Badge variant={STATUS_COLORS[a.status] ?? "outline"}>{a.status}</Badge>
                      {Number(a.fee || 0) > 0 && (
                        <Badge variant={due > 0 ? "destructive" : "secondary"}>
                          {due > 0 ? `Due ${money(due)}` : "Paid"}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {a.pet?.owner?.full_name ?? a.guest_name ?? "—"}
                      {(a.pet?.owner?.phone || a.guest_phone) && ` · ${a.pet?.owner?.phone ?? a.guest_phone}`}
                      {a.doctor?.full_name && ` · Dr. ${a.doctor.full_name}`}
                      {` · Fee ${money(Number(a.fee || 0))} · Paid ${money(Number(a.paid || 0))}`}
                    </div>
                    {a.reason && <p className="text-sm mt-1">{a.reason}</p>}
                  </div>

                  <Select value={a.status} onValueChange={(v) => updateStatus.mutate({ id: a.id, status: v })}>
                    <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setViewing(a)}><Eye className="h-4 w-4" /> View</Button>
                  <Button size="sm" onClick={() => setPayFor(toPayment(a))} disabled={due <= 0 || a.status === "cancelled"}>
                    <Wallet className="h-4 w-4" /> Receive cash
                  </Button>
                  {a.status !== "completed" && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: a.id, status: "completed" })}>
                      <CheckCircle2 className="h-4 w-4" /> Complete
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updateStatus.mutate({ id: a.id, status: "cancelled" })}>
                    <Ban className="h-4 w-4" /> {a.status === "cancelled" ? "Cancel again" : "Cancel"}
                  </Button>

                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* New appointment */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Schedule appointment</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label>Customer</Label>
              <CustomerPicker
                owners={owners}
                loading={ownersLoading}
                value={form.owner_id}
                onChange={(ownerId) => {
                  const o = owners.find((x) => x.id === ownerId);
                  setForm((f) => ({
                    ...f,
                    owner_id: ownerId,
                    pet_id: o?.pets?.length === 1 ? o.pets[0].id : "",
                  }));
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Pet</Label>
              <div className="flex gap-2">
                <Select
                  value={form.pet_id}
                  onValueChange={(v) => setForm({ ...form, pet_id: v })}
                  disabled={!form.owner_id}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={form.owner_id ? "Choose pet" : "Select a customer first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {ownerPets.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{p.species ? ` — ${p.species}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" disabled={!form.owner_id} onClick={() => setAddPet(true)}>
                  <PawPrint className="h-4 w-4" /> Add
                </Button>
              </div>
              {form.owner_id && ownerPets.length === 0 && (
                <p className="text-xs text-muted-foreground">This customer has no pet yet — add one.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Doctor</Label>
              <div className="flex gap-2">
                <Select value={form.doctor_id} onValueChange={pickDoctor}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Choose doctor" /></SelectTrigger>
                  <SelectContent>
                    {(doctors as any[]).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => setAddDoctor(true)}><Stethoscope className="h-4 w-4" /> Add</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date & time</Label>
                <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Duration (min)</Label>
                <Input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Consultation fee</Label>
                <Input inputMode="decimal" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} placeholder="500" />
              </div>
              <div className="space-y-2">
                <Label>Discount</Label>
                <Input inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} placeholder="0" />
                {Number(form.discount) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Payable: {money(Math.max((Number(form.fee) || 0) - (Number(form.discount) || 0), 0))}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Serial (auto)</Label>
                <Input
                  inputMode="numeric"
                  value={form.serial_no}
                  onChange={(e) => setForm({ ...form, serial_no: e.target.value })}
                  placeholder={serialPreview ? `Auto #${serialPreview}` : "Auto"}
                />
              </div>
            </div>

            <div className="space-y-2"><Label>Reason</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
            <div className="space-y-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !form.pet_id || !form.doctor_id || !form.scheduled_at}>
              Save appointment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View details */}
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Appointment #{viewing?.serial_no ?? "-"}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-2 text-sm">
              <Row label="Pet" value={`${viewing.pet?.name ?? viewing.guest_pet_name ?? "—"}${viewing.pet?.species ? ` (${viewing.pet.species})` : ""}`} />
              <Row label="Owner" value={viewing.pet?.owner?.full_name ?? viewing.guest_name ?? "—"} />
              <Row label="Phone" value={viewing.pet?.owner?.phone ?? viewing.guest_phone ?? "—"} />
              <Row label="Doctor" value={viewing.doctor?.full_name ? `Dr. ${viewing.doctor.full_name}` : "—"} />
              <Row label="When" value={new Date(viewing.scheduled_at).toLocaleString()} />
              <Row label="Duration" value={`${viewing.duration_minutes} min`} />
              <Row label="Status" value={viewing.status} />
              <Row label="Fee" value={money(Number(viewing.fee || 0))} />
              <Row label="Paid" value={money(Number(viewing.paid || 0))} />
              <Row label="Due" value={money(Math.max(Number(viewing.fee || 0) - Number(viewing.paid || 0), 0))} />
              {viewing.reason && <Row label="Reason" value={viewing.reason} />}
              {viewing.notes && <Row label="Notes" value={viewing.notes} />}
            </div>
          )}
          {viewing && (
            <DialogFooter>
              <Button variant="outline" onClick={() => printAppointmentSlip(slipFrom(viewing))}>
                <Printer className="h-4 w-4" /> Print slip
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AddPetDialog
        open={addPet}
        onOpenChange={setAddPet}
        lockedOwnerId={form.owner_id || undefined}
        onCreated={(id) => setForm((f) => ({ ...f, pet_id: id }))}
      />
      <AddDoctorDialog open={addDoctor} onOpenChange={setAddDoctor} onCreated={(id) => pickDoctor(id)} />
      <ReceiveAppointmentCashDialog appointment={payFor} onClose={() => setPayFor(null)} />
      <PetHistorySheet petId={historyPet} onClose={() => setHistoryPet(null)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-words">{value}</span>
    </div>
  );
}
