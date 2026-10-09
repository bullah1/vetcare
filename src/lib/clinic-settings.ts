// Clinic identity + invoice defaults, persisted in localStorage so every
// printed document (A4 invoice, thermal receipt, prescription, labels) can
// share one editable source of truth (Settings page).

export type ClinicInfo = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  license: string;
  labelName: string; // short name printed on 38×25mm barcode labels
  currency: string; // symbol used in printed docs
  defaultTaxPercent: number;
  invoicePrefix: string;
  invoiceFooter: string;
};

export const DEFAULT_CLINIC: ClinicInfo = {
  name: "Pet Care Vet Clinic",
  tagline: "Compassionate care for every companion",
  address: "House 12, Road 4, Dhanmondi, Dhaka 1205",
  phone: "+880 1700-000000",
  email: "hello@petcarevet.com",
  website: "www.petcarevet.com",
  license: "DVM-BD-2024-00123",
  labelName: "Pet Care Vet",
  currency: "৳",
  defaultTaxPercent: 0,
  invoicePrefix: "INV",
  invoiceFooter: "Get well soon 🐾",
};

const KEY = "clinic.settings.v1";
const DB_KEY = "clinic";

/** Synchronous read (localStorage cache) — used by every print template. */
export function getClinic(): ClinicInfo {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (!raw) return { ...DEFAULT_CLINIC };
    return { ...DEFAULT_CLINIC, ...(JSON.parse(raw) as Partial<ClinicInfo>) };
  } catch {
    return { ...DEFAULT_CLINIC };
  }
}

function writeCache(c: ClinicInfo | null) {
  try {
    if (c) window.localStorage.setItem(KEY, JSON.stringify(c));
    else window.localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent("clinic-settings-changed"));
  } catch {
    /* ignore */
  }
}

/**
 * Settings live in the shared `app_settings` table so they stay identical on
 * every device/browser; localStorage is only a fast offline cache. Without this
 * the profile appeared to "reset" whenever the cache was cleared or another
 * device was used.
 */
export async function syncClinicFromServer(): Promise<ClinicInfo> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", DB_KEY)
      .maybeSingle();
    if (error) return getClinic();
    if (!data?.value) {
      // First run: publish whatever this device already has so the clinic keeps it.
      const local = getClinic();
      const hasLocal = typeof window !== "undefined" && !!window.localStorage.getItem(KEY);
      if (hasLocal) void saveClinic(local);
      return local;
    }
    const merged = { ...DEFAULT_CLINIC, ...(data.value as Partial<ClinicInfo>) };
    writeCache(merged);
    return merged;
  } catch {
    return getClinic();
  }
}

export async function saveClinic(c: ClinicInfo): Promise<{ ok: boolean; error?: string }> {
  writeCache(c);
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: DB_KEY, value: c as unknown as never, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save to server" };
  }
}

export async function resetClinic(): Promise<void> {
  writeCache(null);
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.from("app_settings").delete().eq("key", DB_KEY);
  } catch {
    /* ignore */
  }
}
