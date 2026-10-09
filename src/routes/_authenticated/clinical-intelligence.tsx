import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Brain,
  ChevronRight,
  PawPrint,
  Pill,
  Repeat,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CaseDrillDown } from "@/components/clinical/CaseDrillDown";
import { PetHistorySheet } from "@/components/PetHistorySheet";
import { shiftDay } from "@/lib/sales-summary";
import { PRESET_LABELS, dayKeysBetween, presetRange, todayKey, type RangePreset } from "@/lib/clinic-analytics";
import {
  AGE_GROUPS,
  WEIGHT_GROUPS,
  applyFilters,
  buildCases,
  buckets,
  emptyFilters,
  movement,
  repeatBuckets,
  repeatPatientCount,
  trendSeries,
  uniquePatients,
  uniqueValues,
  type Bucket,
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

export const Route = createFileRoute("/_authenticated/clinical-intelligence")({
  head: () => ({
    meta: [
      { title: "Clinical Intelligence — Pet Care Vet" },
      {
        name: "description",
        content:
          "Drill-down clinical analytics for Pet Care Vet: cases, diagnoses, symptoms, species, breeds, historical prescriptions and patients.",
      },
      { property: "og:title", content: "Clinical Intelligence — Pet Care Vet" },
      {
        property: "og:description",
        content: "Explore diagnoses, symptoms, species/breed/age/weight groups and historically prescribed medicines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClinicalIntelligence,
});

function ClinicalIntelligence() {
  const [preset, setPreset] = useState<RangePreset>("month");
  const [filters, setFilters] = useState<Filters>(() => {
    const r = presetRange("month");
    return emptyFilters(r.from, r.to);
  });
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [petId, setPetId] = useState<string | null>(null);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const choosePreset = (p: RangePreset) => {
    setPreset(p);
    if (p !== "custom") {
      const r = presetRange(p);
      setFilters((f) => ({ ...f, from: r.from, to: r.to }));
    }
  };

  const { data: doctors = [] } = useQuery({
    // unique cache key: the same key held a different column set on another page
    queryKey: ["doctors", "active", "names"],
    queryFn: async () =>
      (await supabase.from("doctors").select("id,full_name").eq("is_active", true).order("full_name")).data ?? [],
  });

  const source = useQuery({
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
              .select("id,name,species,breed,date_of_birth,weight_kg,owner:pet_owners(full_name,phone)") as any,
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

  const allCases: CaseRow[] = source.data ?? [];
  const rows = useMemo(() => applyFilters(allCases, filters), [allCases, filters]);

  const breeds = useMemo(() => uniqueValues(allCases, "breed"), [allCases]);
  const speciesList = useMemo(() => uniqueValues(allCases, "species"), [allCases]);
  const diagnosisList = useMemo(() => uniqueValues(allCases, "diagnosis"), [allCases]);
  const symptomList = useMemo(() => uniqueValues(allCases, "symptom"), [allCases]);
  const medicineList = useMemo(() => uniqueValues(allCases, "medicine"), [allCases]);

  const trend = useMemo(() => trendSeries(rows, dayKeysBetween(filters.from, filters.to)), [rows, filters.from, filters.to]);
  const rising = useMemo(() => movement(rows, "diagnosis", filters.from, filters.to), [rows, filters.from, filters.to]);

  const rxTotal = rows.reduce((n, r) => n + r.prescriptionCount, 0);
  const activeFilterCount = (["species", "breed", "age", "weight", "doctorId", "diagnosis", "symptom", "medicine"] as const)
    .filter((k) => filters[k] !== "all").length + (filters.search.trim() ? 1 : 0);

  const drill = (dim: Dimension, value: string) => setCrumbs([{ dim, value }]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clinical Intelligence"
        description="Explore actual clinical cases: diagnoses, symptoms, patient groups and historically prescribed medicines. Historical analytics only — no treatment recommendations."
        icon={Brain}
      />

      {/* filters */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(PRESET_LABELS) as RangePreset[]).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={preset === p ? "default" : "outline"}
                onClick={() => choosePreset(p)}
              >
                {PRESET_LABELS[p]}
              </Button>
            ))}
            {preset === "custom" && (
              <div className="flex items-center gap-2">
                <Input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} className="h-9 w-[9.5rem]" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} className="h-9 w-[9.5rem]" />
              </div>
            )}
            {activeFilterCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setFilters((f) => ({ ...emptyFilters(f.from, f.to) }))}
              >
                Clear {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect label="Species" value={filters.species} onChange={(v) => set("species", v)} options={speciesList} />
            <FilterSelect label="Breed" value={filters.breed} onChange={(v) => set("breed", v)} options={breeds} />
            <FilterSelect label="Age group" value={filters.age} onChange={(v) => set("age", v)} options={[...AGE_GROUPS, "Unknown"]} />
            <FilterSelect label="Weight range" value={filters.weight} onChange={(v) => set("weight", v)} options={[...WEIGHT_GROUPS, "Unknown"]} />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Doctor</Label>
              <Select value={filters.doctorId} onValueChange={(v) => set("doctorId", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All doctors</SelectItem>
                  {doctors.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FilterSelect label="Diagnosis" value={filters.diagnosis} onChange={(v) => set("diagnosis", v)} options={diagnosisList} />
            <FilterSelect label="Symptom" value={filters.symptom} onChange={(v) => set("symptom", v)} options={symptomList} />
            <FilterSelect label="Medicine" value={filters.medicine} onChange={(v) => set("medicine", v)} options={medicineList} />
          </div>

          <Input
            placeholder="Search patient, owner, phone, diagnosis, symptom or medicine…"
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            className="h-9"
          />
        </CardContent>
      </Card>

      {source.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : source.isError ? (
        <Card><CardContent className="p-8 text-center text-sm text-destructive">Could not load clinical records. Please retry.</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Stethoscope} label="Clinical cases" value={rows.length} hint="Visits and medical records" />
            <Kpi icon={PawPrint} label="Patients" value={uniquePatients(rows)} hint="Distinct pets in range" />
            <Kpi icon={Repeat} label="Repeat patients" value={repeatPatientCount(rows)} hint="More than one case in range" />
            <Kpi icon={Pill} label="Prescriptions" value={rxTotal} hint="Linked to these cases" />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Case trend</CardTitle>
              <CardDescription>Cases, prescriptions and distinct patients per day</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="cases" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="rx" stroke="hsl(var(--accent))" fill="hsl(var(--accent))" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="patients" stroke="hsl(var(--muted-foreground))" fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <TopCard title="Most common cases / diagnoses" description="Click any row to drill down" data={buckets(rows, "diagnosis")} onPick={(n) => drill("diagnosis", n)} />
            <TopCard title="Most common symptoms" description="Click a symptom for its full analysis" data={buckets(rows, "symptom")} onPick={(n) => drill("symptom", n)} />
            <TopCard title="Most prescribed medicines (historical)" description="From existing prescription records only" data={buckets(rows, "medicine")} onPick={(n) => drill("medicine", n)} />
            <TopCard title="Most common species" data={buckets(rows, "species")} onPick={(n) => drill("species", n)} />
            <TopCard title="Most common breeds" data={buckets(rows, "breed")} onPick={(n) => drill("breed", n)} />
            <TopCard title="Investigations ordered" data={buckets(rows, "test")} onPick={(n) => drill("test", n)} />
            <TopCard title="Weight groups" data={buckets(rows, "weight")} onPick={(n) => drill("weight", n)} />
            <TopCard title="Age groups" data={buckets(rows, "age")} onPick={(n) => drill("age", n)} />
            <TopCard title="Doctor case load" data={buckets(rows, "doctor")} onPick={(n) => drill("doctor", n)} />
            <TopCard title="Surgery types" data={buckets(rows, "surgery")} onPick={(n) => drill("surgery", n)} />
            <TopCard
              title="Highest repeat case types"
              description="Diagnoses that returned for the same patient"
              data={repeatBuckets(rows, "diagnosis")}
              unitLabel="patients"
              onPick={(n) => drill("diagnosis", n)}
            />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Increasing / decreasing cases</CardTitle>
                <CardDescription>Second half of the range vs the first half</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {rising.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">Not enough history in this range.</p>
                ) : (
                  <div className="divide-y">
                    {rising.map((r) => (
                      <button
                        key={r.name}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted/60"
                        onClick={() => drill("diagnosis", r.name)}
                      >
                        <span className="flex-1 truncate">{r.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{r.previous} → {r.recent}</span>
                        <Badge variant={r.delta > 0 ? "default" : "secondary"} className="tabular-nums">
                          {r.delta > 0 ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
                          {r.delta > 0 ? `+${r.delta}` : r.delta}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" /> Patients in this selection</CardTitle>
              <CardDescription>Open a full patient record from the drill-down panel</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">No clinical records match these filters.</p>
              ) : (
                <button
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted/60"
                  onClick={() => setCrumbs([])}
                >
                  <Activity className="h-4 w-4 text-primary" />
                  <span className="flex-1">{uniquePatients(rows)} patients across {rows.length} cases</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
              <div className="divide-y border-t">
                {rows.slice(0, 25).map((r) => (
                  <button
                    key={r.id}
                    className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted/60"
                    onClick={() => setPetId(r.petId)}
                  >
                    <span className="text-xs tabular-nums text-muted-foreground">{r.dateKey}</span>
                    <span className="font-medium">{r.petName}</span>
                    <span className="text-xs text-muted-foreground">{r.ownerName}</span>
                    <Badge variant="outline" className="text-[10px]">{r.species}</Badge>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {[r.diagnoses.join(" · "), r.symptoms.join(" · ")].filter(Boolean).join(" — ") || "No coded findings"}
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <CaseDrillDown rows={rows} crumbs={crumbs} setCrumbs={setCrumbs} onOpenPatient={setPetId} />
      <PetHistorySheet petId={petId} onClose={() => setPetId(null)} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" /> {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function TopCard({
  title,
  description,
  data,
  onPick,
  unitLabel = "cases",
}: {
  title: string;
  description?: string;
  data: Bucket[];
  onPick: (name: string) => void;
  unitLabel?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-0">
        {data.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No data in this selection.</p>
        ) : (
          <div className="divide-y">
            {data.map((b) => (
              <button
                key={b.name}
                className="w-full px-4 py-2 text-left hover:bg-muted/60"
                onClick={() => onPick(b.name)}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{b.name}</span>
                  <span className="tabular-nums font-medium">
                    {unitLabel === "patients" ? b.patients : b.count}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="mt-1 h-1 w-full rounded bg-muted">
                  <div className="h-1 rounded bg-primary" style={{ width: `${(b.count / max) * 100}%` }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
