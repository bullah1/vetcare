import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CalendarClock,
  ClipboardList,
  HeartPulse,
  PawPrint,
  Pill,
  Scissors,
  Stethoscope,
  Wallet,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dhakaDayKey, shiftDay } from "@/lib/sales-summary";
import {
  PRESET_LABELS,
  WEEKDAYS,
  dayKeysBetween,
  dhakaParts,
  inRange,
  money,
  pctOf,
  presetRange,
  speciesLabel,
  todayKey,
  topCounts,
  type Counted,
  type RangePreset,
} from "@/lib/clinic-analytics";
import { CaseDrillDown } from "@/components/clinical/CaseDrillDown";
import { PetHistorySheet } from "@/components/PetHistorySheet";
import {
  AGE_GROUPS,
  WEIGHT_GROUPS,
  applyFilters,
  buildCases,
  buckets,
  emptyFilters,
  uniquePatients,
  uniqueValues,
  type CaseRow,
  type Crumb,
  type Dimension,
  type Filters,
  type RawPet,
  type RawRecord,
  type RawRx,
  type RawSurgery,
  type RawVisit,
} from "@/lib/clinical-intel";

export const Route = createFileRoute("/_authenticated/clinic-dashboard")({
  head: () => ({
    meta: [
      { title: "Clinic Dashboard — Pet Care Vet" },
      {
        name: "description",
        content: "Clinical analytics for Pet Care Vet: patients, visits, appointments, consultation fees and surgeries.",
      },
      { property: "og:title", content: "Clinic Dashboard — Pet Care Vet" },
      {
        property: "og:description",
        content: "Patient mix, clinical activity, consultation fees, surgery revenue and top clinical analysis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClinicDashboard,
});

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground))",
];

type Visit = {
  id: string;
  visit_date: string;
  pet_id: string;
  doctor_id: string | null;
  appointment_id: string | null;
  symptoms: string[] | null;
  diagnoses: string[] | null;
  tests: string[] | null;
  follow_up_date: string | null;
};
type Appt = {
  id: string;
  scheduled_at: string;
  pet_id: string | null;
  doctor_id: string | null;
  status: string;
  fee: number | string;
  paid: number | string;
  discount: number | string | null;
};
type Rx = {
  id: string;
  issued_at: string;
  pet_id: string;
  doctor_id: string | null;
  prescription_items: { medicine_name: string }[] | null;
};
type Surgery = {
  id: string;
  surgery_date: string;
  surgery_type: string;
  pet_id: string;
  doctor_id: string | null;
  fee: number | string;
  paid: number | string;
  discount: number | string | null;
  is_free: boolean;
};
type Pet = { id: string; name: string; species: string | null; owner_id: string; created_at: string };

function ClinicDashboard() {
  const [preset, setPreset] = useState<RangePreset>("month");
  const [customFrom, setCustomFrom] = useState(shiftDay(todayKey(), -29));
  const [customTo, setCustomTo] = useState(todayKey());
  const [doctorId, setDoctorId] = useState("all");
  const [caseFilters, setCaseFilters] = useState(() => emptyFilters(todayKey(), todayKey()));
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [petId, setPetId] = useState<string | null>(null);
  const setCase = <K extends keyof Filters>(k: K, v: Filters[K]) => setCaseFilters((f) => ({ ...f, [k]: v }));

  const { from, to } =
    preset === "custom"
      ? { from: customFrom <= customTo ? customFrom : customTo, to: customTo >= customFrom ? customTo : customFrom }
      : presetRange(preset);

  const { data: doctors = [] } = useQuery({
    // unique cache key: the same key held a different column set on another page
    queryKey: ["doctors", "active", "names"],
    queryFn: async () =>
      (await supabase.from("doctors").select("id,full_name").eq("is_active", true).order("full_name")).data ?? [],
  });

  const clinic = useQuery({
    queryKey: ["clinic-dashboard"],
    queryFn: async () => {
      const [pets, visits, appts, rxs, surgeries, owners] = await Promise.all([
        fetchAll<Pet>(() => supabase.from("pets").select("id,name,species,owner_id,created_at") as any),
        fetchAll<Visit>(
          () =>
            supabase
              .from("clinical_visits")
              .select("id,visit_date,pet_id,doctor_id,appointment_id,symptoms,diagnoses,tests,follow_up_date")
              .order("visit_date", { ascending: false }) as any,
        ),
        fetchAll<Appt>(
          () =>
            supabase
              .from("appointments")
              .select("id,scheduled_at,pet_id,doctor_id,status,fee,paid,discount")
              .order("scheduled_at", { ascending: false }) as any,
        ),
        fetchAll<Rx>(
          () =>
            supabase
              .from("prescriptions")
              .select("id,issued_at,pet_id,doctor_id,prescription_items(medicine_name)")
              .order("issued_at", { ascending: false }) as any,
        ),
        fetchAll<Surgery>(
          () =>
            supabase
              .from("surgeries")
              .select("id,surgery_date,surgery_type,pet_id,doctor_id,fee,paid,discount,is_free")
              .order("surgery_date", { ascending: false }) as any,
        ),
        fetchAll<{ id: string; full_name: string; phone: string | null }>(
          () => supabase.from("pet_owners").select("id,full_name,phone") as any,
        ),
      ]);
      return { pets, visits, appts, rxs, surgeries, owners };
    },
  });

  /* Case-level records power the drill-down analysis (visits + legacy records + prescriptions + surgeries). */
  const caseSource = useQuery({
    queryKey: ["clinical-intelligence"],
    queryFn: async () => {
      const [visits, records, pets, prescriptions, surgeries, allDoctors] = await Promise.all([
        fetchAll<RawVisit>(
          () =>
            supabase
              .from("clinical_visits")
              .select("id,visit_date,pet_id,doctor_id,symptoms,diagnoses,tests,weight_kg,follow_up_date")
              .order("visit_date", { ascending: false }) as any,
        ),
        fetchAll<RawRecord>(
          () =>
            supabase
              .from("medical_records")
              .select("id,visit_date,pet_id,doctor_id,symptoms,diagnosis,weight_kg")
              .order("visit_date", { ascending: false }) as any,
        ),
        fetchAll<RawPet>(
          () =>
            supabase
              .from("pets")
              .select("id,name,species,breed,gender,date_of_birth,weight_kg,owner:pet_owners(full_name,phone)") as any,
        ),
        fetchAll<RawRx>(
          () =>
            supabase
              .from("prescriptions")
              .select("id,issued_at,pet_id,visit_id,doctor_id,prescription_items(medicine_name)")
              .order("issued_at", { ascending: false }) as any,
        ),
        fetchAll<RawSurgery>(() => supabase.from("surgeries").select("id,visit_id,pet_id,surgery_type") as any),
        fetchAll<{ id: string; full_name: string }>(() => supabase.from("doctors").select("id,full_name") as any),
      ]);
      return buildCases({ visits, records, pets, prescriptions, surgeries, doctors: allDoctors });
    },
  });

  const allCases: CaseRow[] = caseSource.data ?? [];
  const caseRows = useMemo(
    () => applyFilters(allCases, { ...caseFilters, from, to, doctorId }),
    [allCases, caseFilters, from, to, doctorId],
  );
  const options = useMemo(
    () => ({
      species: uniqueValues(allCases, "species"),
      breed: uniqueValues(allCases, "breed"),
      gender: uniqueValues(allCases, "gender"),
      diagnosis: uniqueValues(allCases, "diagnosis"),
      symptom: uniqueValues(allCases, "symptom"),
      medicine: uniqueValues(allCases, "medicine"),
    }),
    [allCases],
  );
  const caseFilterCount = (["species", "breed", "gender", "age", "weight", "diagnosis", "symptom", "medicine"] as const).filter(
    (k) => caseFilters[k] !== "all",
  ).length + (caseFilters.search.trim() ? 1 : 0);
  const drill = (dim: Dimension, value: string) => setCrumbs([{ dim, value }]);


  const stats = useMemo(() => {
    const d = clinic.data;
    if (!d) return null;
    const byDoctor = <T extends { doctor_id: string | null }>(rows: T[]) =>
      doctorId === "all" ? rows : rows.filter((r) => r.doctor_id === doctorId);

    const petById = new Map(d.pets.map((p) => [p.id, p]));
    const doctorById = new Map((doctors as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name]));
    const ownerById = new Map(d.owners.map((o) => [o.id, o]));

    const visits = byDoctor(d.visits);
    const appts = byDoctor(d.appts);
    const rxs = byDoctor(d.rxs);
    const surgeries = byDoctor(d.surgeries);

    const visitsIn = visits.filter((v) => inRange(v.visit_date, from, to));
    const apptsIn = appts.filter((a) => inRange(a.scheduled_at, from, to));
    const rxIn = rxs.filter((r) => inRange(r.issued_at, from, to));
    const surgIn = surgeries.filter((s) => inRange(s.surgery_date, from, to));

    // ---- patients ----
    // Lifetime encounter dates per pet (all doctors) decide new vs repeat.
    const firstSeen = new Map<string, string>();
    const lifetimeVisits = new Map<string, number>();
    const record = (petId: string | null, iso: string) => {
      if (!petId) return;
      const key = dhakaDayKey(iso);
      const cur = firstSeen.get(petId);
      if (!cur || key < cur) firstSeen.set(petId, key);
      lifetimeVisits.set(petId, (lifetimeVisits.get(petId) ?? 0) + 1);
    };
    d.visits.forEach((v) => record(v.pet_id, v.visit_date));
    d.appts.forEach((a) => record(a.pet_id, a.scheduled_at));

    const patientsIn = new Set<string>();
    visitsIn.forEach((v) => patientsIn.add(v.pet_id));
    apptsIn.forEach((a) => a.pet_id && patientsIn.add(a.pet_id));

    let newPatients = 0;
    const repeatPatients: { petId: string; visits: number }[] = [];
    patientsIn.forEach((petId) => {
      const first = firstSeen.get(petId);
      if (first && first >= from && first <= to) newPatients += 1;
      const count = lifetimeVisits.get(petId) ?? 0;
      if (count > 1) repeatPatients.push({ petId, visits: count });
    });
    repeatPatients.sort((a, b) => b.visits - a.visits);

    const speciesMix = topCounts(
      Array.from(patientsIn, (id) => speciesLabel(petById.get(id)?.species)),
      8,
    );

    // species trend over the last 6 calendar months (visits)
    const months: string[] = [];
    const nowMonth = todayKey().slice(0, 7);
    for (let i = 5; i >= 0; i--) {
      const [y, m] = nowMonth.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1 - i, 1));
      months.push(dt.toISOString().slice(0, 7));
    }
    const topSpecies = speciesMix.slice(0, 4).map((s) => s.name);
    const speciesTrend = months.map((mk) => {
      const row: Record<string, string | number> = { period: mk.slice(2) };
      topSpecies.forEach((sp) => (row[sp] = 0));
      visits
        .filter((v) => dhakaDayKey(v.visit_date).startsWith(mk))
        .forEach((v) => {
          const sp = speciesLabel(petById.get(v.pet_id)?.species);
          if (sp in row) row[sp] = Number(row[sp]) + 1;
        });
      return row;
    });

    // ---- clinical activity ----
    const statusCount = (s: string) => apptsIn.filter((a) => a.status === s).length;
    const completed = statusCount("completed");
    const cancelled = statusCount("cancelled") + statusCount("no_show");
    const pending = apptsIn.filter((a) => !["completed", "cancelled", "no_show"].includes(a.status)).length;

    // appointment -> clinical visit conversion
    const visitApptIds = new Set(d.visits.map((v) => v.appointment_id).filter(Boolean) as string[]);
    const converted = apptsIn.filter((a) => visitApptIds.has(a.id)).length;
    const conversionRate = pctOf(converted, apptsIn.length);

    // doctor-wise clinical activity
    const doctorName = (id: string | null) => (id ? (doctorById.get(id) ?? "Unknown doctor") : "Unassigned");
    const doctorActivity = Array.from(
      new Set([...visitsIn.map((v) => v.doctor_id), ...apptsIn.map((a) => a.doctor_id), ...surgIn.map((s) => s.doctor_id)]),
      (id) => ({
        id,
        name: doctorName(id),
        visits: visitsIn.filter((v) => v.doctor_id === id).length,
        appointments: apptsIn.filter((a) => a.doctor_id === id).length,
        prescriptions: rxIn.filter((r) => r.doctor_id === id).length,
        surgeries: surgIn.filter((s) => s.doctor_id === id).length,
      }),
    ).sort((a, b) => b.visits + b.appointments - (a.visits + a.appointments));


    const today = todayKey();
    const followUps = visits
      .filter((v) => v.follow_up_date && v.follow_up_date >= shiftDay(today, -14) && v.follow_up_date <= shiftDay(today, 14))
      .sort((a, b) => String(a.follow_up_date).localeCompare(String(b.follow_up_date)))
      .map((v) => {
        const pet = petById.get(v.pet_id);
        return {
          id: v.id,
          date: v.follow_up_date as string,
          petName: pet?.name ?? "Patient",
          ownerName: pet ? (ownerById.get(pet.owner_id)?.full_name ?? "") : "",
          overdue: (v.follow_up_date as string) < today,
        };
      });
    const followUpDue = followUps.length;

    // ---- clinical fees (consultation) ----
    const fee = apptsIn.reduce((n, a) => n + Number(a.fee || 0), 0);
    const paidFee = apptsIn.reduce((n, a) => n + Number(a.paid || 0), 0);
    const dueFee = apptsIn.reduce(
      (n, a) => n + Math.max(Number(a.fee || 0) - Number(a.paid || 0), 0),
      0,
    );
    const discount = apptsIn.reduce((n, a) => n + Number(a.discount || 0), 0);
    const freeConsults = apptsIn.filter((a) => Number(a.fee || 0) === 0).length;

    // ---- surgery ----
    const surgeryRevenue = surgIn.reduce((n, s) => n + Number(s.paid || 0), 0);
    const freeSurgeries = surgIn.filter((s) => s.is_free || Number(s.fee || 0) === 0).length;
    const paidSurgeries = surgIn.length - freeSurgeries;
    const surgeryDue = surgIn.reduce((n, s) => n + Math.max(Number(s.fee || 0) - Number(s.paid || 0), 0), 0);
    const surgeryTypes = topCounts(surgIn.map((s) => s.surgery_type), 6);
    const surgerySpecies = topCounts(surgIn.map((s) => speciesLabel(petById.get(s.pet_id)?.species)), 6);
    const surgeryDoctors = topCounts(
      surgIn.map((s) => (s.doctor_id ? (doctorById.get(s.doctor_id) ?? "Unknown doctor") : "Unassigned")),
      6,
    );
    const surgeryFee = surgIn.reduce((n, s) => n + Number(s.fee || 0), 0);
    const surgeryTrendDays = dayKeysBetween(from, to).map((day) => ({
      day: day.slice(5),
      surgeries: surgIn.filter((s) => dhakaDayKey(s.surgery_date) === day).length,
    }));

    // ---- trends ----
    const days = dayKeysBetween(from, to);
    const trend = days.map((day) => ({
      day: day.slice(5),
      visits: visitsIn.filter((v) => dhakaDayKey(v.visit_date) === day).length,
      appointments: apptsIn.filter((a) => dhakaDayKey(a.scheduled_at) === day).length,
      prescriptions: rxIn.filter((r) => dhakaDayKey(r.issued_at) === day).length,
    }));

    const weekdayPeak = WEEKDAYS.map((name) => ({ name, count: 0 }));
    const hourPeak = Array.from({ length: 24 }, (_, h) => ({ name: `${String(h).padStart(2, "0")}:00`, count: 0 }));
    apptsIn.forEach((a) => {
      const { weekday, hour } = dhakaParts(a.scheduled_at);
      weekdayPeak[weekday].count += 1;
      hourPeak[hour].count += 1;
    });

    // ---- top analysis ----
    const topSymptoms = topCounts(visitsIn.flatMap((v) => v.symptoms ?? []));
    const topDiagnoses = topCounts(visitsIn.flatMap((v) => v.diagnoses ?? []));
    const topServices = topCounts(visitsIn.flatMap((v) => v.tests ?? []));
    const topMedicines = topCounts(rxIn.flatMap((r) => (r.prescription_items ?? []).map((i) => i.medicine_name)));
    const mostRepeat = repeatPatients.slice(0, 6).map((r) => {
      const pet = petById.get(r.petId);
      return {
        name: `${pet?.name ?? "Patient"}${pet ? ` · ${ownerById.get(pet.owner_id)?.full_name ?? ""}` : ""}`,
        count: r.visits,
      };
    });

    return {
      totalPatients: patientsIn.size,
      newPatients,
      repeatPatients: repeatPatients.length,
      repeatRate: pctOf(repeatPatients.length, patientsIn.size),
      allPets: d.pets.length,
      speciesMix,
      speciesTrend,
      topSpecies,
      visits: visitsIn.length,
      prescriptions: rxIn.length,
      appointments: apptsIn.length,
      completed,
      cancelled,
      pending,
      converted,
      conversionRate,
      doctorActivity,
      followUpDue,
      followUps: followUps.slice(0, 8),
      fee,
      paidFee,
      dueFee,
      discount,
      freeConsults,
      surgeries: surgIn.length,
      paidSurgeries,
      freeSurgeries,
      surgeryRevenue,
      surgeryDue,
      surgeryFee,
      surgeryTypes,
      surgerySpecies,
      surgeryDoctors,
      surgeryTrendDays,
      trend,
      weekdayPeak,
      hourPeak: hourPeak.filter((h) => h.count > 0),
      topSymptoms,
      topDiagnoses,
      topServices,
      topMedicines,
      mostRepeat,
      topCategory: speciesMix[0]?.name ?? "—",
    };
  }, [clinic.data, doctors, doctorId, from, to]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clinic Dashboard"
        description="Patients, clinical activity, consultation fees and surgery analytics."
        icon={HeartPulse}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/clinical-visit">
              <Stethoscope className="h-4 w-4" /> New visit
            </Link>
          </Button>
        }
      />

      {/* filters */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(["today", "7d", "month", "last_month", "custom"] as RangePreset[]).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={preset === p ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setPreset(p)}
              >
                {PRESET_LABELS[p]}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {preset === "custom" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">From</Label>
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">To</Label>
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9" />
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Doctor</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger className="h-9 w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All doctors</SelectItem>
                  {doctors.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* clinical analysis filters */}
      <Card>
        <CardContent className="space-y-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Clinical analysis filters
            </p>
            {caseFilterCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setCaseFilters(emptyFilters(from, to))}>
                Clear {caseFilterCount}
              </Button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <PickFilter label="Species" value={caseFilters.species} options={options.species} onChange={(v) => setCase("species", v)} />
            <PickFilter label="Breed" value={caseFilters.breed} options={options.breed} onChange={(v) => setCase("breed", v)} />
            <PickFilter label="Gender" value={caseFilters.gender} options={options.gender} onChange={(v) => setCase("gender", v)} />
            <PickFilter label="Age group" value={caseFilters.age} options={[...AGE_GROUPS]} onChange={(v) => setCase("age", v)} />
            <PickFilter label="Weight group" value={caseFilters.weight} options={[...WEIGHT_GROUPS]} onChange={(v) => setCase("weight", v)} />
            <PickFilter label="Diagnosis" value={caseFilters.diagnosis} options={options.diagnosis} onChange={(v) => setCase("diagnosis", v)} />
            <PickFilter label="Symptom" value={caseFilters.symptom} options={options.symptom} onChange={(v) => setCase("symptom", v)} />
            <PickFilter label="Medicine" value={caseFilters.medicine} options={options.medicine} onChange={(v) => setCase("medicine", v)} />
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] text-muted-foreground">Search patient / owner / phone</Label>
              <Input
                value={caseFilters.search}
                onChange={(e) => setCase("search", e.target.value)}
                placeholder="Search cases…"
                className="h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Showing {from} → {to}
        {doctorId !== "all" && " · filtered by doctor"}
      </p>

      {clinic.isLoading && <SkeletonGrid />}
      {clinic.isError && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Could not load clinic data.{" "}
            <Button size="sm" variant="outline" onClick={() => clinic.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {stats && (
        <>
          {/* PATIENTS */}
          <SectionTitle icon={PawPrint} label="Patients" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Patients seen" value={stats.totalPatients} hint={`${stats.allPets} registered in total`} />
            <Kpi label="New patients" value={stats.newPatients} />
            <Kpi label="Repeat patients" value={stats.repeatPatients} />
            <Kpi label="Repeat %" value={`${stats.repeatRate.toFixed(1)}%`} />
            <Kpi label="Top category" value={stats.topCategory} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Species mix</CardTitle>
                <CardDescription className="text-xs">Patients seen in this period</CardDescription>
              </CardHeader>
              <CardContent className="h-[240px]">
                {stats.speciesMix.length === 0 ? (
                  <Empty />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={stats.speciesMix} dataKey="count" nameKey="name" innerRadius={45} outerRadius={80}>
                        {stats.speciesMix.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Species-wise visit trend</CardTitle>
                <CardDescription className="text-xs">Last 6 months of clinical visits</CardDescription>
              </CardHeader>
              <CardContent className="h-[240px]">
                {stats.topSpecies.length === 0 ? (
                  <Empty />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.speciesTrend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                      <XAxis dataKey="period" fontSize={11} />
                      <YAxis fontSize={11} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      {stats.topSpecies.map((sp, i) => (
                        <Bar key={sp} dataKey={sp} stackId="s" fill={PIE_COLORS[i % PIE_COLORS.length]} radius={2} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* CLINICAL ACTIVITY */}
          <SectionTitle icon={Activity} label="Clinical activity" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Clinical visits" value={stats.visits} />
            <Kpi label="Prescriptions" value={stats.prescriptions} />
            <Kpi label="Appointments" value={stats.appointments} />
            <Kpi label="Completed" value={stats.completed} tone="good" />
            <Kpi label="Pending" value={stats.pending} />
            <Kpi label="Cancelled / no-show" value={stats.cancelled} tone="warn" />
            <Kpi
              label="Appointment → visit"
              value={`${stats.conversionRate.toFixed(1)}%`}
              hint={`${stats.converted} of ${stats.appointments} converted`}
            />
            <Kpi label="Follow-up due" value={stats.followUpDue} tone="warn" />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Doctor-wise clinical activity</CardTitle>
              <CardDescription className="text-xs">Visits, appointments, prescriptions and surgeries</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.doctorActivity.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No activity in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Doctor</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right">Appointments</TableHead>
                      <TableHead className="text-right">Prescriptions</TableHead>
                      <TableHead className="text-right">Surgeries</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.doctorActivity.map((row) => (
                      <TableRow key={row.id ?? "unassigned"} className="cursor-pointer" onClick={() => drill("doctor", row.name)}>
                        <TableCell className="max-w-[220px] truncate font-medium">{row.name}</TableCell>
                        <TableCell className="text-right">{row.visits}</TableCell>
                        <TableCell className="text-right">{row.appointments}</TableCell>
                        <TableCell className="text-right">{row.prescriptions}</TableCell>
                        <TableCell className="text-right">{row.surgeries}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Daily clinical activity</CardTitle>
              <CardDescription className="text-xs">Visits, appointments and prescriptions</CardDescription>
            </CardHeader>
            <CardContent className="h-[260px]">
              {stats.trend.length === 0 ? (
                <Empty />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.trend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="visits" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.18} />
                    <Area type="monotone" dataKey="appointments" stroke="hsl(var(--accent))" fill="hsl(var(--accent))" fillOpacity={0.12} />
                    <Area type="monotone" dataKey="prescriptions" stroke="hsl(var(--success))" fill="hsl(var(--success))" fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* FEES */}
          <SectionTitle icon={Wallet} label="Clinical fees" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Total consultation fee" value={money(stats.fee)} />
            <Kpi label="Paid fee" value={money(stats.paidFee)} tone="good" />
            <Kpi label="Due fee" value={money(stats.dueFee)} tone="warn" />
            <Kpi label="Discount given" value={money(stats.discount)} />
            <Kpi label="Free consultations" value={stats.freeConsults} />
          </div>

          {/* SURGERY */}
          <SectionTitle icon={Scissors} label="Surgery" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi label="Total surgeries" value={stats.surgeries} />
            <Kpi label="Paid surgeries" value={stats.paidSurgeries} />
            <Kpi label="Free surgeries" value={stats.freeSurgeries} />
            <Kpi label="Surgery fee" value={money(stats.surgeryFee)} />
            <Kpi label="Surgery collected" value={money(stats.surgeryRevenue)} tone="good" />
            <Kpi label="Surgery due" value={money(stats.surgeryDue)} tone="warn" />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <DrillTable
              title="Surgery types"
              rows={stats.surgeryTypes}
              unit="surgeries"
              onPick={(name) => drill("surgery", name)}
            />
            <DrillTable
              title="Species-wise surgery"
              rows={stats.surgerySpecies}
              unit="surgeries"
              onPick={(name) => drill("species", name)}
            />
            <DrillTable
              title="Doctor-wise surgery"
              rows={stats.surgeryDoctors}
              unit="surgeries"
              onPick={(name) => drill("doctor", name)}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Surgery trend</CardTitle>
                <CardDescription className="text-xs">Surgeries per day in this period</CardDescription>
              </CardHeader>
              <CardContent className="h-[200px]">
                {stats.surgeries === 0 ? (
                  <Empty />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.surgeryTrendDays}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                      <XAxis dataKey="day" fontSize={11} />
                      <YAxis fontSize={11} allowDecimals={false} />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="surgeries"
                        stroke="hsl(var(--primary))"
                        fill="hsl(var(--primary))"
                        fillOpacity={0.16}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-warning" /> Follow-up alerts
                </CardTitle>
                <CardDescription className="text-xs">Two weeks before and after today</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.followUps.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No follow-ups scheduled.</p>
                ) : (
                  stats.followUps.map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{f.petName}</p>
                        <p className="truncate text-xs text-muted-foreground">{f.ownerName}</p>
                      </div>
                      <Badge variant={f.overdue ? "destructive" : "outline"} className="shrink-0">
                        <CalendarClock className="mr-1 h-3 w-3" />
                        {f.date}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* CLINICAL INTELLIGENCE — DRILL-DOWN ANALYSIS */}
          <SectionTitle icon={ClipboardList} label="Clinical case analysis" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Clinical cases" value={caseRows.length} hint="Visits + medical records" />
            <Kpi label="Patients in cases" value={uniquePatients(caseRows)} />
            <Kpi label="Prescriptions in cases" value={caseRows.reduce((n, r) => n + r.prescriptionCount, 0)} />
            <Kpi
              label="Cases with follow-up"
              value={caseRows.filter((r) => r.followUpDate).length}
              hint="Click any row below to drill down"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <DrillTable
              title="Diagnosis-wise cases"
              description="Click a diagnosis for symptoms, species, prescriptions and patients"
              rows={buckets(caseRows, "diagnosis")}
              unit="cases"
              onPick={(name) => drill("diagnosis", name)}
            />
            <DrillTable
              title="Symptom-wise cases"
              description="Click a symptom for diagnoses, groups and historical medicines"
              rows={buckets(caseRows, "symptom")}
              unit="cases"
              onPick={(name) => drill("symptom", name)}
            />
            <DrillTable
              title="Historically prescribed medicines"
              description="From existing prescription records only — not a recommendation"
              rows={buckets(caseRows, "medicine")}
              unit="cases"
              icon={Pill}
              onPick={(name) => drill("medicine", name)}
            />
            <DrillTable
              title="Investigations / tests"
              rows={buckets(caseRows, "test")}
              unit="cases"
              onPick={(name) => drill("test", name)}
            />
            <DrillTable
              title="Species-wise cases"
              rows={buckets(caseRows, "species")}
              unit="cases"
              onPick={(name) => drill("species", name)}
            />
            <DrillTable
              title="Breed-wise cases"
              rows={buckets(caseRows, "breed")}
              unit="cases"
              onPick={(name) => drill("breed", name)}
            />
            <DrillTable
              title="Gender-wise cases"
              rows={buckets(caseRows, "gender")}
              unit="cases"
              onPick={(name) => drill("gender", name)}
            />
            <DrillTable
              title="Age-group cases"
              rows={buckets(caseRows, "age")}
              unit="cases"
              onPick={(name) => drill("age", name)}
            />
            <DrillTable
              title="Weight-group cases"
              rows={buckets(caseRows, "weight")}
              unit="cases"
              onPick={(name) => drill("weight", name)}
            />
            <DrillTable
              title="Most repeat patients"
              description="Click a patient for the full clinical history"
              rows={buckets(caseRows, "patient")}
              unit="cases"
              onPick={(name) => setPetId(caseRows.find((r) => r.petName === name)?.petId ?? null)}
            />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CalendarDays className="h-4 w-4" /> Peak appointment days
                </CardTitle>
                <CardDescription className="text-xs">Busiest weekdays and hours in this period</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-[150px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.weekdayPeak}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                      <XAxis dataKey="name" fontSize={11} />
                      <YAxis fontSize={11} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={3} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {stats.hourPeak.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No appointment hours in this period.</span>
                  ) : (
                    stats.hourPeak
                      .slice()
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 6)
                      .map((h) => (
                        <Badge key={h.name} variant="secondary">
                          {h.name} · {h.count}
                        </Badge>
                      ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <CaseDrillDown rows={caseRows} crumbs={crumbs} setCrumbs={setCrumbs} onOpenPatient={(id) => setPetId(id)} />
      <PetHistorySheet petId={petId} onClose={() => setPetId(null)} />
    </div>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: typeof Activity; label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{label}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "warn";
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={
            tone === "good"
              ? "text-lg font-semibold text-success"
              : tone === "warn"
                ? "text-lg font-semibold text-warning"
                : "text-lg font-semibold"
          }
        >
          {value}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function TopTable({
  title,
  rows,
  unit,
  icon: Icon,
}: {
  title: string;
  rows: Counted[];
  unit: string;
  icon?: typeof Activity;
}) {
  const max = rows[0]?.count ?? 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {Icon && <Icon className="h-4 w-4" />} {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No data in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28 text-right">{unit}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="max-w-[240px] truncate">{r.name}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="h-1.5 rounded-full bg-primary/70" style={{ width: `${max ? (r.count / max) * 56 : 0}px` }} />
                      <span className="font-medium">{r.count}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PickFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Clickable top-N table: each row opens the case drill-down for that value. */
function DrillTable({
  title,
  description,
  rows,
  unit,
  icon: Icon,
  onPick,
}: {
  title: string;
  description?: string;
  rows: { name: string; count: number; patients?: number }[];
  unit: string;
  icon?: typeof Activity;
  onPick?: (name: string) => void;
}) {
  const max = rows[0]?.count ?? 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {Icon && <Icon className="h-4 w-4" />} {title}
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No data in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-20 text-right">Patients</TableHead>
                <TableHead className="w-28 text-right">{unit}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.name}
                  className={onPick ? "cursor-pointer" : undefined}
                  onClick={onPick ? () => onPick(r.name) : undefined}
                >
                  <TableCell className="max-w-[240px] truncate">{r.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{r.patients ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="h-1.5 rounded-full bg-primary/70" style={{ width: `${max ? (r.count / max) * 56 : 0}px` }} />
                      <span className="font-medium">{r.count}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Empty() {
  return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No data in this period.</p>;
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="space-y-2 p-3">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-5 w-16 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
