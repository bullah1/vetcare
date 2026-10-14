// Some columns only exist after an optional SQL update (e.g. B2B prices).
// Try the newer query once; if the database does not have the column yet,
// remember that for this session and use the older query from then on —
// so pages do not send a failing request every time.
const missing = new Set<string>();

export async function withSchemaFallback<T>(key: string, newer: () => Promise<T>, older: () => Promise<T>): Promise<T> {
  if (missing.has(key)) return older();
  try {
    return await newer();
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    // 42703 = column does not exist, PGRST204/PGRST200 = unknown column / relation in the schema cache
    if (e?.code === "42703" || e?.code === "PGRST204" || e?.code === "PGRST200" || /does not exist|schema cache/i.test(msg)) {
      missing.add(key);
      return older();
    }
    throw e;
  }
}

export const schemaMissing = (key: string) => missing.has(key);
export const markSchemaMissing = (key: string) => void missing.add(key);
