import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pill, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { printClinicalPrescription } from "@/lib/prescription-print";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/prescriptions")({
  head: () => ({ meta: [{ title: "Prescriptions — Pet Care Vet ERP" }] }),
  component: PrescriptionsPage,
});

type RxItemDraft = {
  medicine_name: string;
  product_id?: string | null;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
};

const emptyItem = (): RxItemDraft => ({
  medicine_name: "",
  product_id: null,
  dosage: "",
  frequency: "",
  duration: "",
  instructions: "",
});

function petAgeLabel(dob: string | null | undefined) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const months = Math.max(0, Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y}y` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}

/**
 * Clinical-visit prescriptions print on the full A4 layout (two-column clinical
 * area + doctor block); legacy standalone prescriptions keep the older sheet.
 */
function printRx(rx: any) {
  if (!rx?.visit) {
    const issued = new Date(rx.issued_at);
    printClinicalPrescription({
      rxNo: rx.rx_no || `RX-${String(rx.id).slice(0, 8).toUpperCase()}`,
      date: issued,
      pet: {
        name: rx.pet?.name ?? "",
        species: rx.pet?.species ?? null,
        breed: rx.pet?.breed ?? null,
        gender: rx.pet?.gender ?? null,
        age: petAgeLabel(rx.pet?.date_of_birth),
        weight: rx.pet?.weight_kg ? `${rx.pet.weight_kg} kg` : null,
      },
      owner: { name: rx.pet?.owner?.full_name ?? null, phone: rx.pet?.owner?.phone ?? null },
      items: (rx.items ?? []).map((it: any) => ({
        name: it.medicine_name,
        schedule: [it.dosage, it.frequency].filter(Boolean).join(" · "),
        duration: it.duration ?? "",
        instruction: it.instruction ?? it.instructions ?? null,
      })),
      advice: rx.notes ? [rx.notes] : [],
      followUp: rx.follow_up_date ?? null,
      doctor: rx.doctor
        ? {
            name: rx.doctor.full_name,
            degree: rx.doctor.degree,
            designation: rx.doctor.designation,
            specialization: rx.doctor.specialization,
            additional: rx.doctor.additional_qualification,
            registration: rx.doctor.registration_no,
          }
        : null,
    });
    return;
  }
  const v = rx.visit;
  const weight = v.weight_kg ?? rx.pet?.weight_kg;
  printClinicalPrescription({
    rxNo: rx.rx_no || `RX-${String(rx.id).slice(0, 8).toUpperCase()}`,
    date: rx.issued_at,
    pet: {
      name: rx.pet?.name ?? "",
      species: rx.pet?.species ?? null,
      breed: rx.pet?.breed ?? null,
      gender: rx.pet?.gender ?? null,
      age: petAgeLabel(rx.pet?.date_of_birth),
      weight: weight ? `${weight} kg` : null,
    },
    owner: { name: rx.pet?.owner?.full_name ?? null, phone: rx.pet?.owner?.phone ?? null },
    chiefComplaint: v.chief_complaint,
    symptoms: v.symptoms ?? [],
    examination: v.examination,
    diagnoses: v.diagnoses ?? [],
    tests: v.tests ?? [],
    items: [...(rx.items ?? [])]
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((it: any) => ({
        name: it.medicine_name,
        schedule: it.dosage ?? "",
        duration: it.duration ?? (it.duration_days ? `${it.duration_days} Days` : ""),
        instruction: it.instruction ?? it.instructions ?? null,
      })),
    advice: v.advice ?? [],
    followUp: rx.follow_up_date ?? v.follow_up_date ?? null,
    doctor: rx.doctor
      ? {
          name: rx.doctor.full_name,
          degree: rx.doctor.degree,
          designation: rx.doctor.designation,
          specialization: rx.doctor.specialization,
          additional: rx.doctor.additional_qualification,
          registration: rx.doctor.registration_no,
        }
      : null,
  });
}

function PrescriptionsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);

  const [petId, setPetId] = useState<string>("");
  const [doctorId, setDoctorId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<RxItemDraft[]>([emptyItem()]);

  const { data: rxs = [], isLoading } = useQuery({
    queryKey: ["rx-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prescriptions")
        .select(
          "*, pet:pets(name,species,breed,gender,weight_kg,date_of_birth,owner:pet_owners(full_name,phone)), doctor:doctors(full_name,degree,designation,specialization,additional_qualification,registration_no), items:prescription_items(*), visit:clinical_visits(chief_complaint,examination,symptoms,diagnoses,tests,advice,weight_kg,follow_up_date)",
        )
        .order("issued_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pets = [] } = useQuery({
    queryKey: ["rx-pets"],
    queryFn: async () => {
      return fetchAll<any>(() => supabase
        .from("pets")
        .select("id,name,species,owner:pet_owners(full_name)")
        .order("name")
        .order("id"), 200000);
    },
  });

  const { data: doctors = [] } = useQuery({
    queryKey: ["rx-doctors"],
    queryFn: async () => {
      const { data } = await supabase.from("doctors").select("id,full_name").order("full_name");
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["rx-products"],
    queryFn: async () => {
      return fetchAll<{ id: string; name: string }>(() => supabase
        .from("products")
        .select("id,name")
        .eq("is_active", true)
        .order("name")
        .order("id"));
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rxs;
    return rxs.filter((rx: any) => {
      const hay = [
        rx.pet?.name,
        rx.pet?.species,
        rx.pet?.owner?.full_name,
        rx.doctor?.full_name,
        rx.notes,
        ...(rx.items ?? []).map((i: any) => i.medicine_name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rxs, search]);

  function resetForm() {
    setPetId("");
    setDoctorId("");
    setNotes("");
    setItems([emptyItem()]);
  }

  const createRx = useMutation({
    mutationFn: async () => {
      if (!petId) throw new Error("Select a pet");
      const cleanItems = items
        .map((it) => ({ ...it, medicine_name: it.medicine_name.trim() }))
        .filter((it) => it.medicine_name.length > 0);
      if (cleanItems.length === 0) throw new Error("Add at least one medicine");

      const { data: rx, error } = await supabase
        .from("prescriptions")
        .insert({
          pet_id: petId,
          doctor_id: doctorId || null,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const rows = cleanItems.map((it) => ({
        prescription_id: rx.id,
        medicine_name: it.medicine_name,
        product_id: it.product_id || null,
        dosage: it.dosage || null,
        frequency: it.frequency || null,
        duration: it.duration || null,
        instructions: it.instructions || null,
      }));
      const { error: itemsErr } = await supabase.from("prescription_items").insert(rows);
      if (itemsErr) throw itemsErr;
    },
    onSuccess: () => {
      toast.success("Prescription created");
      qc.invalidateQueries({ queryKey: ["rx-list"] });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRx = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("prescription_items").delete().eq("prescription_id", id);
      const { error } = await supabase.from("prescriptions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Prescription deleted");
      qc.invalidateQueries({ queryKey: ["rx-list"] });
      setViewing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Prescriptions"
        description="Create, search and print prescriptions issued to pets."
        icon={Pill}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Prescription
          </Button>
        }
      />

      <div className="mb-4 relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by pet, owner, doctor or medicine…"
          className="pl-9"
        />
      </div>

      <div className="space-y-3">
        {isLoading && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">Loading…</CardContent>
          </Card>
        )}
        {!isLoading && filtered.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {rxs.length === 0
                ? "No prescriptions yet. Click New Prescription to add one."
                : "No prescriptions match your search."}
            </CardContent>
          </Card>
        )}
        {filtered.map((rx: any) => (
          <Card key={rx.id} className="hover:shadow-md transition">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{rx.pet?.name ?? "—"}</span>
                    {rx.pet?.species && <Badge variant="outline">{rx.pet.species}</Badge>}
                    <Badge variant="secondary">{(rx.items ?? []).length} med(s)</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rx.pet?.owner?.full_name}
                    {rx.doctor?.full_name && ` · Dr. ${rx.doctor.full_name}`} ·{" "}
                    {new Date(rx.issued_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setViewing(rx)}>
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Delete this prescription?")) deleteRx.mutate(rx.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <ul className="list-disc pl-5 text-sm space-y-0.5">
                {rx.items?.slice(0, 3).map((it: any) => (
                  <li key={it.id}>
                    <span className="font-medium">{it.medicine_name}</span>
                    {(it.dosage || it.frequency || it.duration) && (
                      <span className="text-muted-foreground">
                        {" "}
                        — {[it.dosage, it.frequency, it.duration].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </li>
                ))}
                {(rx.items?.length ?? 0) > 3 && (
                  <li className="text-muted-foreground list-none italic">
                    +{rx.items.length - 3} more…
                  </li>
                )}
              </ul>
              {rx.notes && (
                <p className="text-sm text-muted-foreground border-t pt-2">{rx.notes}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Prescription</DialogTitle>
            <DialogDescription>Select a pet, the prescribing doctor and medicines.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Pet *</Label>
                <Select value={petId} onValueChange={setPetId}>
                  <SelectTrigger><SelectValue placeholder="Select pet" /></SelectTrigger>
                  <SelectContent>
                    {pets.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} {p.species ? `(${p.species})` : ""} — {p.owner?.full_name ?? ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Doctor</Label>
                <Select value={doctorId} onValueChange={setDoctorId}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {doctors.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>Dr. {d.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Medicines</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, emptyItem()])}>
                  <Plus className="mr-1 h-3 w-3" /> Add medicine
                </Button>
              </div>
              <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                {items.map((it, idx) => (
                  <div key={idx} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Medicine {idx + 1}</span>
                      {items.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setItems(items.filter((_, i) => i !== idx))}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">From inventory</Label>
                        <Select
                          value={it.product_id ?? ""}
                          onValueChange={(v) => {
                            const prod = products.find((p: any) => p.id === v);
                            const next = [...items];
                            next[idx] = {
                              ...next[idx],
                              product_id: v || null,
                              medicine_name: prod?.name ?? next[idx].medicine_name,
                            };
                            setItems(next);
                          }}
                        >
                          <SelectTrigger><SelectValue placeholder="Optional — or type below" /></SelectTrigger>
                          <SelectContent>
                            {products.map((p: any) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Medicine name *</Label>
                        <Input
                          value={it.medicine_name}
                          onChange={(e) => {
                            const next = [...items];
                            next[idx] = { ...next[idx], medicine_name: e.target.value };
                            setItems(next);
                          }}
                          placeholder="e.g. Amoxicillin 250mg"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Dosage</Label>
                        <Input
                          value={it.dosage}
                          onChange={(e) => {
                            const next = [...items];
                            next[idx] = { ...next[idx], dosage: e.target.value };
                            setItems(next);
                          }}
                          placeholder="1 tablet"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Frequency</Label>
                        <Input
                          value={it.frequency}
                          onChange={(e) => {
                            const next = [...items];
                            next[idx] = { ...next[idx], frequency: e.target.value };
                            setItems(next);
                          }}
                          placeholder="Twice daily"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Duration</Label>
                        <Input
                          value={it.duration}
                          onChange={(e) => {
                            const next = [...items];
                            next[idx] = { ...next[idx], duration: e.target.value };
                            setItems(next);
                          }}
                          placeholder="7 days"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Instructions</Label>
                        <Input
                          value={it.instructions}
                          onChange={(e) => {
                            const next = [...items];
                            next[idx] = { ...next[idx], instructions: e.target.value };
                            setItems(next);
                          }}
                          placeholder="After meals, with water…"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Follow-up in 2 weeks…" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => createRx.mutate()} disabled={createRx.isPending}>
              {createRx.isPending ? "Saving…" : "Save prescription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View / Print dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Prescription</DialogTitle>
            <DialogDescription>
              {viewing && new Date(viewing.issued_at).toLocaleString()}
            </DialogDescription>
          </DialogHeader>

          {viewing && (
            <div id="rx-print" className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2 border rounded-lg p-3 bg-muted/30">
                <div>
                  <div className="text-xs text-muted-foreground">Pet</div>
                  <div className="font-medium">
                    {viewing.pet?.name} {viewing.pet?.species ? `(${viewing.pet.species})` : ""}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Owner</div>
                  <div className="font-medium">
                    {viewing.pet?.owner?.full_name ?? "—"}
                    {viewing.pet?.owner?.phone && (
                      <span className="text-muted-foreground"> · {viewing.pet.owner.phone}</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Doctor</div>
                  <div className="font-medium">
                    {viewing.doctor?.full_name ? `Dr. ${viewing.doctor.full_name}` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Issued</div>
                  <div className="font-medium">{new Date(viewing.issued_at).toLocaleString()}</div>
                </div>
              </div>

              <div>
                <div className="mb-2 font-medium">Medicines</div>
                <ol className="list-decimal pl-5 space-y-2">
                  {viewing.items?.map((it: any) => (
                    <li key={it.id}>
                      <div className="font-medium">{it.medicine_name}</div>
                      {(it.dosage || it.frequency || it.duration) && (
                        <div className="text-muted-foreground text-xs">
                          {[it.dosage, it.frequency, it.duration].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {it.instructions && (
                        <div className="text-muted-foreground text-xs">{it.instructions}</div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {viewing.notes && (
                <div className="border-t pt-2">
                  <div className="text-xs text-muted-foreground">Notes</div>
                  <div>{viewing.notes}</div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                if (viewing && confirm("Delete this prescription?")) deleteRx.mutate(viewing.id);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
            <Button onClick={() => viewing && printRx(viewing)}>
              <Printer className="mr-2 h-4 w-4" /> Print

            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
