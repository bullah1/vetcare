// Supplier ledger: every purchase, return and payment with a supplier, with a
// running balance (purchased − returned − paid), plus the products bought.
// Purchases are stock only in this shop (accounts are kept separately), so the
// balance is "what we bought from them" unless payments are recorded here.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { exportToExcel } from "@/lib/export-excel";
import { getClinic } from "@/lib/clinic-settings";
import { todayDhaka } from "@/lib/sales-ledger";
import { shiftDay } from "@/lib/sales-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const db = supabase as any;
const n = (v: unknown) => Number(v) || 0;
const money = (v: number) => `${v < 0 ? "−" : ""}৳${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

type Entry = { date: string; type: "Purchase" | "Return" | "Payment" | "Refund"; ref: string; note: string; debit: number; credit: number };

async function loadLedger(supplierId: string) {
  const [invoices, payments] = await Promise.all([
    fetchAll<any>(() => db.from("purchase_invoices")
      .select("id,invoice_no,supplier_invoice_no,invoice_date,total,status,stock_only,created_at")
      .eq("supplier_id", supplierId).order("invoice_date").order("id")),
    fetchAll<any>(() => db.from("supplier_payments")
      .select("id,amount,method,reference,notes,paid_at,invoice_id")
      .eq("supplier_id", supplierId).order("paid_at").order("id")),
  ]);
  const ids = invoices.map((i: any) => i.id);
  const [returns, items] = ids.length
    ? await Promise.all([
      fetchAll<any>(() => db.from("purchase_returns").select("id,return_no,invoice_id,refund_amount,reason,created_at").in("invoice_id", ids).order("created_at").order("id")),
      fetchAll<any>(() => db.from("purchase_invoice_items").select("invoice_id,product_id,name,quantity,returned_quantity,line_total").in("invoice_id", ids).order("id")),
    ])
    : [[], []];
  return { invoices, payments, returns, items };
}

export function SupplierLedgerDialog({ open, onOpenChange, suppliers, supplierId: initialId }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suppliers: { id: string; name: string; phone?: string | null }[];
  supplierId?: string | null;
}) {
  const [supplierId, setSupplierId] = useState<string>(initialId ?? "");
  const [from, setFrom] = useState(shiftDay(todayDhaka(), -89));
  const [to, setTo] = useState(todayDhaka());
  const id = supplierId || initialId || "";
  const supplier = suppliers.find((s) => s.id === id);

  const q = useQuery({ queryKey: ["supplier-ledger", id], enabled: open && !!id, queryFn: () => loadLedger(id) });

  const view = useMemo(() => {
    if (!q.data) return null;
    const { invoices, payments, returns, items } = q.data;
    const returnedBy = new Map<string, number>();
    for (const r of returns) returnedBy.set(r.invoice_id, (returnedBy.get(r.invoice_id) ?? 0) + n(r.refund_amount));
    const invNo = new Map(invoices.map((i: any) => [i.id, i.invoice_no]));
    const all: Entry[] = [];
    for (const i of invoices) {
      // A return lowers the invoice total, so the bill as bought = total + its returns.
      all.push({ date: String(i.invoice_date), type: "Purchase", ref: i.invoice_no, note: i.supplier_invoice_no ? `Supplier bill ${i.supplier_invoice_no}` : "", debit: n(i.total) + (returnedBy.get(i.id) ?? 0), credit: 0 });
    }
    for (const r of returns) all.push({ date: String(r.created_at).slice(0, 10), type: "Return", ref: r.return_no, note: `${invNo.get(r.invoice_id) ?? ""}${r.reason ? ` · ${r.reason}` : ""}`, debit: 0, credit: n(r.refund_amount) });
    for (const p of payments) {
      const a = n(p.amount);
      all.push({ date: String(p.paid_at).slice(0, 10), type: a < 0 ? "Refund" : "Payment", ref: p.reference ?? "", note: `${p.method}${p.notes ? ` · ${p.notes}` : ""}`, debit: a < 0 ? -a : 0, credit: a > 0 ? a : 0 });
    }
    const order = { Purchase: 0, Return: 1, Refund: 2, Payment: 3 };
    all.sort((a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type]);
    const opening = all.filter((e) => e.date < from).reduce((t, e) => t + e.debit - e.credit, 0);
    let bal = opening;
    const rows = all.filter((e) => e.date >= from && e.date <= to).map((e) => ({ ...e, balance: (bal += e.debit - e.credit) }));
    const sum = (k: Entry["type"]) => rows.filter((r) => r.type === k).reduce((t, r) => t + (k === "Purchase" || k === "Refund" ? r.debit : r.credit), 0);
    // Products bought in the period
    const inPeriod = new Set(invoices.filter((i: any) => i.invoice_date >= from && i.invoice_date <= to).map((i: any) => i.id));
    const prod = new Map<string, { name: string; qty: number; returned: number; amount: number }>();
    for (const it of items) {
      if (!inPeriod.has(it.invoice_id)) continue;
      const k = it.product_id ?? it.name;
      const p = prod.get(k) ?? { name: it.name, qty: 0, returned: 0, amount: 0 };
      p.qty += n(it.quantity); p.returned += n(it.returned_quantity); p.amount += n(it.line_total);
      prod.set(k, p);
    }
    return {
      rows, opening, closing: bal,
      purchased: sum("Purchase"), returned: sum("Return"), paid: sum("Payment") - sum("Refund"),
      bills: rows.filter((r) => r.type === "Purchase").length,
      products: [...prod.values()].sort((a, b) => b.amount - a.amount),
    };
  }, [q.data, from, to]);

  const exportExcel = () => {
    if (!view || !supplier) return;
    exportToExcel([
      { Date: from, Type: "Opening balance", Ref: "", Note: "", Debit: "", Credit: "", Balance: Math.round(view.opening * 100) / 100 },
      ...view.rows.map((r) => ({ Date: r.date, Type: r.type, Ref: r.ref, Note: r.note, Debit: r.debit || "", Credit: r.credit || "", Balance: Math.round(r.balance * 100) / 100 })),
    ], `supplier-ledger-${supplier.name.replace(/\W+/g, "-")}_${from}_${to}`, "Ledger");
  };

  const print = () => {
    if (!view || !supplier) return;
    const c = getClinic();
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const esc = (t: string) => t.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
    const tr = view.rows.map((r) => `<tr><td>${r.date}</td><td>${r.type}</td><td>${esc(r.ref)}</td><td>${esc(r.note)}</td><td class="r">${r.debit ? money(r.debit) : ""}</td><td class="r">${r.credit ? money(r.credit) : ""}</td><td class="r">${money(r.balance)}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Supplier ledger — ${esc(supplier.name)}</title>
      <style>body{font-family:system-ui,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left}th{background:#f5f5f5}.r{text-align:right}.sum{display:flex;gap:24px;margin-top:10px}.sum b{display:block;font-size:14px}</style></head><body>
      <h1>${esc(c.name)} — Supplier ledger</h1>
      <div>${esc(supplier.name)}${supplier.phone ? ` · ${esc(supplier.phone)}` : ""} · ${from} to ${to}</div>
      <div class="sum"><div>Opening<b>${money(view.opening)}</b></div><div>Purchased<b>${money(view.purchased)}</b></div><div>Returned<b>${money(view.returned)}</b></div><div>Paid<b>${money(view.paid)}</b></div><div>Closing balance<b>${money(view.closing)}</b></div></div>
      <table><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Note</th><th class="r">Purchase</th><th class="r">Return / paid</th><th class="r">Balance</th></tr></thead><tbody>
      <tr><td>${from}</td><td colspan="5"><i>Opening balance</i></td><td class="r">${money(view.opening)}</td></tr>${tr}</tbody></table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>Supplier ledger{supplier ? ` — ${supplier.name}` : ""}</DialogTitle></DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={id} onValueChange={setSupplierId}>
            <SelectTrigger className="h-9 w-56" aria-label="Supplier"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
            <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="date" className="h-9 w-36" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From" />
          <span className="text-muted-foreground">→</span>
          <Input type="date" className="h-9 w-36" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To" />
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" disabled={!view} onClick={exportExcel}><FileDown className="h-4 w-4" /> Excel</Button>
            <Button variant="outline" size="sm" disabled={!view} onClick={print}><Printer className="h-4 w-4" /> Print</Button>
          </div>
        </div>

        {!id && <p className="py-10 text-center text-sm text-muted-foreground">Choose a supplier to see the ledger.</p>}
        {id && q.isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
        {id && q.error && <p className="py-10 text-center text-sm text-destructive">{(q.error as Error).message}</p>}

        {view && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ["Opening", view.opening, ""],
                ["Purchased", view.purchased, `${view.bills} bill${view.bills === 1 ? "" : "s"}`],
                ["Returned", view.returned, ""],
                ["Paid", view.paid, ""],
                ["Closing balance", view.closing, ""],
              ].map(([label, v, sub]) => (
                <div key={label as string} className={`rounded-lg border px-3 py-2 ${label === "Closing balance" ? "bg-muted/50" : ""}`}>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="font-semibold tabular-nums">{money(v as number)}</div>
                  {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Balance = purchased − returned − paid. Purchases here are stock only, so payments show only if they were recorded in the app.</p>

            <Tabs defaultValue="ledger">
              <TabsList>
                <TabsTrigger value="ledger">Ledger ({view.rows.length})</TabsTrigger>
                <TabsTrigger value="products">Products bought ({view.products.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="ledger" className="pt-2">
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Ref</TableHead>
                        <TableHead className="text-right">Purchase</TableHead><TableHead className="text-right">Return / paid</TableHead><TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-muted/30">
                        <TableCell className="text-xs">{from}</TableCell>
                        <TableCell colSpan={4} className="text-xs italic text-muted-foreground">Opening balance</TableCell>
                        <TableCell className="text-right tabular-nums">{money(view.opening)}</TableCell>
                      </TableRow>
                      {view.rows.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Nothing with this supplier in these dates.</TableCell></TableRow>
                      )}
                      {view.rows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{r.date}</TableCell>
                          <TableCell className={r.type === "Purchase" ? "" : r.type === "Return" ? "text-amber-700" : "text-emerald-700"}>{r.type}</TableCell>
                          <TableCell>
                            <div className="text-sm">{r.ref || "—"}</div>
                            {r.note && <div className="text-[11px] text-muted-foreground">{r.note}</div>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.debit ? money(r.debit) : ""}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.credit ? money(r.credit) : ""}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{money(r.balance)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
              <TabsContent value="products" className="pt-2">
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Returned</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.products.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No products bought in these dates.</TableCell></TableRow>}
                      {view.products.map((p) => (
                        <TableRow key={p.name}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.qty}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.returned || ""}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(p.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
