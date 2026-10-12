import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HeartPulse, CalendarDays, ReceiptText, Search } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PetHistorySheet } from "@/components/PetHistorySheet";
import { money } from "@/components/ReceiveAppointmentCashDialog";
import { apptStatus } from "@/lib/clinic";
import { computeClinicDashboard, isCancelledSale, loadClinicDashboard, type Row } from "@/lib/clinic-dashboard";
import { monthStartDhaka, todayDhaka } from "@/lib/sales-ledger";
import { shiftDay } from "@/lib/sales-summary";

export const Route = createFileRoute("/_authenticated/clinic-dashboard")({
  head: () => ({ meta: [{ title: "Clinic Dashboard — Pet Care Vet" }] }),
  component: ClinicDashboard,
});

type Preset = "today" | "yesterday" | "7d" | "month" | "last_month" | "custom";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom dates" },
];

function rangeFor(p: Preset): [string, string] {
  const t = todayDhaka();
  if (p === "today") return [t, t];
  if (p === "yesterday") return [shiftDay(t, -1), shiftDay(t, -1)];
  if (p === "7d") return [shiftDay(t, -6), t];
  if (p === "last_month") {
    const end = shiftDay(monthStartDhaka(), -1);
    return [`${end.slice(0, 7)}-01`, end];
  }
  return [monthStartDhaka(), t];
}

const fmtDay = (k: string) =>
  k.length === 7
    ? new Date(`${k}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
    : new Date(`${k}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function ClinicDashboard() {
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState<[string, string]>(rangeFor("month"));
  const [from, to] = preset === "custom" ? custom : rangeFor(preset);
  const [historyPet, setHistoryPet] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["clinic-dashboard", from, to],
    queryFn: () => loadClinicDashboard(from, to),
    enabled: !!from && !!to && from <= to,
  });
  const view = useMemo(() => (data ? computeClinicDashboard(data, from, to) : null), [data, from, to]);
  const k = view?.k;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clinic Dashboard"
        description="Visits, clinic bills, costs, doctor share and profit for the dates you pick."
        icon={HeartPulse}
        actions={
          <>
            <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
              <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
            {preset === "custom" && (
              <div className="flex items-center gap-1">
                <Input type="date" className="h-9" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
                <Input type="date" className="h-9" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} />
              </div>
            )}
            <Button asChild variant="outline" size="sm"><Link to="/appointments"><CalendarDays className="h-4 w-4" /> Appointments</Link></Button>
            <Button asChild size="sm"><Link to="/clinic-bill" search={{}}><ReceiptText className="h-4 w-4" /> Service bill</Link></Button>
          </>
        }
      />

      {error && <Card><CardContent className="py-6 sm:py-6 text-sm text-destructive">Could not load the dashboard: {(error as any).message}</CardContent></Card>}
      {isLoading && <Card><CardContent className="py-10 sm:py-10 text-center text-muted-foreground">Loading…</CardContent></Card>}

      {k && view && (
        <>
          {/* Money */}
          <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Clinic profit</CardDescription>
                <CardTitle className={`text-3xl tabular-nums ${k.profit < 0 ? "text-destructive" : ""}`}>{money(k.profit)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <Line2 label="Bills (sales)" value={k.gross} />
                {k.reversals > 0 && <Line2 label="Returns & cancelled bills" value={-k.reversals} />}
                <Line2 label="Net revenue" value={k.net} strong />
                <Line2 label="Service cost (direct + materials)" value={-k.serviceCost} />
                <Line2 label="Medicine / product cost" value={-k.productCost} />
                <Line2 label="Doctor share" value={-k.doctorFee} />
                <Line2 label="Profit" value={k.profit} strong />
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <Kpi label="Collected" value={money(k.collected)} hint="Paid on these bills" />
              <Kpi label="Due" value={money(k.due)} hint="Still to collect" tone={k.due > 0 ? "warn" : undefined} />
              <Kpi label="Consultation" value={money(k.consultation)} />
              <Kpi label="Services" value={money(k.services)} />
              <Kpi label="Medicines / products" value={money(k.products)} />
              <Kpi label="Doctor payable" value={money(k.doctorFee)} hint="From service share" />
            </div>
          </div>

          {/* Visits */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
            <Kpi label="Appointments" value={k.appointments} />
            <Kpi label="Booked" value={k.booked} />
            <Kpi label="Arrived" value={k.arrived} />
            <Kpi label="Completed" value={k.completed} />
            <Kpi label="Cancelled" value={k.cancelled} />
            <Kpi label="No-show" value={k.noShow} />
            <Kpi label="Not billed" value={k.notBilled} tone={k.notBilled > 0 ? "warn" : undefined} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{view.monthly ? "Month by month" : "Day by day"}</CardTitle>
              <CardDescription>Net clinic revenue, money collected and appointments.</CardDescription>
            </CardHeader>
            <CardContent className="h-64 pl-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={view.trend} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="key" tickFormatter={fmtDay} fontSize={11} minTickGap={12} />
                  <YAxis yAxisId="m" fontSize={11} width={56} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v))} />
                  <YAxis yAxisId="c" orientation="right" fontSize={11} width={28} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(l) => fmtDay(String(l))}
                    formatter={(v: any, name: any) => (name === "Appointments" ? v : money(Number(v)))}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="m" dataKey="revenue" name="Net revenue" fill="var(--primary)" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="m" dataKey="collected" name="Collected" fill="color-mix(in srgb, var(--primary) 35%, transparent)" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="c" dataKey="appointments" name="Appointments" stroke="var(--foreground)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Tabs defaultValue="services">
            <TabsList className="flex w-full flex-wrap h-auto justify-start">
              <TabsTrigger value="services">Services</TabsTrigger>
              <TabsTrigger value="doctors">Doctors</TabsTrigger>
              <TabsTrigger value="problems">Problems</TabsTrigger>
              <TabsTrigger value="visits">Visit history</TabsTrigger>
              <TabsTrigger value="bills">Bills</TabsTrigger>
            </TabsList>

            <TabsContent value="services">
              <BreakdownTable
                rows={view.byItem}
                empty="No clinic bills in these dates."
                cols={[
                  { label: "Item", render: (r) => <div><div className="font-medium">{r.label}</div><div className="text-xs text-muted-foreground">{r.sub}</div></div> },
                  { label: "Qty", num: true, render: (r) => r.qty },
                  { label: "Sales", num: true, render: (r) => money(r.revenue) },
                  { label: "Cost", num: true, render: (r) => money(r.cost) },
                  { label: "Doctor share", num: true, render: (r) => money(r.doctorFee) },
                  { label: "Profit", num: true, render: (r) => <span className={r.profit < 0 ? "text-destructive" : ""}>{money(r.profit)}</span> },
                ]}
              />
            </TabsContent>

            <TabsContent value="doctors">
              <BreakdownTable
                rows={view.byDoctor}
                empty="No appointments or bills in these dates."
                cols={[
                  { label: "Doctor", render: (r) => <span className="font-medium">{r.label}</span> },
                  { label: "Appointments", num: true, render: (r) => r.count },
                  { label: "Bills", num: true, render: (r) => r.extra ?? 0 },
                  { label: "Net sales", num: true, render: (r) => money(r.revenue) },
                  { label: "Doctor share", num: true, render: (r) => money(r.doctorFee) },
                  { label: "Profit", num: true, render: (r) => money(r.profit) },
                ]}
              />
            </TabsContent>

            <TabsContent value="problems">
              <BreakdownTable
                rows={view.byProblem}
                empty="No appointments in these dates."
                cols={[
                  { label: "Problem", render: (r) => <span className="font-medium">{r.label}</span> },
                  { label: "Appointments", num: true, render: (r) => r.count },
                  { label: "Completed", num: true, render: (r) => r.qty },
                  { label: "Billed", num: true, render: (r) => money(r.revenue) },
                  { label: "Per visit", num: true, render: (r) => (r.count ? money(r.revenue / r.count) : "—") },
                ]}
              />
            </TabsContent>

            <TabsContent value="visits">
              <VisitHistory data={data!} onPet={setHistoryPet} />
            </TabsContent>

            <TabsContent value="bills">
              <BillList data={data!} refunds={view.refundsBySale} onPet={setHistoryPet} />
            </TabsContent>
          </Tabs>
        </>
      )}

      <PetHistorySheet petId={historyPet} onClose={() => setHistoryPet(null)} />
    </div>
  );
}

function Line2({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t pt-1.5 font-semibold" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${strong ? "text-foreground" : ""}`}>{value < 0 ? `− ${money(-value)}` : money(value)}</span>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "warn" }) {
  return (
    <Card className={tone === "warn" ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20" : ""}>
      <CardContent className="p-3 sm:p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums truncate">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function BreakdownTable({ rows, cols, empty }: { rows: Row[]; empty: string; cols: { label: string; num?: boolean; render: (r: Row) => React.ReactNode }[] }) {
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>{cols.map((c) => <TableHead key={c.label} className={c.num ? "text-right" : ""}>{c.label}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={cols.length} className="py-8 text-center text-muted-foreground">{empty}</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.key}>
                {cols.map((c) => <TableCell key={c.label} className={c.num ? "text-right tabular-nums" : ""}>{c.render(r)}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const match = (q: string, ...parts: (string | null | undefined)[]) => parts.some((p) => (p ?? "").toLowerCase().includes(q));

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative mb-2">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input className="pl-8" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function VisitHistory({ data, onPet }: { data: Awaited<ReturnType<typeof loadClinicDashboard>>; onPet: (id: string) => void }) {
  const [q, setQ] = useState("");
  const sales = new Map(data.sales.map((s) => [s.id, s]));
  const t = q.trim().toLowerCase();
  const rows = data.appts.filter(
    (a) => !t || match(t, a.pet?.name, a.guest_pet_name, a.pet?.owner?.full_name, a.guest_name, a.pet?.owner?.phone, a.guest_phone, a.doctor?.full_name, a.problem?.name, a.reason),
  );
  return (
    <Card>
      <CardContent className="p-3 sm:p-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search pet, owner, phone, doctor or problem" />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Pet / owner</TableHead>
                <TableHead>Problem</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Bill</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No visits found.</TableCell></TableRow>}
              {rows.slice(0, 300).map((a) => {
                const st = apptStatus(a.status);
                const s = a.sale_id ? sales.get(a.sale_id) : null;
                return (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(a.scheduled_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {a.serial_no ? <span className="text-muted-foreground"> · #{a.serial_no}</span> : null}
                    </TableCell>
                    <TableCell>
                      {a.pet?.id ? (
                        <button type="button" className="font-medium hover:underline underline-offset-2 text-left" onClick={() => onPet(a.pet!.id)}>{a.pet.name}</button>
                      ) : (
                        <span className="font-medium">{a.guest_pet_name ?? "—"}</span>
                      )}
                      <div className="text-xs text-muted-foreground">{a.pet?.owner?.full_name ?? a.guest_name ?? "—"} {a.pet?.owner?.phone ?? a.guest_phone ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-sm">{a.problem?.name ?? a.reason ?? "—"}</TableCell>
                    <TableCell className="text-sm">{a.doctor?.full_name ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={st.tone}>{st.label}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {s ? (
                        <>
                          {money(Number(s.total))}
                          <div className="text-xs text-muted-foreground">{s.invoice_no}{Number(s.due) > 0 ? ` · due ${money(Number(s.due))}` : ""}</div>
                        </>
                      ) : a.sale_id ? (
                        <span className="text-xs text-muted-foreground">Billed (other dates)</span>
                      ) : st.value === "cancelled" || st.value === "no_show" ? (
                        "—"
                      ) : (
                        <Button size="sm" variant="outline" asChild><Link to="/clinic-bill" search={{ appointment: a.id }}>Make bill</Link></Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {rows.length > 300 && <p className="mt-2 text-xs text-muted-foreground">Showing the latest 300. Narrow the dates or search to see others.</p>}
      </CardContent>
    </Card>
  );
}

function BillList({ data, refunds, onPet }: { data: Awaited<ReturnType<typeof loadClinicDashboard>>; refunds: Map<string, number>; onPet: (id: string) => void }) {
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();
  const rows = data.sales.filter((s) => !t || match(t, s.invoice_no, s.owner?.full_name, s.owner?.phone, s.appointment?.pet?.name, ...s.items.map((i) => i.name)));
  return (
    <Card>
      <CardContent className="p-3 sm:p-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search invoice, owner, phone, pet or item" />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer / pet</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No clinic bills found.</TableCell></TableRow>}
              {rows.slice(0, 300).map((s) => {
                const cancelled = isCancelledSale(s);
                const ret = refunds.get(s.id) ?? 0;
                return (
                  <TableRow key={s.id} className={cancelled ? "opacity-60" : ""}>
                    <TableCell className="whitespace-nowrap text-sm">
                      <div className="font-medium">{s.invoice_no}</div>
                      <div className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.owner?.full_name ?? "Walk-in"}
                      {s.appointment?.pet && (
                        <div>
                          <button type="button" className="text-xs hover:underline underline-offset-2" onClick={() => onPet(s.appointment!.pet!.id)}>{s.appointment.pet.name}</button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-64">
                      {s.items.map((i) => i.name).join(", ")}
                      {cancelled && <Badge variant="destructive" className="ml-1">Cancelled</Badge>}
                      {!cancelled && ret > 0 && <Badge variant="outline" className="ml-1">Returned {money(ret)}</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(s.total))}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(s.paid))}</TableCell>
                    <TableCell className={`text-right tabular-nums ${Number(s.due) > 0 && !cancelled ? "text-destructive" : ""}`}>{cancelled ? "—" : money(Number(s.due))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
