import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { DatabaseZap } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DATA_MOVE_BUCKETS,
  DATA_MOVE_TABLES,
  dataMoveBucket,
  dataMoveCounts,
  dataMoveTablePage,
} from "@/lib/data-move.functions";

export const Route = createFileRoute("/_authenticated/data-move")({
  component: DataMovePage,
});

type Row = { name: string; status: string; source?: number | null; target?: number | null; note?: string };

/** TEMPORARY page for the one-time move to the new Supabase project. Remove after the move. */
function DataMovePage() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const copyPage = useServerFn(dataMoveTablePage);
  const copyBucket = useServerFn(dataMoveBucket);
  const counts = useServerFn(dataMoveCounts);
  const [rows, setRows] = useState<Row[]>(() => [
    ...DATA_MOVE_TABLES.map((t) => ({ name: t, status: "waiting" })),
    ...DATA_MOVE_BUCKETS.map((b) => ({ name: `storage: ${b}`, status: "waiting" })),
  ]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  const patch = (name: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.name === name ? { ...r, ...p } : r)));

  const verify = async () => {
    setMessage("Counting rows on both databases…");
    for (let i = 0; i < DATA_MOVE_TABLES.length; i += 8) {
      const res = await counts({ data: { tables: DATA_MOVE_TABLES.slice(i, i + 8) as unknown as string[] } });
      for (const r of res) patch(r.table, { source: r.source, target: r.target, note: r.error });
    }
    setMessage("Counts updated.");
  };

  const start = async () => {
    setRunning(true);
    setMessage("Copying…");
    let failures = 0;
    for (const table of DATA_MOVE_TABLES) {
      patch(table, { status: "copying", note: undefined });
      try {
        let offset = 0;
        for (;;) {
          const r = await copyPage({ data: { table, offset } });
          offset += r.copied;
          patch(table, { status: `copying (${offset})` });
          if (r.done) break;
        }
        patch(table, { status: `done (${offset})` });
      } catch (e: any) {
        failures += 1;
        patch(table, { status: "failed", note: e?.message ?? String(e) });
      }
    }
    for (const bucket of DATA_MOVE_BUCKETS) {
      const name = `storage: ${bucket}`;
      patch(name, { status: "copying" });
      try {
        const r = await copyBucket({ data: { bucket } });
        if (r.failed.length) failures += 1;
        patch(name, {
          status: `done (${r.copied}/${r.total})`,
          note: r.failed.length ? `Failed: ${r.failed.slice(0, 5).join(", ")}` : undefined,
        });
      } catch (e: any) {
        failures += 1;
        patch(name, { status: "failed", note: e?.message ?? String(e) });
      }
    }
    await verify();
    setRunning(false);
    setMessage(failures ? `Finished with ${failures} problem(s) — see the red rows.` : "All tables and files copied.");
  };

  if (!isAdmin) {
    return <div className="p-6 text-sm text-muted-foreground">Only an admin can open this page.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Data move"
        description="One-time copy of all data and files to the new Supabase database."
        icon={DatabaseZap}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={verify} disabled={running}>Check counts</Button>
            <Button onClick={start} disabled={running}>{running ? "Copying…" : "Start copy"}</Button>
          </div>
        }
      />
      {message && <p className="mb-3 text-sm">{message}</p>}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table / bucket</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Old</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const mismatch = r.source != null && r.target != null && r.source !== r.target;
                const bad = r.status === "failed" || mismatch || !!r.note;
                return (
                  <TableRow key={r.name} className={bad ? "bg-red-50" : undefined}>
                    <TableCell className="font-mono text-xs">{r.name}</TableCell>
                    <TableCell className="text-xs">{r.status}</TableCell>
                    <TableCell className="text-right text-xs">{r.source ?? ""}</TableCell>
                    <TableCell className="text-right text-xs">{r.target ?? ""}</TableCell>
                    <TableCell className="text-xs text-red-700">{r.note ?? ""}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
