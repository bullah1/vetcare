import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerEntryDetail, type LedgerEntry } from "@/components/LedgerEntryDetail";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";

type Props = { ownerId: string; customerName: string; customerPhone?: string | null };

type Row = LedgerEntry & { balance: number };

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


export function CustomerLedger({ ownerId, customerName, customerPhone }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer-ledger", ownerId],
    enabled: !!ownerId && ownerId !== "walkin",
    queryFn: async () => {
      const sales = await fetchAll<any>(() => supabase
        .from("sales")
        .select("id,invoice_no,created_at,total,status")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: true })
        .order("id"));

      // Only live sales drive the ledger — void/cancelled invoices contribute
      // nothing (their payments/returns are excluded too, keeping balance == due).
      const liveSales = ((sales ?? []) as any[]).filter((s) => s.status !== "void");
      const ids = liveSales.map((s) => s.id);
      const [payRows, retRows] = await Promise.all([
        fetchAllIn<any>(ids, (c) => supabase.from("payments").select("id,sale_id,amount,method,reference,received_at").in("sale_id", c).order("id")),
        fetchAllIn<any>(ids, (c) => supabase.from("sale_returns").select("id,sale_id,return_no,refund_amount,refund_paid,refund_method,created_at").in("sale_id", c).order("id")),
      ]);
      const payRes = { data: payRows };
      const retRes = { data: retRows };

      const invoiceNo = (id: string) => (sales ?? []).find((s) => s.id === id)?.invoice_no ?? "";

      const raw: Omit<Row, "balance">[] = [];
      for (const s of liveSales) {
        raw.push({
          id: `s-${s.id}`,
          kind: "sale",
          sourceId: s.id,
          saleId: s.id,
          at: s.created_at,
          particulars: "Sale invoice",
          ref: s.invoice_no,
          debit: Number(s.total),
          credit: 0,
        });
      }
      for (const p of (payRes.data ?? []) as any[]) {
        const amt = Number(p.amount);
        raw.push({
          id: `p-${p.id}`,
          kind: "payment",
          sourceId: p.id,
          saleId: p.sale_id,
          at: p.received_at,
          particulars: amt >= 0 ? `Payment received (${p.method})` : `Refund paid (${p.method})`,
          ref: p.reference || invoiceNo(p.sale_id),
          debit: amt < 0 ? -amt : 0,
          credit: amt >= 0 ? amt : 0,
        });
      }
      for (const r of (retRes.data ?? []) as any[]) {
        // Returned goods are credited at their FULL value. Money paid back to the
        // customer is a separate debit (the negative payment row above), so the
        // balance = invoice − payments + money paid back − returned value = due.
        // Crediting only the unpaid part (as before) left every cash/bKash refund
        // on the ledger as a phantom due.
        const dueCredit = Number(r.refund_amount);
        if (dueCredit <= 0.004) continue;
        raw.push({
          id: `r-${r.id}`,
          kind: "return",
          sourceId: r.id,
          saleId: r.sale_id,
          at: r.created_at,
          particulars: "Sale return (goods returned)",
          ref: r.return_no,
          debit: 0,
          credit: dueCredit,
        });
      }


      raw.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      let bal = 0;
      const rows: Row[] = raw.map((r) => {
        bal += r.debit - r.credit;
        return { ...r, balance: bal };
      });
      return rows;
    },
  });

  const [selected, setSelected] = useState<LedgerEntry | null>(null);
  const rows = data ?? [];

  const totals = useMemo(() => {
    const debit = rows.reduce((a, r) => a + r.debit, 0);
    const credit = rows.reduce((a, r) => a + r.credit, 0);
    return { debit, credit, balance: debit - credit };
  }, [rows]);

  function printLedger() {
    const body = rows
      .map(
        (r) => `<tr>
          <td>${format(new Date(r.at), "dd MMM yyyy, hh:mm a")}</td>
          <td>${r.particulars}${r.ref ? ` <span class="muted">(${r.ref})</span>` : ""}</td>
          <td class="num">${r.debit ? fmt(r.debit) : ""}</td>
          <td class="num">${r.credit ? fmt(r.credit) : ""}</td>
          <td class="num">${fmt(r.balance)}</td>
        </tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ledger — ${customerName}</title>
      <style>
        body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#111}
        h1{font-size:18px;margin:0 0 4px}
        .muted{color:#666;font-size:11px}
        table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
        th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}
        th{background:#f4f4f5}
        .num{text-align:right;font-variant-numeric:tabular-nums}
        tfoot td{font-weight:700;border-top:2px solid #333}
      </style></head><body>
      <h1>Customer Ledger — ${customerName}</h1>
      <div class="muted">${customerPhone ? `Phone: ${customerPhone} · ` : ""}Generated ${format(new Date(), "dd MMM yyyy, hh:mm a")}</div>
      <table><thead><tr><th>Date</th><th>Particulars</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
      <tbody>${body || `<tr><td colspan="5">No transactions</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2">Closing balance (due)</td><td class="num">${fmt(totals.debit)}</td><td class="num">${fmt(totals.credit)}</td><td class="num">${fmt(totals.balance)}</td></tr></tfoot>
      </table></body></html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  if (ownerId === "walkin") {
    return <div className="py-6 text-center text-sm text-muted-foreground">Walk-in customer — no ledger.</div>;
  }
  if (isLoading) return <div className="py-6 text-center text-sm text-muted-foreground">Loading ledger…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="text-muted-foreground">Debit (bill): <span className="font-medium text-foreground tabular-nums">{fmt(totals.debit)}</span></span>
          <span className="text-muted-foreground">Credit (paid): <span className="font-medium text-emerald-600 tabular-nums">{fmt(totals.credit)}</span></span>
          <span className="text-muted-foreground">
            Balance:{" "}
            {totals.balance > 0.004 ? (
              <span className="font-semibold text-destructive tabular-nums">{fmt(totals.balance)} due</span>
            ) : totals.balance < -0.004 ? (
              <span className="font-semibold text-emerald-600 tabular-nums">{fmt(-totals.balance)} advance</span>
            ) : (
              <Badge variant="secondary">Clear</Badge>
            )}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={printLedger} disabled={rows.length === 0}>
          <Printer className="h-4 w-4" /> Print statement
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Particulars</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No transactions.</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow
                key={r.id}
                onClick={() => setSelected(r)}
                className="cursor-pointer"
                title="Click to view details"
              >
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {format(new Date(r.at), "dd MMM yyyy, hh:mm a")}
                </TableCell>
                <TableCell>
                  <div className="text-sm">{r.particulars}</div>
                  {r.ref && <div className="text-xs text-muted-foreground">{r.ref}</div>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.debit ? fmt(r.debit) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-600">{r.credit ? fmt(r.credit) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{fmt(r.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <LedgerEntryDetail entry={selected} ownerId={ownerId} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}

