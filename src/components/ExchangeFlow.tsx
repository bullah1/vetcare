import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, CheckCircle2, Minus, Plus, Printer, Search, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { fetchAll } from "@/lib/fetch-all";
import { PROJECTS, asProject, type Project } from "@/lib/projects";

/** Bills can be exchanged for this many days (the server checks the same rule). */
export const EXCHANGE_DAYS = 15;
export const canExchange = (createdAt: string) =>
  Date.now() - new Date(createdAt).getTime() <= EXCHANGE_DAYS * 86400000;

const PAY = ["cash", "bkash", "nagad", "rocket", "card", "bank"] as const;
type Pay = (typeof PAY)[number];
const PAY_LABEL: Record<Pay, string> = { cash: "Cash", bkash: "bKash", nagad: "Nagad", rocket: "Rocket", card: "Card", bank: "Bank" };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const tk = (n: number) => `৳ ${r2(n).toFixed(2)}`;

type Product = {
  id: string; name: string; selling_price: number; wholesale_price: number | null; tax_percent: number | null;
  stock_quantity: number; unit: string | null; project: string | null;
};
type NewLine = { product: Product; quantity: number };
type Done = {
  return_no: string; return_amount: number; old_due_cleared: number; credit: number; credit_used: number;
  leftover: number; leftover_mode: "refund" | "credit" | null; refund_method: string | null;
  new_sale_id: string; new_invoice_no: string; new_total: number; new_paid: number; new_due: number;
  credit_balance: number | null;
};

/**
 * Product exchange: the customer brings items back and takes other items.
 * Items back are restocked; their value pays for the new bill; only the difference
 * changes hands (or is kept as store credit on the customer's account).
 */
export function ExchangeFlow({ invoiceNo, trigger, onPrint }: {
  invoiceNo: string; trigger: React.ReactNode; onPrint?: (saleId: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [backQty, setBackQty] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<NewLine[]>([]);
  const [project, setProject] = useState<Project>("pcv");
  const [q, setQ] = useState("");
  const [payMethod, setPayMethod] = useState<Pay>("cash");
  const [payAmount, setPayAmount] = useState<number | "">("");
  const [leftover, setLeftover] = useState<"refund" | "credit">("refund");
  const [refundMethod, setRefundMethod] = useState<Pay>("cash");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const requestId = useRef(crypto.randomUUID());

  const { data: sale, error: saleError } = useQuery({
    queryKey: ["exchange-sale", invoiceNo],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sales")
        .select("id,invoice_no,total,paid,due,discount,status,created_at,project,owner_id, owner:pet_owners(full_name,phone,customer_type,due_allowed), items:sale_items(id,product_id,name,quantity,unit_price,line_total,returned_quantity)")
        .eq("invoice_no", invoiceNo)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Invoice not found");
      return data as any;
    },
  });
  useEffect(() => { if (sale) setProject(asProject(sale.project)); }, [sale?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: shift } = useQuery({
    queryKey: ["open-shift-summary"],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("cash_shift_summary", { _shift_id: null });
      if (error) throw error;
      return data as any;
    },
  });
  const shiftOpen = shift?.status === "open";

  const { data: products = [] } = useQuery({
    queryKey: ["exchange-products"],
    enabled: open,
    staleTime: 60000,
    queryFn: () => fetchAll<Product & { no_stock: boolean | null }>(() => (supabase as any).from("products")
      .select("id,name,selling_price,wholesale_price,tax_percent,stock_quantity,unit,project,no_stock")
      .eq("is_active", true).order("name").order("id"))
      .then((rows) => rows.filter((p) => !p.no_stock)),
  });

  const ownerId: string | null = sale?.owner_id ?? null;
  const isB2b = sale?.owner?.customer_type === "b2b";
  const priceOf = (p: Product) => Number(isB2b ? (p.wholesale_price ?? p.selling_price) : p.selling_price) || 0;

  const { data: creditBalance = 0 } = useQuery({
    queryKey: ["credit-balance", ownerId],
    enabled: open && !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("customer_credit_balance", { _owner_id: ownerId });
      if (error) throw error;
      return Number(data) || 0;
    },
  });

  // --- items coming back (same price rule as Return: the bill discount is shared over the lines)
  const items: any[] = sale?.items ?? [];
  const factor = useMemo(() => {
    const gross = items.reduce((s, it) => s + Number(it.line_total || 0), 0);
    const disc = Number(sale?.discount ?? 0);
    return gross > 0 && disc > 0 ? Math.max(0, 1 - disc / gross) : 1;
  }, [items, sale?.discount]);
  const returnValue = items.reduce((s, it) => {
    const qn = backQty[it.id] ?? 0;
    return qn > 0 ? s + r2(qn * (Number(it.line_total) / Number(it.quantity || 1)) * factor) : s;
  }, 0);
  const oldDue = Math.max(0, Number(sale?.due || 0));
  const dueCleared = Math.min(returnValue, oldDue);
  const credit = r2(returnValue - dueCleared);

  // --- new items
  const newTotal = r2(lines.reduce((s, l) => {
    const sub = priceOf(l.product) * l.quantity;
    return s + sub + sub * (Number(l.product.tax_percent) || 0) / 100;
  }, 0));
  const diff = r2(newTotal - credit);          // > 0 customer pays, < 0 customer gets back
  const payNow = diff > 0 ? (payAmount === "" ? diff : Math.min(Number(payAmount) || 0, diff)) : 0;
  const leftDue = diff > 0 ? r2(diff - payNow) : 0;

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return products.filter((p) => asProject(p.project) === project && p.name.toLowerCase().includes(t)).slice(0, 8);
  }, [q, products, project]);

  const addProduct = (p: Product) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { product: p, quantity: 1 }];
    });
    setQ("");
  };
  const setBack = (id: string, delta: number, max: number) =>
    setBackQty((m) => ({ ...m, [id]: Math.round(Math.max(0, Math.min(max, (m[id] ?? 0) + delta)) * 1000) / 1000 }));

  const backCount = Object.values(backQty).reduce((s, n) => s + n, 0);
  const problem =
    !shiftOpen ? "Open the cash drawer shift first." :
    backCount <= 0 ? "Choose the item(s) the customer brings back." :
    lines.length === 0 ? "Add the new product(s) the customer takes." :
    lines.some((l) => !(l.quantity > 0)) ? "Every new product needs a quantity." :
    !reason.trim() ? "Write a reason." :
    leftDue > 0.009 && !sale?.owner?.due_allowed ? "Due is closed — the difference must be paid in full." :
    diff < 0 && leftover === "credit" && !ownerId ? "This bill has no customer — pay the difference back instead." :
    null;

  const run = useMutation({
    mutationFn: async () => {
      if (problem) throw new Error(problem);
      const { data, error } = await (supabase.rpc as any)("create_exchange", {
        _sale_id: sale.id,
        _return_items: items.map((it) => ({ sale_item_id: it.id, quantity: backQty[it.id] ?? 0 })).filter((r) => r.quantity > 0),
        _new_items: lines.map((l) => {
          const price = priceOf(l.product);
          return {
            product_id: l.product.id, name: l.product.name, quantity: l.quantity, unit_price: price, discount: 0,
            tax: price * l.quantity * (Number(l.product.tax_percent) || 0) / 100,
          };
        }),
        _payments: payNow > 0.004 ? [{ method: payMethod, amount: r2(payNow), reference: null }] : [],
        _leftover: leftover,
        _refund_method: diff < 0 && leftover === "refund" ? refundMethod : null,
        _reason: reason.trim().slice(0, 500),
        _client_request_id: requestId.current,
      });
      if (error) throw error;
      return data as Done;
    },
    onSuccess: (r) => {
      setDone(r);
      toast.success(`Exchange done — new bill ${r.new_invoice_no}`);
      for (const k of ["sales", "sales-history", "due-bills", "pos-products", "products", "dashboard", "cash-shift", "open-shift-summary", "credit-balance", "exchange-products"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function reset() {
    requestId.current = crypto.randomUUID();
    setBackQty({}); setLines([]); setQ(""); setPayMethod("cash"); setPayAmount("");
    setLeftover("refund"); setRefundMethod("cash"); setReason(""); setDone(null);
  }

  const until = sale ? new Date(new Date(sale.created_at).getTime() + EXCHANGE_DAYS * 86400000) : null;
  const closed = sale && (sale.status === "void" || sale.status === "refunded");

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-auto rounded-t-2xl p-4 sm:mx-auto sm:max-w-2xl sm:p-6">
        <SheetHeader className="mb-3 text-left">
          <SheetTitle className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Exchange products</SheetTitle>
        </SheetHeader>

        {saleError && <p className="text-sm text-destructive">{(saleError as Error).message}</p>}

        {done ? (
          <div className="space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">New bill</span><span className="font-mono font-medium">{done.new_invoice_no}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Return</span><span className="font-mono">{done.return_no}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Items back</span><span className="tabular-nums">{tk(done.return_amount)}</span></div>
              {done.old_due_cleared > 0.004 && <div className="flex justify-between"><span className="text-muted-foreground">Old due cleared</span><span className="tabular-nums">{tk(done.old_due_cleared)}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">New items</span><span className="tabular-nums">{tk(done.new_total)}</span></div>
              {Number(done.new_due) > 0.004 && <div className="flex justify-between text-destructive"><span>Due on new bill</span><span className="tabular-nums">{tk(done.new_due)}</span></div>}
              {done.leftover > 0.004 && (
                <div className="flex justify-between font-medium">
                  <span>{done.leftover_mode === "credit" ? "Kept as store credit" : `Paid back (${PAY_LABEL[done.refund_method as Pay] ?? done.refund_method})`}</span>
                  <span className="tabular-nums">{tk(done.leftover)}</span>
                </div>
              )}
              {done.credit_balance != null && Number(done.credit_balance) > 0.004 && (
                <div className="flex justify-between text-emerald-700"><span>Customer store credit now</span><span className="tabular-nums">{tk(Number(done.credit_balance))}</span></div>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(false)}>Close</Button>
              {onPrint && (
                <Button className="w-full sm:flex-1" onClick={() => onPrint(done.new_sale_id)}>
                  <Printer className="h-4 w-4" /> Print new bill
                </Button>
              )}
            </div>
          </div>
        ) : sale && closed ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            This bill is already {sale.status === "void" ? "cancelled" : "fully returned"} — nothing left to exchange.
          </p>
        ) : sale ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
              <span className="font-mono font-medium">{sale.invoice_no}</span>
              <span className="text-muted-foreground">{new Date(sale.created_at).toLocaleDateString("en-GB")}</span>
              {sale.owner?.full_name && <span className="text-muted-foreground">{sale.owner.full_name}</span>}
              {until && <span className="ml-auto text-xs text-muted-foreground">Exchange until {until.toLocaleDateString("en-GB")}</span>}
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Items coming back</h3>
              <div className="divide-y rounded-lg border">
                {items.map((it) => {
                  const max = Number(it.quantity) - Number(it.returned_quantity);
                  const qn = backQty[it.id] ?? 0;
                  const step = Number.isInteger(Number(it.quantity)) && Number.isInteger(max) ? 1 : 0.5;
                  return (
                    <div key={it.id} className="flex items-center gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{it.name}</p>
                        <p className="text-xs text-muted-foreground">Sold {Number(it.quantity)} · can return {max}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Less ${it.name}`} disabled={max <= 0 || qn <= 0} onClick={() => setBack(it.id, -step, max)}><Minus className="h-3 w-3" /></Button>
                        <span className="w-8 text-center text-sm tabular-nums">{qn}</span>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`More ${it.name}`} disabled={max <= 0 || qn >= max} onClick={() => setBack(it.id, step, max)}><Plus className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">New items</h3>
                <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Business">
                  {PROJECTS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      role="tab"
                      aria-selected={project === p.key}
                      disabled={lines.length > 0 && project !== p.key}
                      onClick={() => setProject(p.key)}
                      className={`rounded px-2.5 py-1 text-xs ${project === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground disabled:opacity-40"}`}
                    >
                      {p.short}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search product to give" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search product" />
                {results.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                    {results.map((p) => (
                      <button key={p.id} type="button" onClick={() => addProduct(p)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted">
                        <span className="truncate">{p.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{tk(priceOf(p))} · stock {Number(p.stock_quantity)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {lines.length > 0 && (
                <div className="divide-y rounded-lg border">
                  {lines.map((l, i) => (
                    <div key={l.product.id} className="flex items-center gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.product.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{tk(priceOf(l.product))} each · {tk(priceOf(l.product) * l.quantity)}</p>
                      </div>
                      <Input
                        type="number" inputMode="decimal" min={0} step="1" aria-label={`Quantity ${l.product.name}`}
                        className="h-8 w-16 text-center"
                        value={l.quantity}
                        onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Math.max(0, Number(e.target.value) || 0) } : x)))}
                      />
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove ${l.product.name}`}
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-1 rounded-lg border bg-primary/5 p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Items back</span><span className="tabular-nums">{tk(returnValue)}</span></div>
              {dueCleared > 0.004 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Clears unpaid due on {sale.invoice_no}</span><span className="tabular-nums">− {tk(dueCleared)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">New items</span><span className="tabular-nums">{tk(newTotal)}</span></div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <span>{diff > 0.004 ? "Customer pays" : diff < -0.004 ? "Customer gets back" : "Even exchange"}</span>
                <span className="tabular-nums">{tk(Math.abs(diff))}</span>
              </div>

              {diff > 0.004 && (
                <div className="grid gap-2 pt-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="ex-pay-method">Paid by</Label>
                    <select id="ex-pay-method" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={payMethod} onChange={(e) => setPayMethod(e.target.value as Pay)}>
                      {PAY.map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ex-pay-amount">Received</Label>
                    <Input id="ex-pay-amount" type="number" inputMode="decimal" className="h-9 text-right tabular-nums" placeholder={diff.toFixed(2)}
                      value={payAmount} onChange={(e) => setPayAmount(e.target.value === "" ? "" : Number(e.target.value))} />
                  </div>
                  {leftDue > 0.009 && (
                    <p className={`text-xs sm:col-span-2 ${ownerId ? "text-destructive" : "text-destructive font-medium"}`}>
                      {sale.owner?.due_allowed ? `${tk(leftDue)} stays as due on the new bill.` : "Due is closed — the full difference must be paid."}
                    </p>
                  )}
                </div>
              )}

              {diff < -0.004 && (
                <fieldset className="space-y-2 pt-2">
                  <legend className="sr-only">What to do with the difference</legend>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="ex-left" className="h-4 w-4" checked={leftover === "refund"} onChange={() => setLeftover("refund")} />
                    <span>Pay back now</span>
                    <select aria-label="Pay back method" className="ml-auto h-8 rounded-md border bg-background px-2 text-sm" value={refundMethod}
                      disabled={leftover !== "refund"} onChange={(e) => setRefundMethod(e.target.value as Pay)}>
                      {PAY.map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
                    </select>
                  </label>
                  <label className={`flex items-center gap-2 ${ownerId ? "" : "opacity-50"}`}>
                    <input type="radio" name="ex-left" className="h-4 w-4" disabled={!ownerId} checked={leftover === "credit"} onChange={() => setLeftover("credit")} />
                    <span>Keep as store credit on the customer's account</span>
                  </label>
                  {!ownerId && <p className="text-xs text-muted-foreground">Store credit needs a customer on the bill.</p>}
                  {ownerId && creditBalance > 0.004 && (
                    <p className="text-xs text-muted-foreground">Customer already has {tk(creditBalance)} store credit.</p>
                  )}
                </fieldset>
              )}
            </section>

            <div className="space-y-1">
              <Label htmlFor="ex-reason">Reason <span className="text-destructive">*</span></Label>
              <Textarea id="ex-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong size, customer wants a different brand" />
            </div>

            {problem && (backCount > 0 || lines.length > 0 || !shiftOpen) && <p className="text-sm text-destructive">{problem}</p>}
            <Button className="w-full" size="lg" disabled={!!problem || run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? "Exchanging…" : "Confirm exchange"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading bill…</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
