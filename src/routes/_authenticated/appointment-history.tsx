import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Search, Printer, CalendarDays, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { fuzzyMatch } from "@/lib/fuzzy-search";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { printAppointmentSlip, type AppointmentSlip } from "@/lib/appointment-slip";
import { money } from "@/components/ReceiveAppointmentCashDialog";
import { dayRangeISO } from "@/lib/sales-ledger";

export const Route = createFileRoute("/_authenticated/appointment-history")({
  head: () => ({
    meta: [
      { title: "Appointment History — Pet Care Vet" },
      {
        name: "description",
        content:
          "Search every past and upcoming appointment by customer name, phone, pet, doctor, date range and status.",
      },
      { property: "og:title", content: "Appointment History — Pet Care Vet" },
      {
        property: "og:description",
        content: "Full clinic appointment archive with customer, pet and doctor details.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppointmentHistoryPage,
});

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  confirmed: "default",
  in_progress: "secondary",
  completed: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
};

const dayStr = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const digits = (s: string) => (s || "").replace(/\D/g, "");

function defaultRange() {
  const to = new Date();
  to.setDate(to.getDate() + 30);
  const from = new Date();
  from.setMonth(from.getMonth() - 6);
  return { from: dayStr(from), to: dayStr(to) };
}

type Filter = "all" | "today" | "upcoming" | "completed" | "cancelled";

function AppointmentHistoryPage() {
  const init = useMemo(defaultRange, []);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Filter>("all");
  const [doctorId, setDoctorId] = useState("all");
  const [viewing, setViewing] = useState<any | null>(null);

  const { data: doctors = [] } = useQuery({
    // unique cache key: the same key held a different column set on another page
    queryKey: ["doctors", "picker", "names"],
    queryFn: async () =>
      (await supabase.from("doctors").select("id,full_name").order("full_name")).data ?? [],
  });

  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["appointments", "history", from, to],
    queryFn: async () =>
      await fetchAll<any>(() =>
        supabase
          .from("appointments")
          .select(
            "*, pet:pets(id,name,species,breed,gender), owner:pet_owners(id,full_name,phone,address), doctor:doctors(id,full_name,specialization)",
          )
          .gte("scheduled_at", dayRangeISO(from, to).fromISO)
          .lte("scheduled_at", dayRangeISO(from, to).toISO)
          .order("scheduled_at", { ascending: false }),
      ),
  });

  const filtered = useMemo(() => {
    const today = dayStr(new Date());
    const now = Date.now();
    const qd = digits(q);
    const term = q.trim();

    const matches = (a: any) => {
      if (!term) return true;
      const owner = a.owner?.full_name ?? a.guest_name ?? "";
      const phone = a.owner?.phone ?? a.guest_phone ?? "";
      const pet = a.pet?.name ?? a.guest_pet_name ?? "";
      const doc = a.doctor?.full_name ?? "";
      if (qd && digits(phone).includes(qd)) return true;
      if (String(a.serial_no ?? "") === term) return true;
      return Boolean(
        fuzzyMatch(owner, term) || fuzzyMatch(pet, term) || fuzzyMatch(doc, term),
      );
    };

    return (rows as any[]).filter((a) => {
      if (doctorId !== "all" && a.doctor_id !== doctorId) return false;
      const day = dayStr(new Date(a.scheduled_at));
      if (tab === "today" && day !== today) return false;
      if (tab === "upcoming" && !(new Date(a.scheduled_at).getTime() > now && !["completed", "cancelled", "no_show"].includes(a.status)))
        return false;
      if (tab === "completed" && a.status !== "completed") return false;
      if (tab === "cancelled" && !["cancelled", "no_show"].includes(a.status)) return false;
      return matches(a);
    });
  }, [rows, q, tab, doctorId]);

  const totals = useMemo(() => {
    let fee = 0;
    let paid = 0;
    for (const a of filtered) {
      if (a.status === "cancelled") continue;
      fee += Number(a.fee || 0);
      paid += Number(a.paid || 0);
    }
    return { count: filtered.length, fee, paid, due: Math.max(fee - paid, 0) };
  }, [filtered]);

  const slipFrom = (a: any): AppointmentSlip => ({
    serial_no: a.serial_no ?? null,
    scheduled_at: a.scheduled_at,
    duration_minutes: a.duration_minutes,
    pet_name: a.pet?.name ?? a.guest_pet_name ?? "—",
    pet_species: a.pet?.species ?? a.guest_pet_species ?? null,
    owner_name: a.owner?.full_name ?? a.guest_name ?? "—",
    owner_phone: a.owner?.phone ?? a.guest_phone ?? null,
    doctor_name: a.doctor?.full_name ?? "—",
    fee: Number(a.fee || 0),
    paid: Number(a.paid || 0),
    reason: a.reason ?? null,
  });

  return (
    <div>
      <PageHeader
        title="Appointment History"
        description="Every appointment with customer, pet and doctor details — filter by date, status or search."
        icon={History}
        actions={
          <Button asChild variant="outline">
            <Link to="/appointments">
              <CalendarDays className="h-4 w-4" /> Today's queue
            </Link>
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-3 sm:p-4 md:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <Label>Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Customer name, phone, pet, doctor or serial…"
                className="pl-8"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Doctor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All doctors</SelectItem>
                {(doctors as any[]).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Status</Label>
            <Tabs value={tab} onValueChange={(v) => setTab(v as Filter)}>
              <TabsList className="w-full flex-wrap h-auto">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
                <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mb-4">
        {[
          { label: "Appointments", value: String(totals.count) },
          { label: "Total fee", value: money(totals.fee) },
          { label: "Collected", value: money(totals.paid) },
          { label: "Due", value: money(totals.due) },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="text-lg font-semibold tabular-nums truncate">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <Card className="mb-4 border-destructive">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> Could not load appointments: {(error as any).message}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No appointments match these filters.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {!isLoading &&
          filtered.map((a) => {
            const due = Math.max(Number(a.fee || 0) - Number(a.paid || 0), 0);
            return (
              <Card key={a.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setViewing(a)}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2 sm:w-40">
                      <Badge variant="secondary" className="tabular-nums">#{a.serial_no ?? "-"}</Badge>
                      <span className="text-sm font-medium tabular-nums">
                        {new Date(a.scheduled_at).toLocaleString([], {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium truncate">{a.pet?.name ?? a.guest_pet_name ?? "—"}</span>
                        {a.pet?.species && <Badge variant="outline">{a.pet.species}</Badge>}
                        <Badge variant={STATUS_COLORS[a.status] ?? "outline"}>{a.status}</Badge>
                        {Number(a.fee || 0) > 0 && (
                          <Badge variant={due > 0 ? "destructive" : "secondary"}>
                            {due > 0 ? `Due ${money(due)}` : "Paid"}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {a.owner?.full_name ?? a.guest_name ?? "—"}
                        {(a.owner?.phone || a.guest_phone) && ` · ${a.owner?.phone ?? a.guest_phone}`}
                        {a.doctor?.full_name && ` · Dr. ${a.doctor.full_name}`}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader><DialogTitle>Appointment #{viewing?.serial_no ?? "-"}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <Section title="Customer">
                <Row label="Name" value={viewing.owner?.full_name ?? viewing.guest_name ?? "—"} />
                <Row label="Phone" value={viewing.owner?.phone ?? viewing.guest_phone ?? "—"} />
                <Row label="Address" value={viewing.owner?.address ?? "—"} />
              </Section>
              <Section title="Pet">
                <Row label="Name" value={viewing.pet?.name ?? viewing.guest_pet_name ?? "—"} />
                <Row label="Species" value={viewing.pet?.species ?? viewing.guest_pet_species ?? "—"} />
                <Row label="Breed" value={viewing.pet?.breed ?? "—"} />
                <Row label="Gender" value={viewing.pet?.gender ?? "—"} />
              </Section>
              <Section title="Doctor">
                <Row label="Name" value={viewing.doctor?.full_name ? `Dr. ${viewing.doctor.full_name}` : "—"} />
                <Row label="Specialization" value={viewing.doctor?.specialization ?? "—"} />
              </Section>
              <Section title="Appointment">
                <Row label="Date & time" value={new Date(viewing.scheduled_at).toLocaleString()} />
                <Row label="Duration" value={`${viewing.duration_minutes} min`} />
                <Row label="Status" value={viewing.status} />
                <Row label="Fee" value={money(Number(viewing.fee || 0))} />
                <Row label="Paid" value={money(Number(viewing.paid || 0))} />
                <Row label="Due" value={money(Math.max(Number(viewing.fee || 0) - Number(viewing.paid || 0), 0))} />
                <Row label="Reason" value={viewing.reason ?? "—"} />
                <Row label="Notes" value={viewing.notes ?? "—"} />
              </Section>
              {viewing.owner?.id && (
                <Button asChild variant="outline" className="w-full">
                  <Link to="/customers/$id" params={{ id: viewing.owner.id }}>Open customer profile</Link>
                </Button>
              )}
            </div>
          )}
          {viewing && (
            <DialogFooter>
              <Button variant="outline" onClick={() => printAppointmentSlip(slipFrom(viewing))}>
                <Printer className="h-4 w-4" /> Print slip
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="rounded-md border px-3 py-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words text-right font-medium">{value}</span>
    </div>
  );
}
