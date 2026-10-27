// Two projects in one app (one cash drawer, separate invoices and accounts):
//   pcv = Pet Care Vet (pet shop + clinic) — invoices INV-…
//   ss  = Sasthya Seba (human medicine)    — invoices SS-…
// The Sasthya Seba receipt header (name, address, licence…) is kept in the shared
// app_settings table (key "project_ss") so every device prints the same.
import { getClinic, type ClinicInfo } from "@/lib/clinic-settings";

export type Project = "pcv" | "ss";
export const PROJECTS: { key: Project; label: string; short: string; tone: string }[] = [
  { key: "pcv", label: "Pet Care Vet", short: "PCV", tone: "#f55504" },
  { key: "ss", label: "Sasthya Seba", short: "SS", tone: "#0e9f6e" },
];
export const projectLabel = (p?: string | null) => PROJECTS.find((x) => x.key === p)?.label ?? "Pet Care Vet";
export const asProject = (p?: string | null): Project => (p === "ss" ? "ss" : "pcv");

/** Fields of the Sasthya Seba receipt header. Empty fields fall back to the clinic profile. */
export type ProjectBrand = Pick<ClinicInfo, "name" | "tagline" | "address" | "phone" | "email" | "website" | "license" | "invoiceFooter">;

export const DEFAULT_SS_BRAND: ProjectBrand = {
  name: "Sasthya Seba",
  tagline: "Pharmacy & Healthcare",
  address: "",
  phone: "",
  email: "",
  website: "",
  license: "",
  invoiceFooter: "Get well soon",
};

const KEY = "project.ss.brand.v1";
const DB_KEY = "project_ss";

export function getSsBrand(): ProjectBrand {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    return raw ? { ...DEFAULT_SS_BRAND, ...(JSON.parse(raw) as Partial<ProjectBrand>) } : { ...DEFAULT_SS_BRAND };
  } catch {
    return { ...DEFAULT_SS_BRAND };
  }
}

function writeCache(b: ProjectBrand | null) {
  try {
    if (b) window.localStorage.setItem(KEY, JSON.stringify(b));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function syncSsBrandFromServer(): Promise<ProjectBrand> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", DB_KEY).maybeSingle();
    if (error || !data?.value) return getSsBrand();
    const merged = { ...DEFAULT_SS_BRAND, ...(data.value as Partial<ProjectBrand>) };
    writeCache(merged);
    return merged;
  } catch {
    return getSsBrand();
  }
}

export async function saveSsBrand(b: ProjectBrand): Promise<{ ok: boolean; error?: string }> {
  writeCache(b);
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: DB_KEY, value: b as unknown as never, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save to server" };
  }
}

/** Header used on a printed bill of this project. */
export function brandFor(project?: string | null): ClinicInfo {
  const clinic = getClinic();
  if (asProject(project) !== "ss") return clinic;
  const ss = getSsBrand();
  const pick = (k: keyof ProjectBrand) => (ss[k]?.trim() ? ss[k] : "");
  return {
    ...clinic,
    name: pick("name") || "Sasthya Seba",
    tagline: pick("tagline"),
    // Same shop by default: address / phone fall back to the clinic profile.
    address: pick("address") || clinic.address,
    phone: pick("phone") || clinic.phone,
    email: pick("email"),
    website: pick("website"),
    license: pick("license"),
    labelName: pick("name") || "Sasthya Seba",
    invoiceFooter: pick("invoiceFooter"),
  };
}

/** Label printed before the licence number. */
export const licenseLabel = (project?: string | null) => (asProject(project) === "ss" ? "Drug License" : "Clinic License");
