import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { dayRangeISO } from "@/lib/sales-ledger";
import { runAudit, summarizeAudit, CHECK_LABELS, type AuditIssue } from "@/lib/audit-checks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

/** PostgREST caps URL length — page the .in() filter in chunks. */
async function inChunks<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>, size = 200) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await run(ids.slice(i, i + size))));
  return out;
}

export function AuditReport({ from, to }: { from: string; to: string }) {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "error" | "warning">("all");
  const [scanned, setScanned] = useState<{ sales: number; payments: number; items: number } | null>(null);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { fromISO, toISO } = dayRangeISO(from, to);
        const sales = await fetchAll(() =>
          supabase
            .from("sales")
            .select("id,invoice_no,subtotal,discount,tax,total,paid,due,status,created_at")
            .gte("created_at", fromISO)
            .lte("created_at", toISO)
            .order("created_at"),
        );
        const ids = sales.map((s: any) => s.id);

        const [saleItems, payments, returns, products] = await Promise.all([
          inChunks(ids, (c) =>
            fetchAll(() =>
              supabase
                .from("sale_items")
                .select("id,sale_id,name,quantity,unit_price,discount,tax,line_total,returned_quantity")
                .in("sale_id", c),
            ),
          ),
          inChunks(ids, (c) =>
            fetchAll(() =>
              supabase.from("payments").select("id,sale_id,amount,method,reference,received_at").in("sale_id", c),
            ),
          ),
          inChunks(ids, (c) =>
            fetchAll(() =>
              supabase
                .from("sale_returns")
                .select("id,sale_id,return_no,refund_amount,refund_paid,refund_method,created_at")
                .in("sale_id", c),
            ),
          ),
          fetchAll(() =>
            supabase
              .from("products")
              .select("id,name,sku,barcode,stock_quantity,purchase_price,selling_price,is_active"),
          ),
        ]);

        const returnIds = returns.map((r: any) => r.id);
        const paymentIds = payments.map((p: any) => p.id);
        const [returnItems, cashMovements] = await Promise.all([
          inChunks(returnIds, (c) =>
            fetchAll(() =>
              supabase
                .from("sale_return_items")
                .select("id,return_id,sale_item_id,name,quantity,unit_price,line_total")
                .in("return_id", c),
            ),
          ),
          inChunks(paymentIds, (c) =>
            fetchAll(() =>
              supabase
                .from("cash_movements")
                .select("id,direction,amount,source,source_id,method,occurred_at")
                .in("source_id", c),
            ),
          ),
        ]);

        if (cancelled) return;
        setIssues(runAudit({ sales, saleItems, payments, returns, returnItems, products, cashMovements }));
        setScanned({ sales: sales.length, payments: payments.length, items: saleItems.length });
        setRanAt(new Date());
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Audit failed to run");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, nonce]);

  const summary = useMemo(() => summarizeAudit(issues), [issues]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return issues.filter(
      (i) =>
        (only === "all" || i.severity === only) &&
        (!term ||
          i.ref.toLowerCase().includes(term) ||
          i.title.toLowerCase().includes(term) ||
          i.detail.toLowerCase().includes(term)),
    );
  }, [issues, q, only]);

  function printAudit() {
    const rows = filtered
      .map(
        (i) => `<tr>
          <td>${i.severity === "error" ? "MISMATCH" : "REVIEW"}</td>
          <td>${i.ref}</td>
          <td>${i.title}<div class="muted">${i.detail}</div></td>
          <td class="num">${i.diff != null ? fmt(i.diff) : ""}</td>
          <td>${i.at ? format(new Date(i.at), "dd MMM yy, hh:mm a") : ""}</td>
        </tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Audit report ${from} → ${to}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#111}
      h1{font-size:18px;margin:0 0 4px}.muted{color:#666;font-size:11px}
      table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}
      th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
      th{background:#f4f4f5}.num{text-align:right;font-variant-numeric:tabular-nums}</style></head><body>
      <h1>Accounts Audit — ${from} → ${to}</h1>
      <div class="muted">${summary.errors} mismatch, ${summary.warnings} review · generated ${format(new Date(), "dd MMM yyyy, hh:mm a")}</div>
      <table><thead><tr><th>Type</th><th>Ref</th><th>Finding</th><th class="num">Diff</th><th>When</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">No issues found</td></tr>`}</tbody></table></body></html>`;
    const w = window.open("", "_blank", "width=980,height=720");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  return (
    <div className="space-y-4">
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-4 md:grid-cols-4">
        <Card className={summary.errors ? "border-2 border-destructive" : "border-2 border-emerald-600"}>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-semibold text-muted-foreground">Mismatch / wrong entry</div>
            <div className={`text-2xl font-bold ${summary.errors ? "text-destructive" : "text-emerald-600"}`}>
              {summary.errors}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">হিসাব না মেলা entry</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs text-muted-foreground">Needs review</div>
            <div className="text-2xl font-bold text-amber-600">{summary.warnings}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">duplicate / সন্দেহজনক</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs text-muted-foreground">Rows cross-checked</div>
            <div className="text-2xl font-bold">
              {scanned ? scanned.sales + scanned.payments + scanned.items : "—"}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {scanned ? `${scanned.sales} invoice · ${scanned.items} line · ${scanned.payments} payment` : ""}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex h-full flex-col justify-between gap-2 p-3 sm:p-4">
            <div>
              <div className="text-xs text-muted-foreground">Last run</div>
              <div className="text-sm font-medium">{ranAt ? format(ranAt, "dd MMM, hh:mm:ss a") : "—"}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setNonce((v) => v + 1)} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Re-run
              </Button>
              <Button size="sm" variant="outline" onClick={printAudit} disabled={loading || !issues.length}>
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" /> Checks performed
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1.5 sm:grid-cols-2">
          {Object.entries(CHECK_LABELS).map(([key, label]) => {
            const c = summary.byCheck.get(key);
            const bad = (c?.errors ?? 0) > 0;
            const warn = !bad && (c?.warnings ?? 0) > 0;
            return (
              <div key={key} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span className="min-w-0 truncate">{label}</span>
                {bad ? (
                  <Badge variant="destructive" className="shrink-0">
                    {c!.errors} mismatch
                  </Badge>
                ) : warn ? (
                  <Badge className="shrink-0 bg-amber-500 text-white hover:bg-amber-500">{c!.warnings} review</Badge>
                ) : (
                  <Badge variant="secondary" className="shrink-0 gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> OK
                  </Badge>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 pb-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> Findings
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search invoice / issue…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-full sm:w-56"
            />
            {(["all", "error", "warning"] as const).map((k) => (
              <Button key={k} size="sm" variant={only === k ? "default" : "outline"} onClick={() => setOnly(k)}>
                {k === "all" ? "All" : k === "error" ? "Mismatch" : "Review"}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {error && <div className="py-6 text-center text-sm text-destructive">{error}</div>}
          {!error && loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">Cross-checking every entry…</div>
          )}
          {!error && !loading && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <div className="text-sm font-medium">সব হিসাব মিলে গেছে — no mismatch found</div>
              <div className="text-xs text-muted-foreground">
                Invoice math, payments, refunds, cash trail and stock all reconcile for this range.
              </div>
            </div>
          )}
          {!error && !loading && filtered.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Type</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead>Finding</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                    <TableHead className="whitespace-nowrap">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        {i.severity === "error" ? (
                          <Badge variant="destructive">Mismatch</Badge>
                        ) : (
                          <Badge className="bg-amber-500 text-white hover:bg-amber-500">Review</Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{i.ref}</TableCell>
                      <TableCell>
                        <div className="text-sm">{i.title}</div>
                        <div className="text-xs text-muted-foreground">{i.detail}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {i.diff != null ? fmt(i.diff) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {i.at ? format(new Date(i.at), "dd MMM yy, hh:mm a") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
