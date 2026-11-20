import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * TEMPORARY one-time tool: copies every table and storage file from the current
 * (Lovable Cloud) database to the new Supabase project. Reads use the signed-in
 * admin's session on the old database; writes go through a temporary function on
 * the new database. Re-running is safe (existing rows are skipped).
 * Remove this file and the /data-move page after the move.
 */

type Ctx = { supabase: any; userId: string };

/** Primary key per table (default "id"). */
const PK: Record<string, string> = {
  app_settings: "key",
  visit_advice: "visit_id,advice_id",
  visit_diagnoses: "visit_id,diagnosis_id",
  visit_symptoms: "visit_id,symptom_id",
  visit_tests: "visit_id,test_id",
};

export const DATA_MOVE_TABLES = [
  "advice_templates", "app_settings", "appointments", "cash_close_reports", "cash_movements", "cash_shifts",
  "clinic_problems", "clinic_service_materials", "clinic_services", "clinical_visits", "courier_orders",
  "deliveries", "delivery_men", "delivery_status_history", "diagnoses", "doctors", "expense_cancellations",
  "expenses", "held_bills", "hr_attendance", "hr_employees", "hr_salary_items", "hr_salary_payments",
  "medical_records", "medical_tests", "payments", "pet_owners", "pets", "prescription_items", "prescriptions",
  "price_override_log", "product_categories", "product_cost_history", "products", "profiles",
  "purchase_invoice_items", "purchase_invoices", "purchase_return_items", "purchase_returns", "sale_items",
  "sale_return_items", "sale_returns", "sales", "stock_adjustments", "stock_batches", "supplier_payments",
  "suppliers", "surgeries", "symptoms", "user_permissions", "user_roles", "vaccinations", "visit_advice",
  "visit_diagnoses", "visit_symptoms", "visit_tests",
] as const;

export const DATA_MOVE_BUCKETS = ["product-images", "cash-close-reports"] as const;

const PAGE = 500;

async function assertAdmin(context: Ctx) {
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Admin only");
}

// New Supabase project (Petcarevetpos). Public URL + publishable (anon) key only —
// writes go through the temporary public._move_insert function, which exists only
// during the move window and is dropped afterwards.
const NEW_URL = "https://sjrojnbpahcmggqyjzch.supabase.co";
const NEW_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqcm9qbmJwYWhjbWdncXlqemNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxODg5NTMsImV4cCI6MjExMDc2NDk1M30.M6Jde9oK-aNiku7_Mat6csZfG1aKRiDC9RtSkhQWMXA";

function newClient() {
  return createClient(NEW_URL, NEW_ANON_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

function checkTable(table: string) {
  if (!(DATA_MOVE_TABLES as readonly string[]).includes(table)) throw new Error(`Unknown table ${table}`);
}

/** Row counts on both sides. */
export const dataMoveCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tables: string[] }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    const target = newClient();
    const out: { table: string; source: number | null; target: number | null; error?: string }[] = [];
    for (const table of data.tables) {
      checkTable(table);
      const [a, b] = await Promise.all([
        (context as Ctx).supabase.from(table).select("*", { count: "exact", head: true }),
        target.rpc("_move_count", { _table: table }),
      ]);
      out.push({
        table,
        source: a.count ?? null,
        target: b.error ? null : Number(b.data),
        error: a.error?.message || b.error?.message || undefined,
      });
    }
    return out;
  });

/** Copies one page of a table (rows offset..offset+PAGE-1, ordered by primary key). */
export const dataMoveTablePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { table: string; offset: number }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    checkTable(data.table);
    const pk = PK[data.table] ?? "id";
    let q = (context as Ctx).supabase.from(data.table).select("*");
    for (const col of pk.split(",")) q = q.order(col, { ascending: true });
    const { data: rows, error } = await q.range(data.offset, data.offset + PAGE - 1);
    if (error) throw new Error(`${data.table}: read failed — ${error.message}`);
    const list = (rows ?? []) as Record<string, unknown>[];
    if (list.length > 0) {
      const { error: wErr } = await newClient().rpc("_move_insert", { _table: data.table, _rows: list });
      if (wErr) throw new Error(`${data.table}: write failed — ${wErr.message}`);
    }
    return { copied: list.length, done: list.length < PAGE };
  });

/** Copies every file of one storage bucket (keeps the same paths). */
export const dataMoveBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bucket: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    if (!(DATA_MOVE_BUCKETS as readonly string[]).includes(data.bucket)) throw new Error("Unknown bucket");
    const src = (context as Ctx).supabase.storage.from(data.bucket);
    const dst = newClient().storage.from(data.bucket);

    const files: string[] = [];
    const walk = async (prefix: string) => {
      for (let offset = 0; ; offset += 1000) {
        const { data: items, error } = await src.list(prefix, { limit: 1000, offset });
        if (error) throw new Error(`${data.bucket}: list failed — ${error.message}`);
        for (const it of items ?? []) {
          const path = prefix ? `${prefix}/${it.name}` : it.name;
          if (it.id === null || it.id === undefined) await walk(path);
          else files.push(path);
        }
        if (!items || items.length < 1000) break;
      }
    };
    await walk("");

    let copied = 0;
    const failed: string[] = [];
    for (const path of files) {
      const { data: blob, error } = await src.download(path);
      if (error || !blob) { failed.push(path); continue; }
      const { error: upErr } = await dst.upload(path, blob, { upsert: false, contentType: blob.type || undefined });
      if (upErr && !/exist|duplicate/i.test(upErr.message)) failed.push(`${path}: ${upErr.message}`);
      else copied += 1;
    }
    return { total: files.length, copied, failed };
  });
