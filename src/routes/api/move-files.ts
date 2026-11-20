import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * TEMPORARY (database move): copies the files of the two storage buckets from the
 * old Lovable Cloud project to the new Supabase project. Uses only public URLs and
 * publishable keys; it works only while temporary read/upload policies exist on the
 * two projects, and it only ever copies files the shop already owns. Removed after
 * the move.
 */
const OLD_URL = "https://c--95fa5ac1-0b33-41a5-ac2e-f7df2cc8826f-prod.lovable.cloud";
const OLD_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzbWZib3F5ZGZxZ3RvendkcnVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODc1MTYsImV4cCI6MjA5ODQ2MzUxNn0.hDY7CuwbfX5C2K0bSpUQ9hodbSOuGCuQShmPh9pdHtY";
const NEW_URL = "https://sjrojnbpahcmggqyjzch.supabase.co";
const NEW_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqcm9qbmJwYWhjbWdncXlqemNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxODg5NTMsImV4cCI6MjExMDc2NDk1M30.M6Jde9oK-aNiku7_Mat6csZfG1aKRiDC9RtSkhQWMXA";
const BUCKETS = ["product-images", "cash-close-reports"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const opts = { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } };

export const Route = createFileRoute("/api/move-files")({
  server: {
    handlers: {
      GET: async () => {
        const oldDb = createClient(OLD_URL, OLD_KEY, opts);
        const newDb = createClient(NEW_URL, NEW_KEY, opts);
        const report: Record<string, { total: number; copied: number; skipped: number; failed: string[] }> = {};
        for (const bucket of BUCKETS) {
          const src = oldDb.storage.from(bucket);
          const dst = newDb.storage.from(bucket);
          const files: string[] = [];
          const walk = async (prefix: string): Promise<void> => {
            for (let offset = 0; ; offset += 1000) {
              const { data, error } = await src.list(prefix, { limit: 1000, offset });
              if (error) throw new Error(`${bucket}: list failed — ${error.message}`);
              for (const it of data ?? []) {
                const path = prefix ? `${prefix}/${it.name}` : it.name;
                if (it.id === null || it.id === undefined) await walk(path);
                else files.push(path);
              }
              if (!data || data.length < 1000) break;
            }
          };
          const r = { total: 0, copied: 0, skipped: 0, failed: [] as string[] };
          try {
            await walk("");
          } catch (e: any) {
            r.failed.push(e?.message ?? String(e));
          }
          r.total = files.length;
          for (const path of files) {
            const { data: blob, error } = await src.download(path);
            if (error || !blob) { r.failed.push(`${path}: download ${error?.message ?? "empty"}`); continue; }
            const { error: upErr } = await dst.upload(path, blob, { upsert: false, contentType: blob.type || undefined });
            if (!upErr) r.copied += 1;
            else if (/exist|duplicate/i.test(upErr.message)) r.skipped += 1;
            else r.failed.push(`${path}: upload ${upErr.message}`);
          }
          report[bucket] = r;
        }
        return json(report);
      },
    },
  },
});
