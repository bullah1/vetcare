import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Bike, Download, FileText, MessageCircle, PackageCheck, RefreshCw, RotateCcw, Search, Truck } from "lucide-react";
import { ReturnFlow } from "@/components/ReturnFlow";
import { checkSteadfastConnection, refreshAllCourierStatuses } from "@/lib/courier.functions";
import { courierStage, type ParcelStage } from "@/lib/courier-status";
import { deliveryMoney, loadShipments, type Shipment, type ShipmentKind } from "@/lib/shipments";
import { DeliverySettlement } from "@/components/DeliverySettlement";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { monthStartDhaka, todayDhaka } from "@/lib/sales-ledger";
import { shiftDay } from "@/lib/sales-summary";
import { printInvoice, shareInvoiceOnWhatsApp } from "@/lib/invoice-print";
import { fetchSaleReceipt } from "@/lib/sale-receipt";

export const Route = createFileRoute("/_authenticated/delivery-report")({
  head: () => ({
    meta: [
      { title: "Delivery Report — Courier & Local Delivery | Pet Care Vet ERP" },
      { name: "description", content: "Courier parcels and local deliveries in one report: delivered, in progress, returned, amounts to collect and rider performance." },
      { property: "og:title", content: "Delivery Report | Pet Care Vet ERP" },
      { property: "og:description", content: "Courier and local delivery analysis in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeliveryReportPage,
});

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 0 })}`;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

type Kind = ShipmentKind;
type Stage = ParcelStage;

const STAGE_LABEL: Record<Stage, string> = { delivered: "Delivered", progress: "In progress", cancelled: "Cancelled / Returned" };
const STAGE_TONE: Record<Stage, string> = {
  delivered: "border-emerald-300 bg-emerald-50 text-emerald-800",
  progress: "border-amber-300 bg-amber-50 text-amber-800",
  cancelled: "border-destructive/40 bg-destructive/10 text-destructive",
};

function downloadCsv(rows: Shipment[], from: string, to: string) {
  const head = ["Date", "Invoice", "Type", "Customer", "Phone", "Address", "Rider / Courier", "Tracking", "Status", "Product value", "Delivery charge", "COD charge", "To collect"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [format(new Date(r.at), "yyyy-MM-dd HH:mm"), r.invoiceNo, r.kind === "courier" ? "Courier" : "Local", r.customer, r.phone, r.address, r.agent, r.tracking, r.statusLabel, r.productValue, r.charge, r.codCharge, r.collect]
      .map(esc)
      .join(","),
  );
  const blob = new Blob(["﻿" + [head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `delivery-report_${from}_to_${to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Stat({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums tracking-tight ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function KindBadge({ kind }: { kind: Kind }) {
  return kind === "courier" ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"><Truck className="h-3 w-3" /> Courier</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800"><Bike className="h-3 w-3" /> Local</span>
  );
}

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "month", label: "This month" },
  { key: "30d", label: "30 days" },
] as const;

function DeliveryReportPage() {
  const [from, setFrom] = useState(monthStartDhaka());
  const [to, setTo] = useState(todayDhaka());
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [stage, setStage] = useState<"all" | Stage>("all");
  const [agent, setAgent] = useState("all");
  const [q, setQ] = useState("");

  const applyPreset = (k: (typeof PRESETS)[number]["key"]) => {
    const t = todayDhaka();
    setTo(t);
    setFrom(k === "today" ? t : k === "7d" ? shiftDay(t, -6) : k === "30d" ? shiftDay(t, -29) : monthStartDhaka());
  };

  const { data: all = [], isFetching, error } = useQuery({
    queryKey: ["delivery-report", from, to],
    queryFn: () => loadShipments(from, to),
  });

  // Latest courier status from Steadfast (cancelled / delivered show up here).
  const qc = useQueryClient();
  const refreshFn = useServerFn(refreshAllCourierStatuses);
  const checkFn = useServerFn(checkSteadfastConnection);
  const [checking, setChecking] = useState(false);
  const testSteadfast = async () => {
    setChecking(true);
    try {
      const r: any = await checkFn();
      if (r.ok) toast.success(`Steadfast connected ✓ — account balance ৳${Number(r.balance).toLocaleString("en-BD")}`);
      else toast.error(`Steadfast not working: ${r.message}`, { duration: 10000 });
    } catch (e: any) {
      toast.error(`Steadfast not working: ${e?.message ?? "unknown error"}`, { duration: 10000 });
    } finally {
      setChecking(false);
    }
  };
  const [syncing, setSyncing] = useState(false);
  const syncCourier = async (silent = false) => {
    setSyncing(true);
    try {
      const res: any = await refreshFn({ data: {} });
      try { localStorage.setItem("deliveryReport.lastSync", String(Date.now())); } catch { /* ignore */ }
      if (!res.ok) { if (!silent) toast.error(res.message); return; }
      if (res.changed.length) {
        const cancelled = res.changed.filter((c: any) => courierStage(c.to) === "cancelled");
        toast.success(`${res.changed.length} parcel status updated${cancelled.length ? ` — ${cancelled.length} cancelled: ${cancelled.map((c: any) => c.invoice_no).join(", ")}` : ""}`);
        qc.invalidateQueries({ queryKey: ["delivery-report"] });
        qc.invalidateQueries({ queryKey: ["delivery-record"] });
      } else if (!silent) {
        toast.success(`All ${res.checked} parcels on the way are up to date`);
      }
      if (res.failed && !silent) toast.warning(`${res.failed} parcel(s) could not be checked`);
    } catch (e: any) {
      if (!silent) toast.error(e?.message ?? "Could not reach Steadfast");
    } finally {
      setSyncing(false);
    }
  };
  // Check by itself when the page opens (at most every 15 minutes).
  const autoSynced = useRef(false);
  useEffect(() => {
    if (autoSynced.current) return;
    autoSynced.current = true;
    let last = 0;
    try { last = Number(localStorage.getItem("deliveryReport.lastSync")) || 0; } catch { /* ignore */ }
    if (Date.now() - last > 15 * 60_000) void syncCourier(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parcels that came back but whose goods were not taken back in POS yet.
  const notReturned = useMemo(() => all.filter((s) => s.stage === "cancelled" && !s.returnedInPos), [all]);

  const agents = useMemo(() => {
    const m = new Map<string, { key: string; name: string; kind: Kind }>();
    for (const s of all) if (!m.has(s.agentKey)) m.set(s.agentKey, { key: s.agentKey, name: s.agent, kind: s.kind });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((s) => {
      if (kind !== "all" && s.kind !== kind) return false;
      if (stage !== "all" && s.stage !== stage) return false;
      if (agent !== "all" && s.agentKey !== agent) return false;
      if (!term) return true;
      return [s.invoiceNo, s.customer, s.phone, s.agent, s.tracking].some((v) => (v ?? "").toLowerCase().includes(term));
    });
  }, [all, kind, stage, agent, q]);

  const k = useMemo(() => {
    const sum = (list: Shipment[], f: (s: Shipment) => number) => list.reduce((a, s) => a + f(s), 0);
    const done = rows.filter((s) => s.stage === "delivered");
    const prog = rows.filter((s) => s.stage === "progress");
    const canc = rows.filter((s) => s.stage === "cancelled");
    const live = rows.filter((s) => s.stage !== "cancelled");
    return {
      total: rows.length,
      courier: rows.filter((s) => s.kind === "courier").length,
      local: rows.filter((s) => s.kind === "local").length,
      done: done.length,
      prog: prog.length,
      canc: canc.length,
      closed: done.length + canc.length,
      collected: sum(done, (s) => s.collect),
      pending: sum(prog, (s) => s.collect),
      returnedValue: sum(canc, (s) => s.productValue),
      charges: sum(live, (s) => s.charge),
      codCharges: sum(live, (s) => s.codCharge),
      productValue: sum(live, (s) => s.productValue),
    };
  }, [rows]);

  const money = useMemo(() => deliveryMoney(rows), [rows]);

  // Parcels per day, courier vs local.
  const daily = useMemo(() => {
    const m = new Map<string, { day: string; Courier: number; Local: number }>();
    for (let d = from; d <= to; d = shiftDay(d, 1)) {
      m.set(d, { day: d, Courier: 0, Local: 0 });
      if (m.size > 92) break;
    }
    for (const s of rows) {
      const e = m.get(s.day);
      if (e) e[s.kind === "courier" ? "Courier" : "Local"] += 1;
    }
    return [...m.values()].map((e) => ({ ...e, label: format(new Date(`${e.day}T12:00:00`), "d MMM") }));
  }, [rows, from, to]);

  // Performance per rider / courier.
  const byAgent = useMemo(() => {
    const m = new Map<string, { key: string; name: string; phone: string | null; kind: Kind; n: number; done: number; prog: number; canc: number; charge: number; collected: number; pending: number }>();
    for (const s of rows) {
      const e = m.get(s.agentKey) ?? { key: s.agentKey, name: s.agent, phone: s.agentPhone, kind: s.kind, n: 0, done: 0, prog: 0, canc: 0, charge: 0, collected: 0, pending: 0 };
      e.n += 1;
      if (s.stage === "delivered") { e.done += 1; e.collected += s.collect; }
      if (s.stage === "progress") { e.prog += 1; e.pending += s.collect; }
      if (s.stage === "cancelled") e.canc += 1;
      else e.charge += s.charge;
      m.set(s.agentKey, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [rows]);

  const openInvoice = async (s: Shipment, mode: "print" | "whatsapp") => {
    const w = window.open("", "_blank", mode === "print" ? "width=900,height=1000" : undefined);
    if (!w) { toast.error("Enable pop-ups to open the invoice"); return; }
    w.document.write('<p style="font:14px system-ui;padding:24px">Loading invoice…</p>');
    try {
      const r = await fetchSaleReceipt(s.saleId);
      if (mode === "print") printInvoice(r, w);
      else shareInvoiceOnWhatsApp(r, s.phone ?? undefined, w);
    } catch (e: any) {
      w.close();
      toast.error(e?.message ?? "Could not load the invoice");
    }
  };

  const chip = (active: boolean) =>
    `h-8 rounded-md border px-3 text-xs font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;

  return (
    <div className="min-w-0">
      <PageHeader
        title="Delivery Report"
        description="Courier parcels and local deliveries together — what went out, what reached, and what is still to collect."
        icon={PackageCheck}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={checking} onClick={testSteadfast} title="Check that the Steadfast API key works (shows your Steadfast balance)">
              <PackageCheck className="h-4 w-4" /> {checking ? "Checking…" : "Test Steadfast"}
            </Button>
            <Button variant="outline" disabled={syncing} onClick={() => syncCourier(false)} title="Get the latest status of every courier parcel from Steadfast">
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Updating…" : "Update courier status"}
            </Button>
            <Button variant="outline" disabled={!rows.length} onClick={() => downloadCsv(rows, from, to)}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" className={chip(false)} onClick={() => applyPreset(p.key)}>{p.label}</button>
            ))}
            <div className="flex items-center gap-1.5">
              <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-8 w-[9.5rem] text-xs" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-8 w-[9.5rem] text-xs" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="radiogroup" aria-label="Delivery type">
              {(["all", "courier", "local"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={kind === v} className={chip(kind === v)} onClick={() => { setKind(v); setAgent("all"); }}>
                  {v === "all" ? "All" : v === "courier" ? "Courier" : "Local"}
                </button>
              ))}
            </div>
            <Select value={stage} onValueChange={(v) => setStage(v as any)}>
              <SelectTrigger className="h-8 w-[11rem] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="progress">In progress</SelectItem>
                <SelectItem value="cancelled">Cancelled / Returned</SelectItem>
              </SelectContent>
            </Select>
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger className="h-8 w-[12rem] text-xs"><SelectValue placeholder="Rider / courier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All riders & couriers</SelectItem>
                {agents.filter((a) => kind === "all" || a.kind === kind).map((a) => (
                  <SelectItem key={a.key} value={a.key}>{a.name}{a.kind === "local" ? " (rider)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice, customer, phone, tracking…" className="h-8 pl-8 text-xs" />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Could not load the report: {(error as any)?.message}</p>}

      {notReturned.length > 0 && (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="p-3 sm:p-4">
            <div className="mb-2 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium">{notReturned.length} cancelled parcel{notReturned.length === 1 ? "" : "s"} not returned in POS yet</p>
                <p className="text-xs text-muted-foreground">The sale and stock stay as they are until you return the goods. When the parcel is back in the shop, press Return.</p>
              </div>
            </div>
            <div className="divide-y rounded-md border">
              {notReturned.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="font-medium">{s.invoiceNo}</span>
                  <KindBadge kind={s.kind} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.customer}{s.phone ? ` · ${s.phone}` : ""} · {s.agent} · {s.statusLabel}</span>
                  <span className="tabular-nums">{fmt(s.productValue)}</span>
                  <ReturnFlow
                    invoiceNo={s.invoiceNo}
                    trigger={<Button size="sm" variant="outline"><RotateCcw className="h-3.5 w-3.5" /> Return</Button>}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Headline numbers */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat label="Parcels sent" value={String(k.total)} sub={`${k.courier} courier · ${k.local} local`} />
        <Stat label="Delivered" value={String(k.done)} sub={`Success rate ${pct(k.done, k.closed)}`} tone="text-emerald-700" />
        <Stat label="In progress" value={String(k.prog)} sub={`${fmt(k.pending)} still to collect`} tone="text-amber-700" />
        <Stat label="Cancelled / Returned" value={String(k.canc)} sub={`Return rate ${pct(k.canc, k.closed)} · ${fmt(k.returnedValue)} goods`} tone="text-destructive" />
        <Stat label="Collected on delivery" value={fmt(k.collected)} sub="Delivered parcels" />
        <Stat label="Product value sent" value={fmt(k.productValue)} sub="Excludes cancelled" />
        <Stat label="Delivery charges" value={fmt(k.charges)} sub="Not part of sales" />
        <Stat label="COD charges (courier)" value={fmt(k.codCharges)} sub="Added to COD amount" />
      </div>

      {/* Delivery income vs real cost — collecting a charge is not profit by itself. */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat label="Delivery charge income" value={fmt(money.income)} sub="Customer-paid charges on delivered parcels" />
        <Stat label="Actual delivery cost" value={fmt(money.cost)} sub={money.costMissing ? `${money.costMissing} parcel(s) without cost entered` : "Rider fees + courier deductions"} tone={money.costMissing ? "text-amber-700" : ""} />
        <Stat label="Net delivery income" value={fmt(money.net)} tone={money.net < 0 ? "text-destructive" : "text-emerald-700"} sub="Income − actual cost" />
        <Stat label="Waiting to be settled" value={fmt(money.codPending + money.cashPending)} sub={`Courier COD ${fmt(money.codPending)} · rider cash ${fmt(money.cashPending)}`} />
      </div>

      <DeliverySettlement shipments={all} onChanged={() => qc.invalidateQueries({ queryKey: ["delivery-report"] })} />

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Parcels per day</p>
              <div className="flex gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Courier</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-600" /> Local</span>
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="Courier" stackId="a" fill="var(--primary)" />
                  <Bar dataKey="Local" stackId="a" fill="#0284c7" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4">
            <p className="mb-2 text-sm font-medium">Courier vs local</p>
            <div className="space-y-3">
              {(["courier", "local"] as const).map((kk) => {
                const list = rows.filter((s) => s.kind === kk);
                const d = list.filter((s) => s.stage === "delivered").length;
                const p = list.filter((s) => s.stage === "progress").length;
                const c = list.filter((s) => s.stage === "cancelled").length;
                const n = list.length || 1;
                return (
                  <div key={kk} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <KindBadge kind={kk} />
                      <span className="text-muted-foreground">{list.length} parcels · {pct(d, d + c)} delivered</span>
                    </div>
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className="bg-emerald-500" style={{ width: `${(d / n) * 100}%` }} />
                      <div className="bg-amber-400" style={{ width: `${(p / n) * 100}%` }} />
                      <div className="bg-destructive" style={{ width: `${(c / n) * 100}%` }} />
                    </div>
                    <div className="flex gap-3 text-[11px] text-muted-foreground">
                      <span>{d} delivered</span><span>{p} in progress</span><span>{c} cancelled/returned</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rider / courier performance */}
      <Card className="mb-4">
        <CardContent className="p-0">
          <p className="px-4 pt-3 text-sm font-medium">By rider & courier</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rider / Courier</TableHead>
                  <TableHead className="text-right">Parcels</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">In progress</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Charges</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">To collect</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byAgent.map((a) => (
                  <TableRow key={a.key} className="cursor-pointer" onClick={() => setAgent(agent === a.key ? "all" : a.key)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <KindBadge kind={a.kind} />
                        <span className="font-medium">{a.name}</span>
                        {a.phone && <span className="text-xs text-muted-foreground">{a.phone}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.n}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">{a.done}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">{a.prog}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">{a.canc}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(a.done, a.done + a.canc)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(a.charge)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(a.collected)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmt(a.pending)}</TableCell>
                  </TableRow>
                ))}
                {!byAgent.length && (
                  <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">{isFetching ? "Loading…" : "No parcels in this period."}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Every parcel */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 pt-3">
            <p className="text-sm font-medium">All parcels</p>
            <p className="text-xs text-muted-foreground">{rows.length} shown</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Rider / Courier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Products</TableHead>
                  <TableHead className="text-right">Charges</TableHead>
                  <TableHead className="text-right">To collect</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{format(new Date(s.at), "d MMM, h:mm a")}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{s.invoiceNo}</TableCell>
                    <TableCell>
                      <div className="max-w-[14rem]">
                        <p className="truncate text-sm">{s.customer}</p>
                        <p className="truncate text-xs text-muted-foreground">{[s.phone, s.address].filter(Boolean).join(" · ")}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5"><KindBadge kind={s.kind} /><span className="text-sm">{s.agent}</span></span>
                        {s.tracking && <span className="text-[11px] text-muted-foreground">#{s.tracking}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${STAGE_TONE[s.stage]}`} title={STAGE_LABEL[s.stage]}>
                        {s.statusLabel}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.productValue)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {fmt(s.charge)}
                      {s.codCharge > 0 && <span className="block text-muted-foreground">+{fmt(s.codCharge)} COD</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{s.stage === "cancelled" ? "—" : fmt(s.collect)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Delivery invoice" onClick={() => openInvoice(s, "print")}>
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-700" title="Send invoice to customer (WhatsApp)" onClick={() => openInvoice(s, "whatsapp")}>
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">{isFetching ? "Loading…" : "No parcels match these filters."}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
