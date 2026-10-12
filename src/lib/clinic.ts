// Clinic: problems, services (with the stock items they use) and doctors.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// New tables are not in the generated Supabase types yet.
const db = supabase as any;

export type ServiceCategory = "consultation" | "vaccination" | "procedure" | "surgery" | "grooming" | "other";
export const SERVICE_CATEGORIES: { value: ServiceCategory; label: string }[] = [
  { value: "consultation", label: "Consultation" },
  { value: "vaccination", label: "Vaccination" },
  { value: "procedure", label: "Procedure" },
  { value: "surgery", label: "Surgery / OT" },
  { value: "grooming", label: "Grooming" },
  { value: "other", label: "Other" },
];
export const categoryLabel = (c: string | null | undefined) => SERVICE_CATEGORIES.find((x) => x.value === c)?.label ?? "Other";

export type ServiceMaterial = { id?: string; product_id: string; quantity: number; product?: { name: string; purchase_price: number; unit: string | null } | null };
export type ClinicService = {
  id: string;
  name: string;
  category: ServiceCategory;
  price: number;
  direct_cost: number;
  doctor_fee_type: "fixed" | "percent";
  doctor_fee_value: number;
  is_active: boolean;
  materials: ServiceMaterial[];
};
export type ClinicProblem = { id: string; name: string; is_active: boolean };
export type Doctor = { id: string; full_name: string; consultation_fee: number | null; is_active: boolean; specialization?: string | null; phone?: string | null };

/** Cost of one service: direct cost + stock items it uses (at current purchase price). */
export const serviceCost = (s: ClinicService) =>
  Number(s.direct_cost || 0) + s.materials.reduce((a, m) => a + Number(m.quantity) * Number(m.product?.purchase_price || 0), 0);

/** Doctor's share for one service line. */
export const doctorFeeFor = (s: Pick<ClinicService, "doctor_fee_type" | "doctor_fee_value">, lineTotal: number, qty: number) =>
  s.doctor_fee_type === "percent" ? (lineTotal * Number(s.doctor_fee_value || 0)) / 100 : Number(s.doctor_fee_value || 0) * qty;

export async function fetchServices(): Promise<ClinicService[]> {
  const { data, error } = await db
    .from("clinic_services")
    .select("*, materials:clinic_service_materials(id,product_id,quantity, product:products(name,purchase_price,unit))")
    .order("category")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((s: any) => ({ ...s, price: Number(s.price), direct_cost: Number(s.direct_cost), doctor_fee_value: Number(s.doctor_fee_value), materials: s.materials ?? [] }));
}

export async function fetchProblems(): Promise<ClinicProblem[]> {
  const { data, error } = await db.from("clinic_problems").select("id,name,is_active").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchDoctors(includeInactive = false): Promise<Doctor[]> {
  let q = supabase.from("doctors").select("id,full_name,consultation_fee,is_active,specialization,phone").order("full_name");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Doctor[];
}

export const useServices = () => useQuery({ queryKey: ["clinic-services"], queryFn: fetchServices, staleTime: 60_000 });
export const useProblems = () => useQuery({ queryKey: ["clinic-problems"], queryFn: fetchProblems, staleTime: 60_000 });
export const useDoctors = (includeInactive = false) =>
  useQuery({ queryKey: ["doctors", includeInactive ? "all" : "active"], queryFn: () => fetchDoctors(includeInactive), staleTime: 60_000 });

export async function addProblem(name: string): Promise<ClinicProblem> {
  const n = name.trim();
  if (!n) throw new Error("Write the problem name");
  const { data, error } = await db.from("clinic_problems").insert({ name: n }).select("id,name,is_active").single();
  if (error) throw new Error(error.code === "23505" ? "This problem is already in the list" : error.message);
  return data;
}

export type BillLine = {
  key: string;
  kind: "consultation" | "service" | "product";
  service_id?: string;
  product_id?: string;
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  /** Shown only: stock left for products. */
  stock?: number;
};

export async function createClinicBill(input: {
  appointmentId: string | null;
  ownerId: string | null;
  doctorId: string | null;
  lines: BillLine[];
  payments: { method: string; amount: number }[];
  discount: number;
  notes?: string | null;
}) {
  const { data, error } = await db.rpc("create_clinic_bill", {
    _appointment_id: input.appointmentId,
    _owner_id: input.ownerId,
    _doctor_id: input.doctorId,
    _lines: input.lines.map((l) => ({
      kind: l.kind,
      service_id: l.service_id ?? null,
      product_id: l.product_id ?? null,
      name: l.name,
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount: l.discount,
    })),
    _payments: input.payments.filter((p) => p.amount > 0 && p.method !== "due").map((p) => ({ method: p.method, amount: p.amount, reference: null })),
    _discount: input.discount,
    _notes: input.notes?.trim() || null,
  });
  if (error) throw error;
  return data as { sale_id: string; invoice_no: string; total: number; paid: number; due: number };
}

/** Appointment status as staff see it. */
export const APPT_STATUS: { value: string; label: string; tone: string }[] = [
  { value: "pending", label: "Booked", tone: "border-sky-300 bg-sky-50 text-sky-800" },
  { value: "in_progress", label: "Arrived", tone: "border-amber-300 bg-amber-50 text-amber-800" },
  { value: "completed", label: "Completed", tone: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  { value: "cancelled", label: "Cancelled", tone: "border-destructive/40 bg-destructive/10 text-destructive" },
  { value: "no_show", label: "No-show", tone: "border-slate-300 bg-slate-100 text-slate-700" },
];
export const apptStatus = (s: string) => APPT_STATUS.find((x) => x.value === (s === "confirmed" ? "pending" : s)) ?? APPT_STATUS[0];
