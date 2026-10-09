import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Users, Search, RotateCcw, Wallet, ChevronDown, ChevronRight, Phone, ExternalLink, FileDown } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { exportToExcel } from "@/lib/export-excel";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollectDueDialog } from "@/components/CollectDueDialog";
import { CustomerTimeline } from "@/components/CustomerTimeline";
import { CustomerLedger } from "@/components/CustomerLedger";
import { NewCustomerDialog } from "@/components/NewCustomerDialog";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/receivables")({
  head: () => ({
    meta: [
      { title: "Customers — History & Dues | Pet Care Vet ERP" },
      { name: "description", content: "See every customer with their purchase history, total spend and outstanding dues, and collect payments in one place." },
      { property: "og:title", content: "Customers — History & Dues | Pet Care Vet ERP" },
      { property: "og:description", content: "Customer purchase history, ledger and due collection in one screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomersPage,
});

type SaleRow = {
  id: string;
  invoice_no: string;
  created_at: string;
  total: number;
  paid: number;
  due: number;
  status: string;
  owner_id: string | null;
  owner: { id: string; full_name: string; phone: string | null } | null;
};

type Owner = { id: string; full_name: string; phone: string | null; created_at: string };

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const daysAgo = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

function CustomersPage() {
  const [q, setQ] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dueSale, setDueSale] = useState<SaleRow | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["customers-ledger"],
    queryFn: async () => {
      // Paged reads: the API caps a response at 1000 rows, so older invoices
      // (and their dues) and customers beyond the first 1000 were missing.
      const [sales, owners] = await Promise.all([
        fetchAll<SaleRow>(
          () =>
            supabase
              .from("sales")
              .select("id,invoice_no,created_at,total,paid,due,status,owner_id, owner:pet_owners(id,full_name,phone)")
              .order("created_at", { ascending: false })
              .order("id"),
          200000,
        ),
        fetchAll<Owner>(
          () => supabase.from("pet_owners").select("id,full_name,phone,created_at").order("full_name").order("id"),
          200000,
        ),
      ]);
      return { sales, owners };
    },
  });

  const sales = data?.sales ?? [];
  const owners = data?.owners ?? [];

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; phone: string | null; due: number; spent: number; sales: SaleRow[] }>();
    for (const o of owners) {
      map.set(o.id, { key: o.id, name: o.full_name, phone: o.phone, due: 0, spent: 0, sales: [] });
    }
    for (const s of sales) {
      const key = s.owner?.id ?? "walkin";
      const g = map.get(key) ?? {
        key,
        name: s.owner?.full_name ?? "Walk-in customer",
        phone: s.owner?.phone ?? null,
        due: 0,
        spent: 0,
        sales: [],
      };
      if (s.status !== "void") {
        g.due += Number(s.due);
        // paid + due = invoice value after returns (gross total overstated
        // spend for partly / fully returned invoices).
        g.spent += Number(s.paid) + Number(s.due);
      }
      g.sales.push(s);
      map.set(key, g);
    }
    let list = [...map.values()].sort((a, b) => b.due - a.due || b.spent - a.spent);
    if (onlyDue) list = list.filter((g) => g.due > 0);
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (g) =>
        g.name.toLowerCase().includes(term) ||
        (g.phone ?? "").includes(term) ||
        g.sales.some((s) => s.invoice_no.toLowerCase().includes(term)),
    );
  }, [sales, owners, q, onlyDue]);

  const totals = useMemo(() => {
    const due = groups.reduce((a, g) => a + g.due, 0);
    const spent = groups.reduce((a, g) => a + g.spent, 0);
    const withDue = groups.filter((g) => g.due > 0).length;
    return { customers: groups.length, withDue, due, spent };
  }, [groups]);

  return (
    <div className="p-0 sm:p-2">
      <PageHeader
        title="Customers"
        description="Customer list — purchase history, total spend and dues in one place"
        icon={Users}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RotateCcw className="h-4 w-4" /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (groups.length === 0) return;
                exportToExcel(
                  groups.map((g) => ({
                    Customer: g.name,
                    Phone: g.phone ?? "",
                    Purchases: g.sales.length,
                    "Last Visit": g.sales[0] ? format(new Date(g.sales[0].created_at), "dd MMM yyyy") : "",
                    "Lifetime Spend": g.spent,
                    Due: g.due,
                  })),
                  "customer-list",
                  "Customers",
                );
              }}
            >
              <FileDown className="h-4 w-4" /> Excel
            </Button>
            <NewCustomerDialog onCreated={() => refetch()} />
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total customers</div><div className="text-xl sm:text-2xl font-semibold">{totals.customers}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Customers with due</div><div className="text-xl sm:text-2xl font-semibold text-amber-600">{totals.withDue}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Lifetime sales</div><div className="text-xl sm:text-2xl font-semibold">{fmt(totals.spent)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total receivable</div><div className="text-xl sm:text-2xl font-semibold text-destructive">{fmt(totals.due)}</div></CardContent></Card>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by customer name, phone or invoice no"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button variant={onlyDue ? "default" : "outline"} onClick={() => setOnlyDue((v) => !v)}>
            <Wallet className="h-4 w-4" /> Only with due
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Purchases</TableHead>
                <TableHead className="text-right">Last visit</TableHead>
                <TableHead className="text-right">Lifetime</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!isFetching && groups.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No customer found.</TableCell></TableRow>
              )}
              {groups.map((g) => {
                const last = g.sales[0];
                const open = expanded === g.key;
                return (
                  <Fragment key={g.key}>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpanded(open ? null : g.key)}>
                      <TableCell>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                      <TableCell>
                        <div className="font-medium">{g.name}</div>
                        {g.phone && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {g.phone}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{g.sales.length}</TableCell>
                      <TableCell className="text-right">
                        {last ? (
                          <span className="text-xs text-muted-foreground">{format(new Date(last.created_at), "dd MMM yyyy")} · {daysAgo(last.created_at)}d</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(g.spent)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {g.due > 0 ? <span className="text-destructive">{fmt(g.due)}</span> : <Badge variant="secondary">Clear</Badge>}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {g.key !== "walkin" && (
                          <Button size="sm" variant="outline" asChild>
                            <Link to="/customers/$id" params={{ id: g.key }}>
                              <ExternalLink className="h-4 w-4" /> Profile
                            </Link>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>


                    {open && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={7} className="p-0">
                          <div className="p-3">
                            <Tabs defaultValue="timeline">
                              <TabsList>
                                <TabsTrigger value="timeline">History timeline</TabsTrigger>
                                <TabsTrigger value="ledger">Ledger</TabsTrigger>
                                <TabsTrigger value="invoices">Invoices ({g.sales.length})</TabsTrigger>
                              </TabsList>

                              <TabsContent value="timeline" className="pt-3">
                                <CustomerTimeline ownerId={g.key} />
                              </TabsContent>

                              <TabsContent value="ledger" className="pt-3">
                                <CustomerLedger ownerId={g.key} customerName={g.name} customerPhone={g.phone} />
                              </TabsContent>


                              <TabsContent value="invoices" className="pt-3">
                            {g.sales.length === 0 ? (
                              <div className="text-sm text-muted-foreground py-4 text-center">This customer has no purchases.</div>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Invoice</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-right">Paid</TableHead>
                                    <TableHead className="text-right">Due</TableHead>

                                    <TableHead className="text-right">Action</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {g.sales.map((s) => (
                                    <TableRow key={s.id}>
                                      <TableCell>
                                        <div className="font-medium">{s.invoice_no}</div>
                                        <div className="text-xs text-muted-foreground">
                                          {format(new Date(s.created_at), "dd MMM yyyy, hh:mm a")} · {daysAgo(s.created_at)} days
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <Badge variant="secondary" className={s.status === "void" ? "line-through text-destructive" : ""}>
                                          {s.status.replace("_", " ")}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums">{fmt(Number(s.total))}</TableCell>
                                      <TableCell className="text-right tabular-nums text-emerald-600">{fmt(Number(s.paid))}</TableCell>
                                      <TableCell className="text-right tabular-nums text-destructive">{Number(s.due) > 0 ? fmt(Number(s.due)) : "—"}</TableCell>
                                      <TableCell className="text-right">
                                        {Number(s.due) > 0 && s.status !== "void" && (
                                          <Button size="sm" variant="outline" onClick={() => setDueSale(s)}>
                                            <Wallet className="h-4 w-4" /> Collect
                                          </Button>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                              </TabsContent>
                            </Tabs>
                          </div>
                        </TableCell>

                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CollectDueDialog
        sale={dueSale ? { id: dueSale.id, invoice_no: dueSale.invoice_no, due: Number(dueSale.due), owner: dueSale.owner } : null}
        open={!!dueSale}
        onOpenChange={(o) => !o && setDueSale(null)}
        onCollected={() => { setDueSale(null); refetch(); }}
      />
    </div>
  );
}
