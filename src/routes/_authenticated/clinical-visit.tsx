import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronsUpDown,
  ClipboardList,
  Loader2,
  Pill,
  Plus,
  Search,
  Stethoscope,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOwnerOptions, type OwnerOption } from "@/components/CustomerPetPicker";
import { AddDoctorDialog } from "@/components/AddDoctorDialog";
import { NewPatientDialog } from "@/components/clinical/NewPatientDialog";
import { MasterMultiSelect, type Picked } from "@/components/clinical/MasterMultiSelect";
import { MedicinePicker } from "@/components/clinical/MedicinePicker";
import { PetHistorySheet } from "@/components/PetHistorySheet";
import {
  isLiquidForm,
  quickAddMaster,
  resolveDoseForm,
  unitForForm,
  useInvalidateMaster,
  useMasterList,
  useMedicines,
  DOSE_FORMS,
  INSTRUCTIONS,
  type Medicine,
} from "@/lib/clinical-master";
import { formatSchedule, printClinicalPrescription } from "@/lib/prescription-print";
import { fuzzyMatch } from "@/lib/fuzzy-search";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/clinical-visit")({
  head: () => ({
    meta: [
      { title: "Clinical Visit — Pet Care Vet" },
      {
        name: "description",
        content: "Record a full clinical visit and generate a printable veterinary prescription in one screen.",
      },
      { property: "og:title", content: "Clinical Visit — Pet Care Vet" },
      {
        property: "og:description",
        content: "Search a patient, record findings, prescribe medicines and print the prescription.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClinicalVisitPage,
});

type PatientRow = { petId: string; petName: string; species: string | null; owner: OwnerOption };

type MedRow = {
  key: string;
  medicine: Medicine | null;
  /** Dose form used for this line (auto-detected from the product, doctor can change). */
  form: string;
  morning: string;
  noon: string;
  night: string;
  days: string;
  instruction: string;
};

const digits = (s: string) => (s || "").replace(/\D/g, "");
const newRow = (): MedRow => ({
  key: Math.random().toString(36).slice(2),
  medicine: null,
  form: "tablet",
  morning: "1",
  noon: "0",
  night: "1",
  days: "7",
  instruction: "After Food",
});

function petAge(dob: string | null | undefined) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const months = Math.max(0, Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y}y` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}

function ClinicalVisitPage() {
  const qc = useQueryClient();
  const invalidateMaster = useInvalidateMaster();

  const { data: owners = [], isLoading: ownersLoading } = useOwnerOptions();
  const { data: medicines = [], isLoading: medsLoading } = useMedicines();
  const { data: adviceTemplates = [] } = useMasterList("advice_templates");

  const { data: doctors = [] } = useQuery({
    queryKey: ["doctors", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id,full_name,degree,designation,specialization,additional_qualification,registration_no")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // ---------- selection ----------
  const [petId, setPetId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [patientOpen, setPatientOpen] = useState(false);
  const [patientQuery, setPatientQuery] = useState("");
  const [newPetOpen, setNewPetOpen] = useState(false);
  const [newDoctorOpen, setNewDoctorOpen] = useState(false);
  const [historyPetId, setHistoryPetId] = useState<string | null>(null);

  // ---------- clinical ----------
  const [complaint, setComplaint] = useState("");
  const [examination, setExamination] = useState("");
  const [weight, setWeight] = useState("");
  const [temperature, setTemperature] = useState("");
  const [symptoms, setSymptoms] = useState<Picked[]>([]);
  const [diagnoses, setDiagnoses] = useState<Picked[]>([]);
  const [tests, setTests] = useState<Picked[]>([]);
  const [adviceIds, setAdviceIds] = useState<string[]>([]);
  const [customAdvice, setCustomAdvice] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  // A new visit always starts with an empty medicine list — never carried over.
  const [rows, setRows] = useState<MedRow[]>([newRow()]);

  // ---------- surgery (optional) ----------
  const [surgeryOn, setSurgeryOn] = useState(false);
  const [surgeryType, setSurgeryType] = useState("");
  const [surgeryFee, setSurgeryFee] = useState("");
  const [surgeryPaid, setSurgeryPaid] = useState("");
  const [surgeryFree, setSurgeryFree] = useState(false);

  const patients: PatientRow[] = useMemo(() => {
    const out: PatientRow[] = [];
    for (const o of owners) {
      for (const p of o.pets ?? []) out.push({ petId: p.id, petName: p.name, species: p.species, owner: o });
    }
    return out;
  }, [owners]);

  const patientResults = useMemo(() => {
    const q = patientQuery.trim();
    if (!q) return patients.slice(0, 40);
    const qd = digits(q);
    const scored: { row: PatientRow; score: number }[] = [];
    for (const row of patients) {
      let score = -1;
      if (qd && row.owner.phone && digits(row.owner.phone).includes(qd)) score = 2000;
      const petHit = fuzzyMatch(row.petName, q);
      if (petHit && petHit.score > score) score = petHit.score;
      const ownerHit = fuzzyMatch(row.owner.full_name, q);
      if (ownerHit && ownerHit.score - 20 > score) score = ownerHit.score - 20;
      if (score > 0) scored.push({ row, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 40).map((s) => s.row);
  }, [patients, patientQuery]);

  const selectedPatient = patients.find((p) => p.petId === petId) ?? null;
  const selectedDoctor = doctors.find((d: any) => d.id === doctorId) ?? null;

  const { data: petDetail } = useQuery({
    queryKey: ["clinical-pet", petId],
    enabled: !!petId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pets")
        .select("id,name,species,breed,gender,weight_kg,date_of_birth,owner:pet_owners(id,full_name,phone)")
        .eq("id", petId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    if (petDetail?.weight_kg && !weight) setWeight(String(petDetail.weight_kg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petDetail?.id]);

  const { data: lastVisit, isLoading: lastVisitLoading } = useQuery({
    queryKey: ["clinical-last-visit", petId],
    enabled: !!petId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinical_visits")
        .select("id,visit_date,visit_no,symptoms,diagnoses,tests,prescriptions(id,prescription_items(id))")
        .eq("pet_id", petId)
        .order("visit_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const suggestedAdvice = useMemo(() => {
    const tagPool = new Set([...symptoms, ...diagnoses].map((s) => s.label.toLowerCase()));
    const matched = adviceTemplates.filter((a) =>
      (a.tags ?? []).some((t) => tagPool.has(String(t).toLowerCase())),
    );
    const common = adviceTemplates.filter((a) => a.is_common && !matched.includes(a));
    const picked = adviceTemplates.filter((a) => adviceIds.includes(a.id) && !matched.includes(a) && !common.includes(a));
    return [...matched, ...common, ...picked];
  }, [adviceTemplates, symptoms, diagnoses, adviceIds]);

  const saveAdvice = useMutation({
    mutationFn: async () => {
      const created = await quickAddMaster("advice_templates", customAdvice, {
        tags: [...symptoms, ...diagnoses].map((s) => s.label),
      });
      return created;
    },
    onSuccess: (created) => {
      invalidateMaster("advice_templates");
      setAdviceIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setCustomAdvice("");
      toast.success("Advice saved and selected");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save advice"),
  });

  const savedRef = useRef<{
    petId?: string;
    visit?: { id: string; visit_no: string | null };
    links?: boolean;
    recordId?: string | null;
    rx?: { id: string };
    items?: boolean;
    surgery?: boolean;
  }>({});
  const resetForm = () => {
    savedRef.current = {};
    setPetId("");
    setComplaint("");
    setExamination("");
    setWeight("");
    setTemperature("");
    setSymptoms([]);
    setDiagnoses([]);
    setTests([]);
    setAdviceIds([]);
    setCustomAdvice("");
    setFollowUp("");
    setNotes("");
    setRows([newRow()]);
    setSurgeryOn(false);
    setSurgeryType("");
    setSurgeryFee("");
    setSurgeryPaid("");
    setSurgeryFree(false);
  };

  const filledRows = rows.filter((r) => r.medicine);

  const buildPrintData = (rxNo: string) => {
    const owner = petDetail?.owner ?? selectedPatient?.owner;
    return {
      rxNo,
      date: new Date(),
      pet: {
        name: petDetail?.name ?? selectedPatient?.petName ?? "",
        species: petDetail?.species ?? selectedPatient?.species ?? null,
        breed: petDetail?.breed ?? null,
        gender: petDetail?.gender ?? null,
        age: petAge(petDetail?.date_of_birth),
        weight: weight ? `${weight} kg` : petDetail?.weight_kg ? `${petDetail.weight_kg} kg` : null,
      },
      owner: { name: owner?.full_name ?? null, phone: owner?.phone ?? null },
      chiefComplaint: complaint,
      symptoms: symptoms.map((s) => s.label),
      examination,
      diagnoses: diagnoses.map((d) => d.label),
      tests: tests.map((t) => t.label),
      items: filledRows.map((r) => {
        const unit = unitForForm(r.form);
        const liquid = isLiquidForm(r.form);
        return {
          name: r.medicine!.name,
          schedule: formatSchedule(
            { morning: Number(r.morning) || 0, noon: Number(r.noon) || 0, night: Number(r.night) || 0 },
            unit,
            liquid,
          ),
          duration: r.days ? `${r.days} Days` : "",
          instruction: r.instruction || null,
        };
      }),
      advice: [
        ...adviceTemplates.filter((a) => adviceIds.includes(a.id)).map((a) => a.label),
      ],
      followUp: followUp || null,
      doctor: selectedDoctor
        ? {
            name: (selectedDoctor as any).full_name,
            degree: (selectedDoctor as any).degree,
            designation: (selectedDoctor as any).designation,
            specialization: (selectedDoctor as any).specialization,
            additional: (selectedDoctor as any).additional_qualification,
            registration: (selectedDoctor as any).registration_no,
          }
        : null,
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!petId) throw new Error("Select a patient first");
      const ownerId = petDetail?.owner?.id ?? selectedPatient?.owner.id ?? null;
      // Each step is remembered: when a later step fails and the user taps Save
      // again, the parts already stored are reused instead of creating a
      // duplicate visit, medical record and prescription.
      const done = savedRef.current;
      if (done.petId && done.petId !== petId) savedRef.current = {};
      const step = savedRef.current;
      step.petId = petId;

      let visit = step.visit;
      if (!visit) {
      const { data: visitNo, error: noErr } = await supabase.rpc("next_visit_no");
      if (noErr) throw noErr;

      const { data: newVisit, error: visitErr } = await supabase
        .from("clinical_visits")
        .insert({
          visit_no: (visitNo as string) ?? null,
          owner_id: ownerId,
          pet_id: petId,
          doctor_id: doctorId || null,
          chief_complaint: complaint.trim() || null,
          examination: examination.trim() || null,
          weight_kg: weight ? Number(weight) : null,
          temperature: temperature ? Number(temperature) : null,
          symptoms: symptoms.map((s) => s.label),
          diagnoses: diagnoses.map((d) => d.label),
          tests: tests.map((t) => t.label),
          advice: adviceTemplates.filter((a) => adviceIds.includes(a.id)).map((a) => a.label),
          follow_up_date: followUp || null,
          notes: notes.trim() || null,
        })
        .select("id,visit_no")
        .single();
      if (visitErr) throw visitErr;
      visit = newVisit;
      step.visit = newVisit;
      }

      if (!step.links) {
      const links: Promise<any>[] = [];
      if (symptoms.length)
        links.push(
          supabase.from("visit_symptoms").insert(symptoms.map((s) => ({ visit_id: visit.id, symptom_id: s.id }))) as any,
        );
      if (diagnoses.length)
        links.push(
          supabase
            .from("visit_diagnoses")
            .insert(diagnoses.map((d) => ({ visit_id: visit.id, diagnosis_id: d.id }))) as any,
        );
      if (tests.length)
        links.push(supabase.from("visit_tests").insert(tests.map((t) => ({ visit_id: visit.id, test_id: t.id }))) as any);
      if (adviceIds.length)
        links.push(
          supabase.from("visit_advice").insert(adviceIds.map((id) => ({ visit_id: visit.id, advice_id: id }))) as any,
        );
      const linkResults = await Promise.all(links);
      const linkError = linkResults.find((r: any) => r?.error)?.error;
      if (linkError) throw linkError;
      step.links = true;
      }

      // Keep the classic medical record timeline in sync.
      if (step.recordId === undefined) {
      const { data: record, error: recErr } = await supabase
        .from("medical_records")
        .insert({
          pet_id: petId,
          doctor_id: doctorId || null,
          symptoms: [complaint.trim(), symptoms.map((s) => s.label).join(", ")].filter(Boolean).join(" — ") || null,
          diagnosis: diagnoses.map((d) => d.label).join(", ") || null,
          treatment: filledRows.map((r) => r.medicine!.name).join(", ") || null,
          notes: notes.trim() || null,
          weight_kg: weight ? Number(weight) : null,
          temperature: temperature ? Number(temperature) : null,
        })
        .select("id")
        .single();
      // Timeline copy only — never block the visit/prescription on it.
      if (recErr) console.warn("medical_records sync failed", recErr.message);
      step.recordId = record?.id ?? null;
      }

      const rxNo = `RX-${(visit.visit_no ?? String(visit.id).slice(0, 6)).replace(/^V/, "")}`;
      let rx = step.rx;
      if (!rx) {
      const { data: newRx, error: rxErr } = await supabase
        .from("prescriptions")
        .insert({
          pet_id: petId,
          doctor_id: doctorId || null,
          visit_id: visit.id,
          medical_record_id: step.recordId ?? null,
          rx_no: rxNo,
          follow_up_date: followUp || null,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (rxErr) throw rxErr;
      rx = newRx;
      step.rx = newRx;
      }

      if (filledRows.length && !step.items) {
        const items = filledRows.map((r, i) => {
          const unit = unitForForm(r.form);
          const liquid = isLiquidForm(r.form);
          const morning = Number(r.morning) || 0;
          const noon = Number(r.noon) || 0;
          const night = Number(r.night) || 0;
          return {
            prescription_id: rx.id,
            product_id: r.medicine!.id,
            medicine_name: r.medicine!.name,
            dose_unit: unit,
            morning,
            noon,
            night,
            duration_days: r.days ? Number(r.days) : null,
            instruction: r.instruction || null,
            sort_order: i,
            // Legacy text columns keep older screens/prints working.
            dosage: formatSchedule({ morning, noon, night }, unit, liquid),
            frequency: formatSchedule({ morning, noon, night }, unit, liquid),
            duration: r.days ? `${r.days} Days` : null,
            instructions: r.instruction || null,
          };
        });
        const { error: itemErr } = await supabase.from("prescription_items").insert(items);
        if (itemErr) throw itemErr;
        step.items = true;
      }

      if (surgeryOn && surgeryType.trim() && !step.surgery) {
        const fee = surgeryFree ? 0 : Number(surgeryFee) || 0;
        const { error: surgErr } = await supabase.from("surgeries").insert({
          visit_id: visit.id,
          pet_id: petId,
          owner_id: ownerId,
          doctor_id: doctorId || null,
          surgery_type: surgeryType.trim(),
          fee,
          paid: surgeryFree ? 0 : Math.min(Number(surgeryPaid) || 0, fee),
          is_free: surgeryFree || fee === 0,
        });
        if (surgErr) throw surgErr;
        step.surgery = true;
      }

      return rxNo;
    },
    onSuccess: (rxNo) => {
      const printData = buildPrintData(rxNo);
      qc.invalidateQueries({ queryKey: ["prescriptions"] });
      qc.invalidateQueries({ queryKey: ["medical-recent"] });
      qc.invalidateQueries({ queryKey: ["clinical-last-visit"] });
      qc.invalidateQueries({ queryKey: ["clinical-visits"] });
      const ok = printClinicalPrescription(printData as any);
      if (!ok) toast.error("Allow pop-ups to print the prescription");
      toast.success(`Visit saved · ${rxNo}`);
      resetForm();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save the visit"),
  });

  const section = "rounded-lg border bg-card p-4 space-y-3";
  const sectionTitle = "text-[11px] font-semibold uppercase tracking-[0.12em] text-primary";

  return (
    <div className="pb-28">
      <PageHeader
        title="Clinical Visit"
        description="Search a patient, record findings, prescribe and print — in one screen."
        icon={Stethoscope}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------------- PATIENT ---------------- */}
        <div className={section}>
          <div className="flex items-center justify-between">
            <span className={sectionTitle}>Patient</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNewPetOpen(true)}>
              <UserPlus className="h-4 w-4" /> Add new pet
            </Button>
          </div>

          <Popover open={patientOpen} onOpenChange={setPatientOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="w-full justify-between font-normal min-w-0">
                <span className={cn("truncate", !selectedPatient && "text-muted-foreground")}>
                  {selectedPatient
                    ? `${selectedPatient.petName} · ${selectedPatient.owner.full_name}`
                    : ownersLoading
                      ? "Loading patients…"
                      : "Search pet, owner name or phone"}
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(92vw,26rem)] p-0" align="start">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  autoFocus
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder="Pet name, owner name or phone…"
                  className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {ownersLoading && (
                  <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                )}
                {!ownersLoading && patientResults.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">No patient found</div>
                )}
                {patientResults.map((row) => (
                  <button
                    key={row.petId}
                    type="button"
                    onClick={() => {
                      setPetId(row.petId);
                      setPatientOpen(false);
                      setPatientQuery("");
                    }}
                    className={cn(
                      "flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent",
                      row.petId === petId && "bg-accent/60",
                    )}
                  >
                    <span className="truncate font-medium">
                      {row.petName}
                      {row.species ? <span className="ml-1 text-xs capitalize text-muted-foreground">({row.species})</span> : null}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {row.owner.full_name}
                      {row.owner.phone ? ` · ${row.owner.phone}` : ""}
                    </span>
                  </button>
                ))}
              </div>
              <div className="border-t p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    setPatientOpen(false);
                    setNewPetOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" /> Add new pet
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {petDetail && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge variant="secondary" className="capitalize">{petDetail.species ?? "pet"}</Badge>
              {petDetail.breed && <Badge variant="outline">{petDetail.breed}</Badge>}
              {petDetail.gender && <Badge variant="outline" className="capitalize">{petDetail.gender}</Badge>}
              {petAge(petDetail.date_of_birth) && <Badge variant="outline">{petAge(petDetail.date_of_birth)}</Badge>}
              {petDetail.owner?.phone && <Badge variant="outline">{petDetail.owner.phone}</Badge>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Weight (kg)</Label>
              <Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Temperature (°F)</Label>
              <Input inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
            </div>
          </div>

          {petId && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs">
              {lastVisitLoading ? (
                <span className="text-muted-foreground">Loading last visit…</span>
              ) : lastVisit ? (
                <div className="space-y-1">
                  <div className="font-semibold uppercase tracking-wide text-muted-foreground">
                    Last visit — {new Date(lastVisit.visit_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                  <div>Symptoms: {(lastVisit.symptoms ?? []).join(", ") || "—"}</div>
                  <div>Diagnosis: {(lastVisit.diagnoses ?? []).join(", ") || "—"}</div>
                  <div>Tests: {(lastVisit.tests ?? []).join(", ") || "—"}</div>
                  <div>
                    Prescription:{" "}
                    {(lastVisit.prescriptions ?? []).reduce(
                      (n: number, p: any) => n + (p.prescription_items?.length ?? 0),
                      0,
                    )}{" "}
                    medicines
                  </div>
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setHistoryPetId(petId)}>
                    View full history
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">No previous clinical visit on record.</span>
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setHistoryPetId(petId)}>
                    View history
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---------------- DOCTOR + PRESENTATION ---------------- */}
        <div className={section}>
          <div className="flex items-center justify-between">
            <span className={sectionTitle}>Doctor &amp; Presentation</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNewDoctorOpen(true)}>
              <Plus className="h-4 w-4" /> Add doctor
            </Button>
          </div>

          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger><SelectValue placeholder="Select doctor" /></SelectTrigger>
            <SelectContent>
              {doctors.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.full_name}
                  {d.degree ? ` · ${d.degree}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="space-y-1.5">
            <Label className="text-xs">Chief complaint / clinical presentation</Label>
            <Textarea rows={2} value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Owner reports…" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Examination</Label>
            <Textarea rows={2} value={examination} onChange={(e) => setExamination(e.target.value)} placeholder="On examination…" />
          </div>
        </div>

        {/* ---------------- SYMPTOMS / DIAGNOSIS / TESTS ---------------- */}
        <div className={section}>
          <span className={sectionTitle}>Symptoms</span>
          <MasterMultiSelect table="symptoms" placeholder="Add symptom" selected={symptoms} onChange={setSymptoms} />
          <div className="pt-2">
            <span className={sectionTitle}>Diagnosis</span>
            <div className="pt-2">
              <MasterMultiSelect table="diagnoses" placeholder="Add diagnosis" selected={diagnoses} onChange={setDiagnoses} />
            </div>
          </div>
          <div className="pt-2">
            <span className={sectionTitle}>Tests / Investigation</span>
            <div className="pt-2">
              <MasterMultiSelect table="medical_tests" placeholder="Add test" selected={tests} onChange={setTests} />
            </div>
          </div>
        </div>

        {/* ---------------- ADVICE + FOLLOW-UP ---------------- */}
        <div className={section}>
          <span className={sectionTitle}>Advice</span>
          <div className="space-y-1.5">
            {suggestedAdvice.length === 0 && (
              <p className="text-xs text-muted-foreground">No saved advice yet — write one below and save it.</p>
            )}
            {suggestedAdvice.map((a) => (
              <label key={a.id} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={adviceIds.includes(a.id)}
                  onCheckedChange={(c) =>
                    setAdviceIds((prev) => (c ? [...prev, a.id] : prev.filter((x) => x !== a.id)))
                  }
                />
                <span className="leading-tight">{a.label}</span>
              </label>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Write new advice</Label>
            <Textarea rows={2} value={customAdvice} onChange={(e) => setCustomAdvice(e.target.value)} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!customAdvice.trim() || saveAdvice.isPending}
              onClick={() => saveAdvice.mutate()}
            >
              {saveAdvice.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Save as new advice
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Follow-up date</Label>
              <Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Internal note</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Not printed" />
            </div>
          </div>
        </div>

        {/* ---------------- SURGERY (optional) ---------------- */}
        <div className={cn(section, "lg:col-span-2")}>
          <label className="flex items-center gap-2">
            <Checkbox checked={surgeryOn} onCheckedChange={(c) => setSurgeryOn(!!c)} />
            <span className={sectionTitle}>Surgery performed in this visit</span>
          </label>
          {surgeryOn && (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Surgery type</Label>
                <Input
                  value={surgeryType}
                  onChange={(e) => setSurgeryType(e.target.value)}
                  placeholder="Spay / Neuter / Wound repair"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Surgery fee</Label>
                <Input
                  inputMode="decimal"
                  value={surgeryFree ? "0" : surgeryFee}
                  disabled={surgeryFree}
                  onChange={(e) => setSurgeryFee(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Collected now</Label>
                <Input
                  inputMode="decimal"
                  value={surgeryFree ? "0" : surgeryPaid}
                  disabled={surgeryFree}
                  onChange={(e) => setSurgeryPaid(e.target.value)}
                  placeholder="0"
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-4">
                <Checkbox checked={surgeryFree} onCheckedChange={(c) => setSurgeryFree(!!c)} />
                Free surgery (no fee charged)
              </label>
            </div>
          )}
        </div>

        {/* ---------------- MEDICINES ---------------- */}
        <Card className="lg:col-span-2">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className={sectionTitle}>
                <Pill className="mr-1 inline h-3.5 w-3.5" /> Medicines (Rx)
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, newRow()])}>
                <Plus className="h-4 w-4" /> Add medicine
              </Button>
            </div>

            {rows.map((row, idx) => {
              const unit = row.medicine ? unitForForm(row.form) : "";
              const liquid = isLiquidForm(row.form);
              const preview = row.medicine
                ? formatSchedule(
                    { morning: Number(row.morning) || 0, noon: Number(row.noon) || 0, night: Number(row.night) || 0 },
                    unit,
                    liquid,
                  )
                : "—";
              const set = (patch: Partial<MedRow>) =>
                setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, ...patch } : r)));
              return (
                <div key={row.key} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 text-xs text-muted-foreground">{String(idx + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1 space-y-3">
                      <MedicinePicker
                        medicines={medicines}
                        loading={medsLoading}
                        value={row.medicine}
                        onSelect={(m) => set({ medicine: m, form: resolveDoseForm(m) ?? "tablet" })}
                      />
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        <div className="col-span-3 space-y-1 sm:col-span-1">
                          <Label className="text-[11px] text-muted-foreground">Form</Label>
                          <Select value={row.form} onValueChange={(v) => set({ form: v })}>
                            <SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DOSE_FORMS.map((d) => (
                                <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {(["morning", "noon", "night"] as const).map((slot) => (
                          <div key={slot} className="space-y-1">
                            <Label className="text-[11px] capitalize text-muted-foreground">{slot}</Label>
                            <Input
                              inputMode="decimal"
                              value={row[slot]}
                              onChange={(e) => set({ [slot]: e.target.value } as any)}
                            />
                          </div>
                        ))}
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Days</Label>
                          <Input inputMode="numeric" value={row.days} onChange={(e) => set({ days: e.target.value })} />
                        </div>
                        <div className="col-span-3 space-y-1 sm:col-span-1">
                          <Label className="text-[11px] text-muted-foreground">Instruction</Label>
                          <Select value={row.instruction} onValueChange={(v) => set({ instruction: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {INSTRUCTIONS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge className="font-mono">{preview}</Badge>
                        {row.days && <Badge variant="outline">{row.days} Days</Badge>}
                        {row.medicine && (
                          <span className="capitalize text-muted-foreground">
                            {row.form} · dosed in {unit}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setRows((prev) => (prev.length === 1 ? [newRow()] : prev.filter((r) => r.key !== row.key)))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* ---------------- SAVE BAR ---------------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 backdrop-blur md:left-[var(--sidebar-width,0px)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            <span className="truncate">
              {selectedPatient ? selectedPatient.petName : "No patient"} ·{" "}
              {filledRows.length} medicine{filledRows.length === 1 ? "" : "s"}
            </span>
          </div>
          <Button
            size="lg"
            className="shrink-0"
            disabled={!petId || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
            Save visit &amp; generate prescription
          </Button>
        </div>
      </div>

      <NewPatientDialog
        open={newPetOpen}
        onOpenChange={setNewPetOpen}
        owners={owners}
        onCreated={(newPetId) => setPetId(newPetId)}
      />
      <AddDoctorDialog open={newDoctorOpen} onOpenChange={setNewDoctorOpen} onCreated={(id) => setDoctorId(id)} />
      <PetHistorySheet petId={historyPetId} onClose={() => setHistoryPetId(null)} />
    </div>
  );
}
