import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, CalendarClock, HandCoins, Mail, MapPin, Pencil, Phone, Repeat, RotateCcw, User, Wallet } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollectDueDialog } from "@/components/CollectDueDialog";
import { CustomerTimeline } from "@/components/CustomerTimeline";
import { CustomerLedger } from "@/components/CustomerLedger";
import { CustomerEditDialog } from "@/components/CustomerEditDialog";
import { CustomerPaymentDialog } from "@/components/CustomerPaymentDialog";
import { fetchCustomerProfileStats } from "@/lib/customer-mix";
import { daysSince } from "@/lib/customer-insights";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/customers/$id")({
  head: () => ({
    meta: [
      { title: "Customer profile — Dues & Invoices | Pet Care Vet ERP" },
      { name: "description", content: "Customer profile with current due, total paid, recent POS invoices, ledger and upcoming appointments." },
      { property: "og:title", content: "Customer profile — Dues & Invoices | Pet Care Vet ERP" },
      { property: "og:description", content: "Single customer view: due, payments, invoices and upcoming appointments." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerDetailPage,
});

type Sale = {
  id: string;
  invoice_no: string;
  created_at: string;
  total: number;
  paid: number;
  due: number;
  status: string;
};

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

function CustomerDetailPage() {
  const { id } = Route.useParams();
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [dueSale, setDueSale] = useState<Sale | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["customer-detail", id],
    queryFn: async () => {
      const [ownerRes, salesRes, apptRes, petsRes] = await Promise.all([
        supabase.from("pet_owners").select("id,full_name,phone,gender,email,address,notes,created_at").eq("id", id).maybeSingle(),
        // All invoices: totals below were summed over only the latest 200.
        fetchAll<Sale>(() =>
          supabase
            .from("sales")
            .select("id,invoice_no,created_at,total,paid,due,status")
            .eq("owner_id", id)
            .order("created_at", { ascending: false })
            .order("id"),
        ).then((data) => ({ data, error: null })),
        supabase
          .from("appointments")
          .select("id,scheduled_at,status,reason,pet_id,doctor:doctors(full_name)")
          .eq("owner_id", id)
          .gte("scheduled_at", new Date().toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(20),
        supabase.from("pets").select("id,name,species").eq("owner_id", id).limit(50),
      ]);
      if (ownerRes.error) throw ownerRes.error;
      return {
        owner: ownerRes.data,
        sales: (salesRes.data ?? []) as Sale[],
        appointments: (apptRes.data ?? []) as any[],
        pets: (petsRes.data ?? []) as any[],
      };
    },
  });

  const ownerPhone = data?.owner?.phone ?? null;
  const { data: purchase } = useQuery({
    queryKey: ["customer-purchase-stats", id, ownerPhone],
    enabled: !!data?.owner,
    queryFn: () => fetchCustomerProfileStats(id, ownerPhone),
  });

  const qc = useQueryClient();
  const refetchAll = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["customer-ledger", id] });
    qc.invalidateQueries({ queryKey: ["customer-timeline", id] });
    qc.invalidateQueries({ queryKey: ["customers-ledger"] });
    qc.invalidateQueries({ queryKey: ["customer-purchase-stats", id] });
  };

  const owner = data?.owner;
  const sales = data?.sales ?? [];

  const totals = useMemo(() => {
    const active = sales.filter((s) => s.status !== "void");
    return {
      due: active.reduce((a, s) => a + Number(s.due), 0),
      paid: active.reduce((a, s) => a + Number(s.paid), 0),
      // value after returns (gross total overstated returned invoices)
      billed: active.reduce((a, s) => a + Number(s.paid) + Number(s.due), 0),
      count: active.length,
    };
  }, [sales]);

  const petName = (pid: string | null) => data?.pets.find((p) => p.id === pid)?.name ?? "—";

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!owner) return <div className="p-6 text-muted-foreground">Customer not found.</div>;

  return (
    <div className="p-0 sm:p-2">
      <PageHeader
        title={owner.full_name}
        description="Customer profile — dues, payments, invoices and upcoming appointments"
        icon={User}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/receivables"><ArrowLeft className="h-4 w-4" /> All customers</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RotateCcw className="h-4 w-4" /> Refresh
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPayOpen(true)}>
              <HandCoins className="h-4 w-4" /> Receive payment
            </Button>
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Current due</div><div className={`text-xl sm:text-2xl font-semibold ${totals.due > 0 ? "text-destructive" : ""}`}>{fmt(totals.due)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total paid</div><div className="text-xl sm:text-2xl font-semibold text-emerald-600">{fmt(totals.paid)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Lifetime billed</div><div className="text-xl sm:text-2xl font-semibold">{fmt(totals.billed)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Invoices</div><div className="text-xl sm:text-2xl font-semibold">{totals.count}</div></CardContent></Card>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Repeat className="h-4 w-4" /> Purchase behaviour
            {purchase && (
              <Badge variant={purchase.type === "new" ? "default" : "secondary"} className="ml-1 capitalize">
                {purchase.type} customer
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!purchase ? (
            <div className="text-sm text-muted-foreground">No purchases recorded yet — this customer will count as new on their first sale.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">First purchase</div>
                <div className="text-sm font-medium">{format(new Date(purchase.firstPurchase), "dd MMM yyyy")}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Last purchase</div>
                <div className="text-sm font-medium">{format(new Date(purchase.lastPurchase), "dd MMM yyyy")}</div>
                <div className="text-[11px] text-muted-foreground">{daysSince(purchase.lastPurchase)} days ago</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Total orders</div>
                <div className="text-sm font-medium">{purchase.orders}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Total purchase amount</div>
                <div className="text-sm font-medium">{fmt(purchase.amount)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Returned after</div>
                <div className="text-sm font-medium">{purchase.gapDays === null ? "—" : `${purchase.gapDays} days`}</div>
                <div className="text-[11px] text-muted-foreground">gap between last two purchases</div>
              </div>
            </div>
          )}
          {purchase && purchase.linkedAccounts > 1 && (
            <div className="mt-3 text-xs text-muted-foreground">
              Merged history from {purchase.linkedAccounts} accounts sharing this mobile number.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Contact</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {owner.phone || "—"}</div>
            <div className="flex items-center gap-2"><span className="text-muted-foreground">Gender:</span> <span className="capitalize">{owner.gender || "—"}</span></div>
            <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> {owner.email || "—"}</div>
            <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /> {owner.address || "—"}</div>
            {owner.notes && <div className="text-xs text-muted-foreground pt-1">{owner.notes}</div>}
            <div className="flex flex-wrap gap-1 pt-2">
              {(data?.pets ?? []).map((p) => (
                <Badge key={p.id} variant="secondary">{p.name} · {p.species}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Upcoming appointments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(data?.appointments ?? []).length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No upcoming appointments.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Pet</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.appointments ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">{format(new Date(a.scheduled_at), "dd MMM yyyy, hh:mm a")}</TableCell>
                      <TableCell>{petName(a.pet_id)}</TableCell>
                      <TableCell>{a.doctor?.full_name ?? "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{a.reason ?? "—"}</TableCell>
                      <TableCell className="text-right"><Badge variant="secondary">{a.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Recent invoices</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="timeline">History timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="pt-3">
          <Card>
            <CardContent className="p-0">
              {sales.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">This customer has no invoices.</div>
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
                    {sales.slice(0, 50).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="font-medium">{s.invoice_no}</div>
                          <div className="text-xs text-muted-foreground">{format(new Date(s.created_at), "dd MMM yyyy, hh:mm a")}</div>
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger" className="pt-3">
          <CustomerLedger ownerId={owner.id} customerName={owner.full_name} customerPhone={owner.phone} />
        </TabsContent>

        <TabsContent value="timeline" className="pt-3">
          <CustomerTimeline ownerId={owner.id} />
        </TabsContent>
      </Tabs>

      <CustomerPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        customerName={owner.full_name}
        invoices={sales
          .filter((s) => s.status !== "void" && Number(s.due) > 0)
          .map((s) => ({ id: s.id, invoice_no: s.invoice_no, due: Number(s.due), created_at: s.created_at }))}
        onRecorded={() => refetchAll()}
      />

      <CustomerEditDialog
        customer={owner as any}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => refetch()}
      />

      <CollectDueDialog
        sale={dueSale ? { id: dueSale.id, invoice_no: dueSale.invoice_no, due: Number(dueSale.due), owner: { full_name: owner.full_name } } : null}
        open={!!dueSale}
        onOpenChange={(o) => !o && setDueSale(null)}
        onCollected={() => { setDueSale(null); refetchAll(); }}
      />
    </div>
  );
}
