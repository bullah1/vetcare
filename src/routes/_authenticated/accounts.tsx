import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Wallet, Plus, TrendingUp, TrendingDown, Receipt, AlertCircle } from "lucide-react";
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
};

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

  const [expForm, setExpForm] = useState({
    category: "Utilities",
    amount: "",
    method: "cash",
    paid_to: "",
    notes: "",
    expense_date: today(),
  });

  const load = async () => {
    // Dhaka business-day bounds (the old `${from}T00:00:00` strings were read
    // as UTC, shifting every day by 6 hours) and paged reads (1000-row cap).
    const { fromISO, toISO } = dayRangeISO(from, to);
    try {
      const [e, s, p, o, sp] = await Promise.all([
        fetchAll<Expense>(() => supabase.from("expenses").select("*").gte("expense_date", from).lte("expense_date", to).order("expense_date", { ascending: false }).order("id")),
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
    const { error } = await supabase.from("expenses").insert({
      category: expForm.category,
      amount: Number(expForm.amount),
      method: expForm.method as never,
      paid_to: expForm.paid_to || null,
      notes: expForm.notes || null,
      expense_date: expForm.expense_date,
    });
    if (error) return toast.error(error.message);
    toast.success("Expense recorded");
    refreshAppData();
    setOpenExp(false);
    setExpForm({ ...expForm, amount: "", paid_to: "", notes: "" });
    load();
  };


  return (
    <div className="p-0 sm:p-2">
      <PageHeader
        title="Accounts"
        description="Cashbook, income, expenses & customer dues"
        icon={Wallet}
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full min-w-0 sm:w-40" />
            <span className="text-muted-foreground text-sm">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full min-w-0 sm:w-40" />
            <Dialog open={openExp} onOpenChange={setOpenExp}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" /> Expense</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Expense</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div><Label>Category</Label>
                      <Select value={expForm.category} onValueChange={(v) => setExpForm({ ...expForm, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["Utilities", "Rent", "Salary", "Supplies", "Equipment", "Marketing", "Transport", "Other"].map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Amount (৳)</Label>
                      <Input type="number" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
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
                  <div><Label>Paid To</Label><Input value={expForm.paid_to} onChange={(e) => setExpForm({ ...expForm, paid_to: e.target.value })} /></div>
                  <div><Label>Notes</Label><Textarea value={expForm.notes} onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })} /></div>

                </div>
                <DialogFooter><Button onClick={saveExpense}>Save</Button></DialogFooter>
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
          <Card><CardHeader><CardTitle>Expense Ledger</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Category</TableHead>
                  <TableHead>Paid To</TableHead><TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {expenses.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No expenses in range</TableCell></TableRow>}
                  {expenses.map(e => (
                    <TableRow key={e.id}>
                      <TableCell>{e.expense_date}</TableCell>
                      <TableCell>{e.category}</TableCell>
                      <TableCell>{e.paid_to || "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{e.method}</Badge></TableCell>
                      <TableCell className="text-right">{fmt(e.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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
