/**
 * Clinical Intelligence — pure analytics helpers.
 *
 * Everything here is derived from existing clinical records
 * (clinical_visits, medical_records, prescriptions + items, surgeries).
 * No shop / POS / inventory data, no medical recommendations: counts only.
 */
import { dhakaDayKey } from "@/lib/sales-summary";
import { speciesLabel } from "@/lib/clinic-analytics";

export type CaseRow = {
  /** visit id (clinical_visits) or `mr:<id>` for a legacy medical record */
  id: string;
  source: "visit" | "record";
  visitId: string | null;
  dateKey: string;
  visitDate: string;
  petId: string;
  petName: string;
  ownerName: string;
  ownerPhone: string | null;
  species: string;
  breed: string;
  gender: string;
  ageMonths: number | null;
  weightKg: number | null;
  doctorId: string | null;
  doctorName: string;
  symptoms: string[];
  diagnoses: string[];
  tests: string[];
  medicines: string[];
  prescriptionCount: number;
  surgeryTypes: string[];
  followUpDate: string | null;
};

/* ------------------------------- groupings ------------------------------- */

export const AGE_GROUPS = ["0–6 m", "6–12 m", "1–3 y", "3–7 y", "7+ y"] as const;

export function ageMonthsFrom(dob?: string | null, at?: string): number | null {
  if (!dob) return null;
  const born = new Date(dob).getTime();
  const ref = at ? new Date(at).getTime() : Date.now();
  if (!Number.isFinite(born) || ref < born) return null;
  return Math.floor((ref - born) / (1000 * 60 * 60 * 24 * 30.44));
}

export function ageGroup(months: number | null): string {
  if (months == null) return "Unknown";
  if (months < 6) return "0–6 m";
  if (months < 12) return "6–12 m";
  if (months < 36) return "1–3 y";
  if (months < 84) return "3–7 y";
  return "7+ y";
}

export const WEIGHT_GROUPS = ["0–2 kg", "2–4 kg", "4–8 kg", "8–15 kg", "15–30 kg", "30+ kg"] as const;

export function weightGroup(kg: number | null): string {
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return "Unknown";
  if (kg < 2) return "0–2 kg";
  if (kg < 4) return "2–4 kg";
  if (kg < 8) return "4–8 kg";
  if (kg < 15) return "8–15 kg";
  if (kg < 30) return "15–30 kg";
  return "30+ kg";
}

/* --------------------------------- build --------------------------------- */

const clean = (v: unknown) => String(v ?? "").trim();
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[,;\n]+/))
    .map((x) => clean(x))
    .filter(Boolean);

export type RawVisit = {
  id: string;
  visit_date: string;
  pet_id: string;
  doctor_id: string | null;
  symptoms: string[] | null;
  diagnoses: string[] | null;
  tests: string[] | null;
  weight_kg: number | string | null;
  follow_up_date: string | null;
};
export type RawRecord = {
  id: string;
  visit_date: string;
  pet_id: string;
  doctor_id: string | null;
  symptoms: string | null;
  diagnosis: string | null;
  weight_kg: number | string | null;
};
export type RawPet = {
  id: string;
  name: string;
  species: string | null;
  breed: string | null;
  gender?: string | null;
  date_of_birth: string | null;
  weight_kg: number | string | null;
  owner?: { full_name: string | null; phone: string | null } | null;
};
export type RawRx = {
  id: string;
  issued_at: string;
  pet_id: string;
  visit_id: string | null;
  doctor_id: string | null;
  prescription_items: { medicine_name: string | null }[] | null;
};
export type RawSurgery = { id: string; visit_id: string | null; pet_id: string; surgery_type: string | null };

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export function buildCases(args: {
  visits: RawVisit[];
  records: RawRecord[];
  pets: RawPet[];
  prescriptions: RawRx[];
  surgeries: RawSurgery[];
  doctors: { id: string; full_name: string }[];
}): CaseRow[] {
  const petById = new Map(args.pets.map((p) => [p.id, p]));
  const docById = new Map(args.doctors.map((d) => [d.id, d.full_name]));

  const rxByVisit = new Map<string, RawRx[]>();
  const rxByPetDay = new Map<string, RawRx[]>();
  for (const rx of args.prescriptions) {
    if (rx.visit_id) rxByVisit.set(rx.visit_id, [...(rxByVisit.get(rx.visit_id) ?? []), rx]);
    const key = `${rx.pet_id}|${dhakaDayKey(rx.issued_at)}`;
    rxByPetDay.set(key, [...(rxByPetDay.get(key) ?? []), rx]);
  }
  const surgByVisit = new Map<string, string[]>();
  const surgByPet = new Map<string, string[]>();
  for (const s of args.surgeries) {
    const type = clean(s.surgery_type) || "Surgery";
    if (s.visit_id) surgByVisit.set(s.visit_id, [...(surgByVisit.get(s.visit_id) ?? []), type]);
    surgByPet.set(s.pet_id, [...(surgByPet.get(s.pet_id) ?? []), type]);
  }

  const medsOf = (rows: RawRx[]) =>
    Array.from(new Set(rows.flatMap((r) => (r.prescription_items ?? []).map((i) => clean(i.medicine_name))).filter(Boolean)));

  const rows: CaseRow[] = [];

  for (const v of args.visits) {
    const pet = petById.get(v.pet_id);
    const rxRows = rxByVisit.get(v.id) ?? rxByPetDay.get(`${v.pet_id}|${dhakaDayKey(v.visit_date)}`) ?? [];
    rows.push({
      id: v.id,
      source: "visit",
      visitId: v.id,
      dateKey: dhakaDayKey(v.visit_date),
      visitDate: v.visit_date,
      petId: v.pet_id,
      petName: pet?.name ?? "Unknown pet",
      ownerName: pet?.owner?.full_name ?? "—",
      ownerPhone: pet?.owner?.phone ?? null,
      species: speciesLabel(pet?.species),
      breed: clean(pet?.breed) || "Unknown",
      gender: clean(pet?.gender) || "Unknown",
      ageMonths: ageMonthsFrom(pet?.date_of_birth, v.visit_date),
      weightKg: num(v.weight_kg) ?? num(pet?.weight_kg),
      doctorId: v.doctor_id,
      doctorName: (v.doctor_id && docById.get(v.doctor_id)) || "Unassigned",
      symptoms: list(v.symptoms),
      diagnoses: list(v.diagnoses),
      tests: list(v.tests),
      medicines: medsOf(rxRows),
      prescriptionCount: rxRows.length,
      surgeryTypes: surgByVisit.get(v.id) ?? [],
      followUpDate: v.follow_up_date,
    });
  }

  // Legacy medical records that are not already covered by a clinical visit
  const visitKeys = new Set(rows.map((r) => `${r.petId}|${r.dateKey}`));
  for (const m of args.records) {
    const key = `${m.pet_id}|${dhakaDayKey(m.visit_date)}`;
    if (visitKeys.has(key)) continue;
    const pet = petById.get(m.pet_id);
    const rxRows = rxByPetDay.get(key) ?? [];
    rows.push({
      id: `mr:${m.id}`,
      source: "record",
      visitId: null,
      dateKey: dhakaDayKey(m.visit_date),
      visitDate: m.visit_date,
      petId: m.pet_id,
      petName: pet?.name ?? "Unknown pet",
      ownerName: pet?.owner?.full_name ?? "—",
      ownerPhone: pet?.owner?.phone ?? null,
      species: speciesLabel(pet?.species),
      breed: clean(pet?.breed) || "Unknown",
      gender: clean(pet?.gender) || "Unknown",
      ageMonths: ageMonthsFrom(pet?.date_of_birth, m.visit_date),
      weightKg: num(m.weight_kg) ?? num(pet?.weight_kg),
      doctorId: m.doctor_id,
      doctorName: (m.doctor_id && docById.get(m.doctor_id)) || "Unassigned",
      symptoms: list(m.symptoms),
      diagnoses: list(m.diagnosis),
      tests: [],
      medicines: medsOf(rxRows),
      prescriptionCount: rxRows.length,
      surgeryTypes: [],
      followUpDate: null,
    });
  }

  return rows.sort((a, b) => (a.visitDate < b.visitDate ? 1 : -1));
}

/* -------------------------------- filtering ------------------------------- */

export type Dimension =
  | "diagnosis"
  | "symptom"
  | "medicine"
  | "species"
  | "breed"
  | "gender"
  | "age"
  | "weight"
  | "doctor"
  | "test"
  | "surgery"
  | "patient";

export const DIMENSION_LABELS: Record<Dimension, string> = {
  diagnosis: "Diagnosis",
  symptom: "Symptom",
  medicine: "Medicine",
  species: "Species",
  breed: "Breed",
  gender: "Gender",
  age: "Age group",
  weight: "Weight group",
  doctor: "Doctor",
  test: "Investigation",
  surgery: "Surgery type",
  patient: "Patient",
};

export type Crumb = { dim: Dimension; value: string };

export function valuesFor(row: CaseRow, dim: Dimension): string[] {
  switch (dim) {
    case "diagnosis":
      return row.diagnoses;
    case "symptom":
      return row.symptoms;
    case "medicine":
      return row.medicines;
    case "test":
      return row.tests;
    case "surgery":
      return row.surgeryTypes;
    case "species":
      return [row.species];
    case "breed":
      return [row.breed];
    case "gender":
      return [row.gender];
    case "age":
      return [ageGroup(row.ageMonths)];
    case "weight":
      return [weightGroup(row.weightKg)];
    case "doctor":
      return [row.doctorName];
    case "patient":
      return [row.petId];
  }
}

export const matches = (row: CaseRow, dim: Dimension, value: string) =>
  valuesFor(row, dim).some((v) => v.toLowerCase() === value.toLowerCase());

export function applyCrumbs(rows: CaseRow[], crumbs: Crumb[]): CaseRow[] {
  return crumbs.reduce((acc, c) => acc.filter((r) => matches(r, c.dim, c.value)), rows);
}

export type Filters = {
  from: string;
  to: string;
  species: string;
  breed: string;
  gender: string;
  age: string;
  weight: string;
  doctorId: string;
  diagnosis: string;
  symptom: string;
  medicine: string;
  search: string;
};

export const emptyFilters = (from: string, to: string): Filters => ({
  from,
  to,
  species: "all",
  breed: "all",
  gender: "all",
  age: "all",
  weight: "all",
  doctorId: "all",
  diagnosis: "all",
  symptom: "all",
  medicine: "all",
  search: "",
});

export function applyFilters(rows: CaseRow[], f: Filters): CaseRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (r.dateKey < f.from || r.dateKey > f.to) return false;
    if (f.species !== "all" && r.species !== f.species) return false;
    if (f.breed !== "all" && r.breed !== f.breed) return false;
    if (f.gender !== "all" && r.gender !== f.gender) return false;
    if (f.age !== "all" && ageGroup(r.ageMonths) !== f.age) return false;
    if (f.weight !== "all" && weightGroup(r.weightKg) !== f.weight) return false;
    if (f.doctorId !== "all" && r.doctorId !== f.doctorId) return false;
    if (f.diagnosis !== "all" && !matches(r, "diagnosis", f.diagnosis)) return false;
    if (f.symptom !== "all" && !matches(r, "symptom", f.symptom)) return false;
    if (f.medicine !== "all" && !matches(r, "medicine", f.medicine)) return false;
    if (q) {
      const hay = [r.petName, r.ownerName, r.ownerPhone, r.doctorName, ...r.diagnoses, ...r.symptoms, ...r.medicines]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* -------------------------------- counting -------------------------------- */

export type Bucket = { name: string; count: number; patients: number };

/** Case counts per value of a dimension (a case counts once per distinct value). */
export function buckets(rows: CaseRow[], dim: Dimension, limit = 12): Bucket[] {
  const cases = new Map<string, number>();
  const pets = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const raw of new Set(valuesFor(r, dim))) {
      const name = dim === "patient" ? r.petName : raw;
      if (!name) continue;
      cases.set(name, (cases.get(name) ?? 0) + 1);
      const set = pets.get(name) ?? new Set<string>();
      set.add(r.petId);
      pets.set(name, set);
    }
  }
  return Array.from(cases, ([name, count]) => ({ name, count, patients: pets.get(name)?.size ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export const uniqueValues = (rows: CaseRow[], dim: Dimension) =>
  Array.from(new Set(rows.flatMap((r) => valuesFor(r, dim)).filter(Boolean))).sort((a, b) => a.localeCompare(b));

/** Repeat-case types: values seen more than once for the same patient. */
export function repeatBuckets(rows: CaseRow[], dim: Dimension, limit = 8): Bucket[] {
  const perValuePet = new Map<string, Map<string, number>>();
  for (const r of rows) {
    for (const v of new Set(valuesFor(r, dim))) {
      const m = perValuePet.get(v) ?? new Map<string, number>();
      m.set(r.petId, (m.get(r.petId) ?? 0) + 1);
      perValuePet.set(v, m);
    }
  }
  return Array.from(perValuePet, ([name, m]) => {
    const repeatPets = Array.from(m.values()).filter((n) => n > 1);
    return { name, count: repeatPets.reduce((s, n) => s + n, 0), patients: repeatPets.length };
  })
    .filter((b) => b.patients > 0)
    .sort((a, b) => b.patients - a.patients || b.count - a.count)
    .slice(0, limit);
}

/** Trend of case counts per day key. */
export function trendSeries(rows: CaseRow[], dayKeys: string[]) {
  const byDay = new Map<string, { cases: number; rx: number; patients: Set<string> }>();
  for (const r of rows) {
    const cur = byDay.get(r.dateKey) ?? { cases: 0, rx: 0, patients: new Set<string>() };
    cur.cases += 1;
    cur.rx += r.prescriptionCount;
    cur.patients.add(r.petId);
    byDay.set(r.dateKey, cur);
  }
  return dayKeys.map((d) => {
    const v = byDay.get(d);
    return { day: d.slice(5), cases: v?.cases ?? 0, rx: v?.rx ?? 0, patients: v?.patients.size ?? 0 };
  });
}

/** Rising / falling case types: second half of the range vs the first half. */
export type TrendRow = { name: string; recent: number; previous: number; delta: number };

export function movement(rows: CaseRow[], dim: Dimension, from: string, to: string, limit = 6): TrendRow[] {
  const sorted = [...rows].sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  if (sorted.length === 0) return [];
  const keys = Array.from(new Set(sorted.map((r) => r.dateKey)));
  const mid = keys[Math.floor(keys.length / 2)] ?? to;
  const first = sorted.filter((r) => r.dateKey < mid);
  const second = sorted.filter((r) => r.dateKey >= mid);
  const countOf = (list: CaseRow[]) => {
    const m = new Map<string, number>();
    for (const r of list) for (const v of new Set(valuesFor(r, dim))) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const a = countOf(first);
  const b = countOf(second);
  const names = new Set([...a.keys(), ...b.keys()]);
  return Array.from(names, (name) => {
    const previous = a.get(name) ?? 0;
    const recent = b.get(name) ?? 0;
    return { name, recent, previous, delta: recent - previous };
  })
    .filter((r) => r.delta !== 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, limit);
}

export const uniquePatients = (rows: CaseRow[]) => new Set(rows.map((r) => r.petId)).size;

export function repeatPatientCount(rows: CaseRow[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.petId, (m.get(r.petId) ?? 0) + 1);
  return Array.from(m.values()).filter((n) => n > 1).length;
}

export type PatientSummary = {
  petId: string;
  petName: string;
  ownerName: string;
  ownerPhone: string | null;
  species: string;
  breed: string;
  ageMonths: number | null;
  weightKg: number | null;
  cases: number;
  lastVisit: string;
  diagnoses: string[];
};

export function patientSummaries(rows: CaseRow[], limit = 200): PatientSummary[] {
  const m = new Map<string, PatientSummary>();
  for (const r of rows) {
    const cur = m.get(r.petId);
    if (cur) {
      cur.cases += 1;
      if (r.visitDate > cur.lastVisit) cur.lastVisit = r.visitDate;
      cur.diagnoses = Array.from(new Set([...cur.diagnoses, ...r.diagnoses]));
    } else {
      m.set(r.petId, {
        petId: r.petId,
        petName: r.petName,
        ownerName: r.ownerName,
        ownerPhone: r.ownerPhone,
        species: r.species,
        breed: r.breed,
        ageMonths: r.ageMonths,
        weightKg: r.weightKg,
        cases: 1,
        lastVisit: r.visitDate,
        diagnoses: [...r.diagnoses],
      });
    }
  }
  return Array.from(m.values())
    .sort((a, b) => b.cases - a.cases || (a.lastVisit < b.lastVisit ? 1 : -1))
    .slice(0, limit);
}

export const ageLabel = (months: number | null) =>
  months == null ? "—" : months < 24 ? `${months} mo` : `${Math.floor(months / 12)} y`;
