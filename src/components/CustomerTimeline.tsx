import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, Receipt, Pill, Stethoscope, Syringe, PawPrint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

type Props = { ownerId: string };

type Event = {
  id: string;
  at: string;
  kind: "appointment" | "invoice" | "prescription" | "visit" | "vaccination";
  title: string;
  detail?: string;
  amount?: number;
  status?: string;
};

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

const meta: Record<Event["kind"], { icon: typeof Receipt; label: string; cls: string }> = {
  appointment: { icon: CalendarClock, label: "Appointment", cls: "bg-blue-500/10 text-blue-600" },
  invoice: { icon: Receipt, label: "Invoice", cls: "bg-emerald-500/10 text-emerald-600" },
  prescription: { icon: Pill, label: "Prescription", cls: "bg-violet-500/10 text-violet-600" },
  visit: { icon: Stethoscope, label: "Visit", cls: "bg-amber-500/10 text-amber-600" },
  vaccination: { icon: Syringe, label: "Vaccination", cls: "bg-teal-500/10 text-teal-600" },
};

export function CustomerTimeline({ ownerId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer-timeline", ownerId],
    enabled: !!ownerId && ownerId !== "walkin",
    queryFn: async () => {
      const { data: pets } = await supabase.from("pets").select("id,name,species").eq("owner_id", ownerId);
      const petIds = (pets ?? []).map((p) => p.id);

      const [appts, sales, presc, recs, vacc] = await Promise.all([
        supabase
          .from("appointments")
          .select("id,scheduled_at,reason,status,pet_id,guest_pet_name")
          .eq("owner_id", ownerId)
          .order("scheduled_at", { ascending: false })
          .limit(100),
        supabase
          .from("sales")
          .select("id,invoice_no,created_at,total,due,status")
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false })
          .limit(100),
        petIds.length
          ? supabase
              .from("prescriptions")
              .select("id,issued_at,notes,pet_id, items:prescription_items(medicine_name)")
              .in("pet_id", petIds)
              .order("issued_at", { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [] as any[] }),
        petIds.length
          ? supabase
              .from("medical_records")
              .select("id,visit_date,diagnosis,symptoms,pet_id")
              .in("pet_id", petIds)
              .order("visit_date", { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [] as any[] }),
        petIds.length
          ? supabase
              .from("vaccinations")
              .select("id,administered_at,vaccine_name,next_due_date,pet_id")
              .in("pet_id", petIds)
              .order("administered_at", { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const petName = (id: string | null) => (pets ?? []).find((p) => p.id === id)?.name ?? null;

      const events: Event[] = [];
      for (const a of (appts.data ?? []) as any[]) {
        events.push({
          id: `a-${a.id}`,
          at: a.scheduled_at,
          kind: "appointment",
          title: petName(a.pet_id) ?? a.guest_pet_name ?? "Appointment",
          detail: a.reason ?? undefined,
          status: a.status,
        });
      }
      for (const s of (sales.data ?? []) as any[]) {
        events.push({
          id: `s-${s.id}`,
          at: s.created_at,
          kind: "invoice",
          title: s.invoice_no,
          detail: Number(s.due) > 0 ? `Due ${fmt(Number(s.due))}` : "Paid",
          amount: Number(s.total),
          status: s.status,
        });
      }
      for (const p of (presc.data ?? []) as any[]) {
        const meds = (p.items ?? []).map((i: any) => i.medicine_name).filter(Boolean);
        events.push({
          id: `p-${p.id}`,
          at: p.issued_at,
          kind: "prescription",
          title: petName(p.pet_id) ?? "Prescription",
          detail: meds.length ? meds.slice(0, 4).join(", ") + (meds.length > 4 ? ` +${meds.length - 4}` : "") : (p.notes ?? undefined),
        });
      }
      for (const r of (recs.data ?? []) as any[]) {
        events.push({
          id: `r-${r.id}`,
          at: r.visit_date,
          kind: "visit",
          title: petName(r.pet_id) ?? "Clinic visit",
          detail: r.diagnosis ?? r.symptoms ?? undefined,
        });
      }
      for (const v of (vacc.data ?? []) as any[]) {
        events.push({
          id: `v-${v.id}`,
          at: v.administered_at,
          kind: "vaccination",
          title: v.vaccine_name,
          detail: [petName(v.pet_id), v.next_due_date ? `Next due ${v.next_due_date}` : null].filter(Boolean).join(" · ") || undefined,
        });
      }

      events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      return { events, pets: pets ?? [] };
    },
  });

  const summary = useMemo(() => {
    const e = data?.events ?? [];
    const lastVisit = e.find((x) => x.kind === "visit" || x.kind === "appointment" || x.kind === "invoice");
    return {
      lastVisit,
      appointments: e.filter((x) => x.kind === "appointment").length,
      invoices: e.filter((x) => x.kind === "invoice").length,
      prescriptions: e.filter((x) => x.kind === "prescription").length,
    };
  }, [data]);

  if (ownerId === "walkin") {
    return <div className="py-6 text-center text-sm text-muted-foreground">Walk-in customer — no profile history.</div>;
  }
  if (isLoading) return <div className="py-6 text-center text-sm text-muted-foreground">Loading history…</div>;

  const events = data?.events ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Last visit</div>
          <div className="text-sm font-medium">
            {summary.lastVisit ? format(new Date(summary.lastVisit.at), "dd MMM yyyy") : "—"}
          </div>
          {summary.lastVisit && (
            <div className="text-xs text-muted-foreground">
              {meta[summary.lastVisit.kind].label} · {summary.lastVisit.title}
            </div>
          )}
        </div>
        <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Appointments</div><div className="text-lg font-semibold">{summary.appointments}</div></div>
        <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Invoices</div><div className="text-lg font-semibold">{summary.invoices}</div></div>
        <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Prescriptions</div><div className="text-lg font-semibold">{summary.prescriptions}</div></div>
      </div>

      {(data?.pets?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2">
          {data!.pets.map((p: any) => (
            <Badge key={p.id} variant="secondary" className="gap-1">
              <PawPrint className="h-3 w-3" /> {p.name} <span className="opacity-60 capitalize">({p.species})</span>
            </Badge>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">No history.</div>
      ) : (
        <ol className="relative border-l pl-4 space-y-3">
          {events.map((e) => {
            const m = meta[e.kind];
            const Icon = m.icon;
            return (
              <li key={e.id} className="relative">
                <span className={`absolute -left-[26px] flex h-5 w-5 items-center justify-center rounded-full ${m.cls}`}>
                  <Icon className="h-3 w-3" />
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {format(new Date(e.at), "dd MMM yyyy, hh:mm a")}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{m.label}</Badge>
                  {e.status && <Badge variant="secondary" className="text-[10px] capitalize">{e.status.replace("_", " ")}</Badge>}
                  {e.amount != null && <span className="text-xs font-medium tabular-nums">{fmt(e.amount)}</span>}
                </div>
                <div className="text-sm font-medium">{e.title}</div>
                {e.detail && <div className="text-xs text-muted-foreground">{e.detail}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
