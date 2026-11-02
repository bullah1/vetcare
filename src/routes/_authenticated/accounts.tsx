import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Wallet, Plus, TrendingUp, TrendingDown, Receipt, AlertCircle, Printer, Search, CheckCircle2, X, Lock } from "lucide-react";
import { printExpenseVoucher } from "@/lib/expense-voucher";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { refreshAppData } from "@/lib/refresh-data";
import { fetchAll } from "@/lib/fetch-all";
import { dayRangeISO, todayDhaka } from "@/lib/sales-ledger";
import { BusinessPicker } from "@/components/BusinessPicker";
import { useProductCategories } from "@/lib/product-categories";
import { PROJECTS } from "@/lib/projects";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "Accounts — Pet Care Vet ERP" }] }),
  component: AccountsPage,
});

const PAYMENT_METHODS = ["cash", "bkash", "nagad", "rocket", "card", "bank"] as const;

type Expense = {
  id: string;
  category: string;
  amount: number;
  method: string;
  paid_to: string | null;
  notes: string | null;
  expense_date: string;
  created_at?: string;
  /** EXP-YYYYMM-##### — given by the database (after the expense voucher SQL). */
  voucher_no?: string | null;
  /** The biller's own receipt / bill number. */
  ref_no?: string | null;
  purchase_invoice_id?: string | null;
  /** pcv / ss, or null = shared by both businesses (column exists after the Projects SQL). */
  project?: string | null;
};
type ExpBusiness = "pcv" | "ss" | "shared";
type Cancelled = {
  id: string; voucher_no: string | null; category: string; amount: number; method: string;
  paid_to: string | null; expense_date: string; reason: string | null; cancelled_at: string;
};
const expBusinessLabel = (p?: string | null) => PROJECTS.find((x) => x.key === p)?.short ?? "Shared";

type Sale = {
  id: string;
  invoice_no: string;
  owner_id: string | null;
  total: number;
  paid: number;
  due: number;
  status: string;
  created_at: string;
};

type Payment = { id: string; amount: number; method: string; received_at: string; sale_id: string | null };

const EXPENSE_CATEGORIES = ["Utilities", "Rent", "Salary", "Supplies", "Equipment", "Marketing", "Transport", "Doctor Fee", "Clinic", "Delivery", "Courier", "Other"];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Date range for a quick pick, from today's Dhaka date. */
function presetRange(k: string): [string, string] | null {
  const [y, m] = todayDhaka().split("-").map(Number);
  if (k === "today") return [todayDhaka(), todayDhaka()];
  if (k === "month") return [ymd(new Date(y, m - 1, 1)), todayDhaka()];
  if (k === "last") return [ymd(new Date(y, m - 2, 1)), ymd(new Date(y, m - 1, 0))];
  if (k === "year") return [`${y}-01-01`, todayDhaka()];
  return null;
}

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const today = todayDhaka;

function AccountsPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<{ id: string; amount: number }[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [owners, setOwners] = useState<{ id: string; full_name: string }[]>([]);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [openExp, setOpenExp] = useState(false);
  const [openShift, setOpenShift] = useState<{ shift_id: string; expected_cash: number } | null>(null);
  /** Last cash drawer close: expenses entered before it are locked (no cancel). */
  const [lastClose, setLastClose] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState<Cancelled[]>([]);
  const [showCancelled, setShowCancelled] = useState(false);
  const [cancelFor, setCancelFor] = useState<Expense | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  // The Projects SQL adds expenses.project; the categories table comes with it.
  const { available: hasProjects } = useProductCategories();
  const [expBusiness, setExpBusiness] = useState<ExpBusiness>("shared");
  const setExpenseBusiness = async (e: Expense, b: ExpBusiness) => {
    const project = b === "shared" ? null : b;
    const { error } = await (supabase as any).from("expenses").update({ project }).eq("id", e.id);
    if (error) return toast.error(error.message);
    setExpenses((list) => list.map((x) => (x.id === e.id ? { ...x, project } : x)));
    toast.success(`Expense moved to ${b === "shared" ? "Shared" : expBusinessLabel(b)}`);
  };

  const [expForm, setExpForm] = useState({
    category: "Utilities",
    amount: "",
    method: "cash",
    paid_to: "",
    notes: "",
    ref_no: "",
    expense_date: today(),
  });
  /** The expense just saved — the dialog then shows its voucher. */
  const [savedExp, setSavedExp] = useState<Expense | null>(null);
  const [expQ, setExpQ] = useState("");
  const [expBizFilter, setExpBizFilter] = useState<"all" | ExpBusiness>("all");
  const [expCat, setExpCat] = useState("all");
  const preset = (["today", "month", "last", "year"].find((k) => { const r = presetRange(k); return r && r[0] === from && r[1] === to; }) ?? "custom");

  const load = async () => {
    // Dhaka business-day bounds (the old `${from}T00:00:00` strings were read
    // as UTC, shifting every day by 6 hours) and paged reads (1000-row cap).
    const { fromISO, toISO } = dayRangeISO(from, to);
    try {
      const [e, s, p, o, sp] = await Promise.all([
        fetchAll<Expense>(() => supabase.from("expenses").select("*").gte("expense_date", from).lte("expense_date", to).order("expense_date", { ascending: false }).order("created_at", { ascending: false }).order("id")),
        fetchAll<Sale>(() => supabase.from("sales").select("*").gte("created_at", fromISO).lte("created_at", toISO).order("created_at", { ascending: false }).order("id")),
        fetchAll<Payment>(() => supabase.from("payments").select("*").gte("received_at", fromISO).lte("received_at", toISO).order("id")),
        fetchAll<{ id: string; full_name: string }>(() => supabase.from("pet_owners").select("id,full_name").order("id"), 200000),
        fetchAll<{ id: string; amount: number }>(() => supabase.from("supplier_payments").select("id,amount").gte("paid_at", from).lte("paid_at", to).order("id")),
      ]);
      setExpenses(e);
      setSales(s);
      setPayments(p);
      setOwners(o);
      setSupplierPayments(sp);
      const [lc, cx] = await Promise.all([
        supabase.from("cash_shifts").select("closed_at").eq("status", "closed").order("closed_at", { ascending: false }).limit(1),
        // Comes with the expense cancel SQL; empty before it.
        (supabase as any).from("expense_cancellations").select("id,voucher_no,category,amount,method,paid_to,expense_date,reason,cancelled_at")
          .gte("expense_date", from).lte("expense_date", to).order("cancelled_at", { ascending: false }),
      ]);
      setLastClose((lc.data?.[0] as { closed_at: string | null } | undefined)?.closed_at ?? null);
      setCancelled(cx.error ? [] : (cx.data ?? []));
    } catch (err: any) {
      toast.error(err?.message ?? "Could not load accounts");
    }
  };

  useEffect(() => { load(); }, [from, to]);

  useEffect(() => {
    let mounted = true;
    const checkShift = async () => {
      const { data, error } = await supabase.rpc("cash_shift_summary", { _shift_id: undefined });
      if (!mounted) return;
      if (error || !data || (data as any).status !== "open") setOpenShift(null);
      else setOpenShift({ shift_id: (data as any).shift_id, expected_cash: (data as any).expected_cash });
    };
    checkShift();
    return () => { mounted = false; };
  }, [openExp]);

  const totals = useMemo(() => {
    const income = payments.reduce((a, p) => a + Number(p.amount), 0);
    // Cancelled invoices are not revenue; returned value is already netted out
    // of paid + due by the server.
    const live = sales.filter((s) => s.status !== "void");
    const revenue = live.reduce((a, s) => a + Number(s.paid) + Number(s.due), 0);
    const due = live.reduce((a, s) => a + Number(s.due), 0);
    // Purchases are never expenses — they move money via supplier payments
    const purchases = supplierPayments.reduce((a, p) => a + Number(p.amount), 0);
    const opex = expenses.reduce((a, e) => a + Number(e.amount), 0);
    const exp = purchases + opex;
    return { income, revenue, due, exp, purchases, opex, net: income - exp };
  }, [expenses, sales, payments, supplierPayments]);

  const dueByOwner = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach(s => {
      if (s.status !== "void" && Number(s.due) > 0 && s.owner_id) map.set(s.owner_id, (map.get(s.owner_id) || 0) + Number(s.due));
    });
    return Array.from(map.entries()).map(([owner_id, due]) => ({
      owner_id,
      name: owners.find(o => o.id === owner_id)?.full_name || "—",
      due,
    })).sort((a, b) => b.due - a.due);
  }, [sales, owners]);

  const saveExpense = async () => {
    if (!expForm.amount) return toast.error("Amount required");
    if (expForm.method === "cash" && !openShift) {
      return toast.error("No open cash shift. Open a shift from Cash Drawer before recording cash expenses.");
    }
    if (!(Number(expForm.amount) > 0)) return toast.error("Amount must be above 0");
    const row = {
      category: expForm.category,
      amount: Number(expForm.amount),
      method: expForm.method as never,
      paid_to: expForm.paid_to.trim() || null,
      notes: expForm.notes.trim() || null,
      expense_date: expForm.expense_date,
      ...(hasProjects ? { project: expBusiness === "shared" ? null : expBusiness } : {}),
    };
    // ref_no / voucher_no come with the expense voucher SQL; save without them before it.
    let { data, error } = await (supabase as any).from("expenses")
      .insert({ ...row, ...(expForm.ref_no.trim() ? { ref_no: expForm.ref_no.trim() } : {}) }).select("*").single();
    if (error && /ref_no/.test(error.message ?? "")) ({ data, error } = await (supabase as any).from("expenses").insert(row).select("*").single());
    if (error) return toast.error(error.message);
    toast.success(data?.voucher_no ? `Expense saved — voucher ${data.voucher_no}` : "Expense recorded");
    refreshAppData();
    setSavedExp(data as Expense);
    setExpForm({ ...expForm, amount: "", paid_to: "", notes: "", ref_no: "" });
    load();
  };

  const expCategories = useMemo(
    () => Array.from(new Set([...EXPENSE_CATEGORIES, ...expenses.map((e) => e.category)])),
    [expenses],
  );
  const shownExpenses = useMemo(() => {
    const q = expQ.trim().toLowerCase();
    return expenses.filter((e) =>
      (expBizFilter === "all" || (e.project ?? "shared") === expBizFilter) &&
      (expCat === "all" || e.category === expCat) &&
      (!q || [e.voucher_no, e.ref_no, e.paid_to, e.notes, e.category].some((v) => (v ?? "").toLowerCase().includes(q))),
    );
  }, [expenses, expQ, expBizFilter, expCat]);
  const expTotal = shownExpenses.reduce((a, e) => a + Number(e.amount), 0);
  const expByCat = useMemo(() => {
    const m = new Map<string, number>();
    shownExpenses.forEach((e) => m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [shownExpenses]);
  const hasVoucher = expenses.some((e) => "voucher_no" in e);
  const fromPurchase = (e: Expense) => !!e.purchase_invoice_id || e.category === "Purchase" || e.category === "Supplier Payment";
  const isLocked = (e: Expense) => !!lastClose && !!e.created_at && new Date(e.created_at).getTime() <= new Date(lastClose).getTime();
  const cancelExpense = async () => {
    if (!cancelFor) return;
    setCancelling(true);
    const { data, error } = await (supabase.rpc as any)("cancel_expense", { _expense_id: cancelFor.id, _reason: cancelReason.trim() || null });
    setCancelling(false);
    if (error) {
      const missing = error.code === "PGRST202" || /cancel_expense/.test(error.message ?? "");
      return toast.error(missing ? "Run the expense cancel SQL in Supabase first." : error.message);
    }
    toast.success(`Expense ${data?.voucher_no ?? ""} cancelled`.replace("  ", " "));
    setCancelFor(null);
    setCancelReason("");
    refreshAppData();
    load();
  };


  return (
    <div className="p-0 sm:p-2">
      <PageHeader
        title="Accounts"
        description="Cashbook, income, expenses & customer dues"
        icon={Wallet}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={preset} onValueChange={(k) => { const r = presetRange(k); if (r) { setFrom(r[0]); setTo(r[1]); } }}>
              <SelectTrigger className="h-9 w-36" aria-label="Period"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="last">Last month</SelectItem>
                <SelectItem value="year">This year</SelectItem>
                <SelectItem value="custom" disabled>Custom dates</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full min-w-0 sm:w-40" />
            <span className="text-muted-foreground text-sm">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full min-w-0 sm:w-40" />
            <Dialog open={openExp} onOpenChange={(v) => { setOpenExp(v); if (!v) setSavedExp(null); }}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" /> Expense</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{savedExp ? "Expense saved" : "Record Expense"}</DialogTitle></DialogHeader>
                {savedExp ? (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                      <div className="min-w-0 flex-1 space-y-1 text-sm">
                        <div className="text-xs text-muted-foreground">Voucher no.</div>
                        <div className="font-mono text-lg font-semibold">{savedExp.voucher_no ?? "—"}</div>
                        <div>{savedExp.category} · {fmt(savedExp.amount)} · <span className="capitalize">{savedExp.method}</span></div>
                        {savedExp.paid_to && <div className="text-muted-foreground">Paid to {savedExp.paid_to}</div>}
                      </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-2">
                      <Button variant="outline" onClick={() => setSavedExp(null)}><Plus className="h-4 w-4 mr-1" /> Add another</Button>
                      <Button onClick={() => printExpenseVoucher(savedExp)}><Printer className="h-4 w-4 mr-1" /> Print voucher</Button>
                    </DialogFooter>
                  </div>
                ) : (<>
                <div className="grid gap-3">
                  <p className="-mt-1 text-xs text-muted-foreground">A voucher number (EXP-…) is given when you save.</p>
                  {hasProjects && (
                    <div className="space-y-1.5">
                      <Label>Business</Label>
                      <BusinessPicker<ExpBusiness> value={expBusiness} onChange={setExpBusiness}
                        extra={{ value: "shared", label: "Shared", hint: "For both — split by each business's sales" }} />
                      {expBusiness === "shared" && <p className="text-xs text-muted-foreground">Shared costs (rent, electricity, salary) are split between the two businesses by their sales.</p>}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div><Label>Category</Label>
                      <Select value={expForm.category} onValueChange={(v) => setExpForm({ ...expForm, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {EXPENSE_CATEGORIES.map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Amount (৳)</Label>
                      <Input type="number" inputMode="decimal" min={0} autoFocus value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div><Label>Method</Label>
                      <Select value={expForm.method} onValueChange={(v) => setExpForm({ ...expForm, method: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map(m => (
                            <SelectItem key={m} value={m}>{m.replace(/^\w/, c => c.toUpperCase())}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Date</Label>
                      <Input type="date" value={expForm.expense_date} onChange={(e) => setExpForm({ ...expForm, expense_date: e.target.value })} />
                    </div>
                  </div>
                  {expForm.method === "cash" && !openShift && (
                    <Alert variant="destructive" className="py-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        No open cash shift. Cash expenses will affect the drawer only after you open a shift in <b>Cash Drawer</b>.
                      </AlertDescription>
                    </Alert>
                  )}
                  {expForm.method === "cash" && openShift && (
                    <Alert className="py-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        This will reduce the current open drawer by <b>৳{expForm.amount || "0"}</b>.
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div><Label>Paid To</Label><Input placeholder="Person or shop" value={expForm.paid_to} onChange={(e) => setExpForm({ ...expForm, paid_to: e.target.value })} /></div>
                    <div><Label>Bill / receipt no <span className="font-normal text-muted-foreground">(optional)</span></Label><Input placeholder="Their bill number" value={expForm.ref_no} onChange={(e) => setExpForm({ ...expForm, ref_no: e.target.value })} /></div>
                  </div>
                  <div><Label>Description</Label><Textarea rows={2} placeholder="What was it for?" value={expForm.notes} onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })} /></div>

                </div>
                <DialogFooter><Button onClick={saveExpense}>Save expense</Button></DialogFooter>
                </>)}
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Revenue" value={fmt(totals.revenue)} icon={Receipt} />
        <StatCard label="Cash In" value={fmt(totals.income)} icon={TrendingUp} tone="ok" />
        <StatCard label="Purchases" value={fmt(totals.purchases)} icon={TrendingDown} tone="warn" />
        <StatCard label="Op. Expenses" value={fmt(totals.opex)} icon={TrendingDown} tone="warn" />
        <StatCard label="Net Cash" value={fmt(totals.net)} icon={Wallet} tone={totals.net >= 0 ? "ok" : "warn"} />
      </div>


      <Tabs defaultValue="cashbook">
        <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto">
          <TabsTrigger value="cashbook">Cashbook</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="dues">Customer Dues</TabsTrigger>
        </TabsList>

        <TabsContent value="cashbook">
          <Card><CardHeader><CardTitle>Payments Received</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Invoice</TableHead>
                  <TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {payments.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No payments in range</TableCell></TableRow>}
                  {payments.map(p => {
                    const inv = sales.find(s => s.id === p.sale_id)?.invoice_no || "—";
                    return (
                      <TableRow key={p.id}>
                        <TableCell>{new Date(p.received_at).toLocaleString()}</TableCell>
                        <TableCell className="font-mono text-xs">{inv}</TableCell>
                        <TableCell><Badge variant="secondary">{p.method}</Badge></TableCell>
                        <TableCell className="text-right">{fmt(p.amount)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle>Expense Ledger</CardTitle>
                <div className="text-sm text-muted-foreground">
                  {shownExpenses.length} voucher{shownExpenses.length === 1 ? "" : "s"} · <span className="font-semibold text-foreground">{fmt(expTotal)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="h-9 pl-8" placeholder="Voucher, paid to, description…" value={expQ} onChange={(e) => setExpQ(e.target.value)} />
                </div>
                {hasProjects && (
                  <Select value={expBizFilter} onValueChange={(v) => setExpBizFilter(v as "all" | ExpBusiness)}>
                    <SelectTrigger className="h-9 w-40" aria-label="Business filter"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All businesses</SelectItem>
                      {PROJECTS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                      <SelectItem value="shared">Shared</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Select value={expCat} onValueChange={setExpCat}>
                  <SelectTrigger className="h-9 w-40" aria-label="Category filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {expCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {expByCat.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {expByCat.map(([c, v]) => (
                    <button key={c} type="button" onClick={() => setExpCat(expCat === c ? "all" : c)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${expCat === c ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                      {c} <span className="font-semibold">{fmt(v)}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  {hasVoucher && <TableHead>Voucher</TableHead>}
                  <TableHead>Date</TableHead>{hasProjects && <TableHead>Business</TableHead>}<TableHead>Category</TableHead>
                  <TableHead>Paid To / Description</TableHead><TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead><TableHead className="w-10" />
                </TableRow></TableHeader>
                <TableBody>
                  {shownExpenses.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">{expenses.length ? "No expenses match the filter" : "No expenses in this period — pick another period above"}</TableCell></TableRow>}
                  {shownExpenses.map(e => (
                    <TableRow key={e.id}>
                      {hasVoucher && <TableCell className="whitespace-nowrap font-mono text-xs">{e.voucher_no ?? "—"}</TableCell>}
                      <TableCell className="whitespace-nowrap">{new Date(`${e.expense_date}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                      {hasProjects && (
                        <TableCell>
                          <Select value={e.project ?? "shared"} onValueChange={(v) => void setExpenseBusiness(e, v as ExpBusiness)}>
                            <SelectTrigger className="h-8 w-36" aria-label="Business"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PROJECTS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                              <SelectItem value="shared">Shared</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      )}
                      <TableCell>{e.category}</TableCell>
                      <TableCell className="max-w-xs">
                        <div>{e.paid_to || <span className="text-muted-foreground">—</span>}</div>
                        {(e.notes || e.ref_no) && (
                          <div className="truncate text-xs text-muted-foreground">
                            {e.ref_no && <>Bill {e.ref_no}{e.notes ? " · " : ""}</>}{e.notes}
                          </div>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="secondary" className="capitalize">{e.method}</Badge></TableCell>
                      <TableCell className="text-right font-medium">{fmt(e.amount)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Print voucher ${e.voucher_no ?? ""}`} title="Print voucher" onClick={() => printExpenseVoucher(e)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                          {fromPurchase(e) ? (
                            <span className="w-8" title="From a purchase — change it from Purchases" />
                          ) : isLocked(e) ? (
                            <span className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground" title="Cash drawer closed — cannot be cancelled" aria-label="Locked: cash drawer closed">
                              <Lock className="h-3.5 w-3.5" />
                            </span>
                          ) : (
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" aria-label={`Cancel expense ${e.voucher_no ?? ""}`} title="Cancel expense" onClick={() => { setCancelFor(e); setCancelReason(""); }}>
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {shownExpenses.length > 1 && (
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell colSpan={(hasVoucher ? 1 : 0) + (hasProjects ? 1 : 0) + 4}>Total</TableCell>
                      <TableCell className="text-right">{fmt(expTotal)}</TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {lastClose && expenses.some(isLocked) && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" /> Expenses entered before the last cash drawer close ({new Date(lastClose).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}) are locked and cannot be cancelled.
                </p>
              )}
              {cancelled.length > 0 && (
                <div className="mt-4 rounded-lg border">
                  <button type="button" onClick={() => setShowCancelled((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-sm">
                    <span>Cancelled vouchers <span className="text-muted-foreground">({cancelled.length})</span></span>
                    <span className="text-xs text-muted-foreground">{showCancelled ? "Hide" : "Show"}</span>
                  </button>
                  {showCancelled && (
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Voucher</TableHead><TableHead>Date</TableHead><TableHead>Category</TableHead>
                        <TableHead>Reason</TableHead><TableHead>Cancelled</TableHead><TableHead className="text-right">Amount</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {cancelled.map((c) => (
                          <TableRow key={c.id} className="text-muted-foreground">
                            <TableCell className="font-mono text-xs line-through">{c.voucher_no ?? "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{c.expense_date}</TableCell>
                            <TableCell>{c.category}{c.paid_to ? ` · ${c.paid_to}` : ""}</TableCell>
                            <TableCell>{c.reason || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{new Date(c.cancelled_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</TableCell>
                            <TableCell className="text-right line-through">{fmt(c.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          <Dialog open={!!cancelFor} onOpenChange={(v) => { if (!v) setCancelFor(null); }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Cancel expense {cancelFor?.voucher_no ?? ""}</DialogTitle></DialogHeader>
              {cancelFor && (
                <div className="space-y-3 text-sm">
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <div className="font-medium">{cancelFor.category} · {fmt(cancelFor.amount)} · <span className="capitalize">{cancelFor.method}</span></div>
                    <div className="text-muted-foreground">{cancelFor.paid_to || "—"}{cancelFor.notes ? ` · ${cancelFor.notes}` : ""}</div>
                  </div>
                  <p className="text-muted-foreground">
                    The expense is removed from accounts{cancelFor.method === "cash" ? <> and <b>{fmt(cancelFor.amount)}</b> goes back into the cash drawer</> : ""}. The voucher stays in the cancelled list.
                  </p>
                  <div><Label>Reason</Label><Input autoFocus placeholder="e.g. Wrong amount, entered twice" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></div>
                </div>
              )}
              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" onClick={() => setCancelFor(null)}>Keep expense</Button>
                <Button variant="destructive" disabled={cancelling} onClick={() => void cancelExpense()}>{cancelling ? "Cancelling…" : "Cancel expense"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="dues">
          <Card><CardHeader><CardTitle>Customer Dues (in range)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Customer</TableHead><TableHead className="text-right">Due</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {dueByOwner.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-8">No outstanding dues</TableCell></TableRow>}
                  {dueByOwner.map(d => (
                    <TableRow key={d.owner_id}>
                      <TableCell>{d.name}</TableCell>
                      <TableCell className="text-right font-medium text-destructive">{fmt(d.due)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Wallet; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-destructive" : "text-primary";
  return (
    <Card><CardContent className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-lg bg-muted flex items-center justify-center ${color}`}><Icon className="h-5 w-5" /></div>
      <div><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-semibold">{value}</div></div>
    </CardContent></Card>
  );
}
