import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";

export type MasterTable = "symptoms" | "diagnoses" | "medical_tests" | "advice_templates";

/** The text column differs per master table. */
export const LABEL_FIELD: Record<MasterTable, "name" | "text"> = {
  symptoms: "name",
  diagnoses: "name",
  medical_tests: "name",
  advice_templates: "text",
};

export type MasterItem = {
  id: string;
  label: string;
  is_common: boolean;
  tags?: string[];
};

export function useMasterList(table: MasterTable) {
  const field = LABEL_FIELD[table];
  return useQuery({
    queryKey: ["clinical-master", table],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MasterItem[]> => {
      const cols = table === "advice_templates" ? `id,${field},is_common,tags` : `id,${field},is_common`;
      const { data, error } = await supabase
        .from(table)
        .select(cols)
        .eq("is_active", true)
        .order(field, { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id as string,
        label: String(r[field] ?? ""),
        is_common: !!r.is_common,
        tags: (r.tags as string[] | undefined) ?? [],
      }));
    },
  });
}

/**
 * Add a master row, or return the existing row when the same text already
 * exists (case-insensitive) so quick-add never creates duplicates.
 */
export async function quickAddMaster(
  table: MasterTable,
  label: string,
  extra?: { tags?: string[] },
): Promise<MasterItem> {
  const field = LABEL_FIELD[table];
  const value = label.trim();
  if (!value) throw new Error("Please type something first");

  const { data: existing } = await supabase
    .from(table)
    .select(`id,${field}`)
    .ilike(field, value)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { id: (existing as any).id, label: String((existing as any)[field]), is_common: false };
  }

  const payload: any = { [field]: value };
  if (table === "advice_templates" && extra?.tags?.length) payload.tags = extra.tags;
  const { data, error } = await supabase.from(table).insert(payload).select(`id,${field}`).single();
  if (error) throw error;
  return { id: (data as any).id, label: String((data as any)[field]), is_common: false };
}

export function useInvalidateMaster() {
  const qc = useQueryClient();
  return (table: MasterTable) => qc.invalidateQueries({ queryKey: ["clinical-master", table] });
}

/* -------------------- Medicines (inventory driven) -------------------- */

export type Medicine = {
  id: string;
  name: string;
  unit: string | null;
  dose_form: string | null;
  dose_unit: string | null;
  stock_quantity: number;
};

export const DOSE_FORMS = [
  "tablet",
  "capsule",
  "syrup",
  "liquid",
  "injection",
  "drops",
  "ointment",
  "sachet",
  "spray",
] as const;

export const UNIT_BY_FORM: Record<string, string> = {
  tablet: "tablet",
  capsule: "capsule",
  syrup: "ml",
  liquid: "ml",
  injection: "ml",
  drops: "drop",
  ointment: "application",
  sachet: "sachet",
  spray: "spray",
};

/** Keyword → dose form, checked against the product name (most specific first). */
const FORM_KEYWORDS: [RegExp, string][] = [
  [/\b(inj|injection|vial|ampoule|amp)\b|\binj\./i, "injection"],
  [/\b(syrup|syp|susp|suspension|oral\s*sol|elixir)\b/i, "syrup"],
  [/\b(drop|drops|eye\s*drop|ear\s*drop)\b/i, "drops"],
  [/\b(oint|ointment|cream|gel|lotion|shampoo)\b/i, "ointment"],
  [/\b(sachet|powder|pwd|sac)\b/i, "sachet"],
  [/\b(spray)\b/i, "spray"],
  [/\b(cap|caps|capsule)\b/i, "capsule"],
  [/\b(tab|tabs|tablet|bolus|vet\s*bolus)\b/i, "tablet"],
];

/** Guess the dose form from a medicine name, e.g. "Cef 3 Vet Inj" → injection. */
export function inferDoseForm(name?: string | null): string | null {
  const n = String(name ?? "");
  if (!n.trim()) return null;
  for (const [re, form] of FORM_KEYWORDS) if (re.test(n)) return form;
  return null;
}

/**
 * The dose form we actually use. The product name is the strongest signal
 * (inventory rows were all saved with the default "tablet"), then the stored
 * dose form.
 */
export function resolveDoseForm(m: { name?: string | null; dose_form?: string | null }): string | null {
  return inferDoseForm(m.name) ?? (m.dose_form?.trim() || null);
}

export const unitForForm = (form?: string | null) => (form && UNIT_BY_FORM[form]) || "dose";

export function doseUnitFor(m: { name?: string | null; dose_unit?: string | null; dose_form?: string | null }): string {
  const form = resolveDoseForm(m);
  if (form) return unitForForm(form);
  if (m.dose_unit?.trim()) return m.dose_unit.trim();
  return "dose";
}

/** Liquid-style forms are dosed in ml, so the unit is printed after every slot. */
export function isLiquidForm(form?: string | null) {
  return !!form && ["syrup", "liquid", "injection", "drops"].includes(form);
}

/** Only prescribable medicine products — never food, litter, accessories or toys. */
export function useMedicines() {
  return useQuery({
    queryKey: ["medicines", "prescribable"],
    staleTime: 60_000,
    queryFn: async (): Promise<Medicine[]> => {
      return fetchAll<Medicine>(() => supabase
        .from("products")
        .select("id,name,unit,dose_form,dose_unit,stock_quantity")
        .eq("is_active", true)
        .eq("is_prescribable", true)
        .order("name", { ascending: true })
        .order("id"));
    },
  });
}

export const INSTRUCTIONS = [
  "After Food",
  "Before Food",
  "With Food",
  "Empty Stomach",
  "At Bedtime",
  "Apply Locally",
  "As Directed",
] as const;
