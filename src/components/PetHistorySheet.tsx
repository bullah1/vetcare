import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { PawPrint, User, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { money } from "@/components/ReceiveAppointmentCashDialog";

export function PetHistorySheet({ petId, onClose }: { petId: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["pet-history", petId],
    enabled: !!petId,
    queryFn: async () => {
      const { data: pet } = await supabase
        .from("pets")
        .select("*, owner:pet_owners(id,full_name,phone,address,gender)")
        .eq("id", petId!)
        .maybeSingle();

      const ownerId = (pet as any)?.owner?.id ?? null;

      const [appts, recs, presc, vacc, sales] = await Promise.all([
        supabase
          .from("appointments")
          .select("id,serial_no,scheduled_at,status,reason,fee,paid,doctor:doctors(full_name)")
          .eq("pet_id", petId!)
          .order("scheduled_at", { ascending: false })
          .limit(100),
        supabase
          .from("medical_records")
          .select("id,visit_date,weight_kg,symptoms,diagnosis,treatment,doctor:doctors(full_name)")
          .eq("pet_id", petId!)
          .order("visit_date", { ascending: false })
          .limit(100),
        supabase
          .from("prescriptions")
          .select("id,issued_at,notes,items:prescription_items(medicine_name,dosage,frequency,duration)")
          .eq("pet_id", petId!)
          .order("issued_at", { ascending: false })
          .limit(100),
        supabase
          .from("vaccinations")
          .select("id,vaccine_name,administered_at,next_due_date")
          .eq("pet_id", petId!)
          .order("administered_at", { ascending: false })
          .limit(100),
        ownerId
          ? supabase.from("sales").select("id,invoice_no,created_at,total,due,status").eq("owner_id", ownerId).neq("status", "void").order("created_at", { ascending: false }).limit(200)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const saleRows = (sales.data ?? []) as any[];
      return {
        pet,
        appts: (appts.data ?? []) as any[],
        recs: (recs.data ?? []) as any[],
        presc: (presc.data ?? []) as any[],
        vacc: (vacc.data ?? []) as any[],
        totalSales: saleRows.reduce((s, r) => s + Number(r.total || 0), 0),
        totalDue: saleRows.reduce((s, r) => s + Number(r.due || 0), 0),
        visits: (recs.data ?? []).length,
      };
    },
  });

  const pet: any = data?.pet;
  const latestWeight = data?.recs?.find((r) => r.weight_kg != null)?.weight_kg ?? pet?.weight_kg ?? null;

  return (
    <Sheet open={!!petId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <PawPrint className="h-4 w-4 text-primary" />
            {pet?.name ?? "Pet profile"}
            {pet?.species && <Badge variant="outline" className="capitalize">{pet.species}</Badge>}
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading history…</div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Weight" value={latestWeight != null ? `${latestWeight} kg` : "—"} />
              <Stat label="Visits" value={String(data?.visits ?? 0)} />
              <Stat label="Total sales" value={money(data?.totalSales ?? 0)} />
              <Stat label="Due" value={money(data?.totalDue ?? 0)} />
            </div>

            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" /> {pet?.owner?.full_name ?? "—"}</div>
              {pet?.owner?.phone && <div className="flex items-center gap-2 text-muted-foreground text-xs"><Phone className="h-3.5 w-3.5" /> {pet.owner.phone}</div>}
              {pet?.owner?.address && <div className="text-xs text-muted-foreground">{pet.owner.address}</div>}
              <div className="text-xs text-muted-foreground">
                {[pet?.breed, pet?.gender, pet?.color, pet?.date_of_birth ? `DOB ${pet.date_of_birth}` : null].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>

            <Tabs defaultValue="appointments">
              <TabsList className="flex-wrap">
                <TabsTrigger value="appointments">Appointments</TabsTrigger>
                <TabsTrigger value="visits">Visits</TabsTrigger>
                <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
                <TabsTrigger value="vaccinations">Vaccinations</TabsTrigger>
              </TabsList>

              <TabsContent value="appointments" className="mt-3 space-y-2">
                {(data?.appts.length ?? 0) === 0 && <Empty />}
                {data?.appts.map((a) => (
                  <div key={a.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">#{a.serial_no ?? "-"}</Badge>
                      <span className="tabular-nums text-xs text-muted-foreground">{format(new Date(a.scheduled_at), "dd MMM yyyy, hh:mm a")}</span>
                      <Badge variant="secondary" className="capitalize">{String(a.status).replace("_", " ")}</Badge>
                      <span className="ml-auto text-xs tabular-nums">
                        {money(Number(a.fee || 0))} · paid {money(Number(a.paid || 0))}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {[a.doctor?.full_name ? `Dr. ${a.doctor.full_name}` : null, a.reason].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="visits" className="mt-3 space-y-2">
                {(data?.recs.length ?? 0) === 0 && <Empty />}
                {data?.recs.map((r) => (
                  <div key={r.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{format(new Date(r.visit_date), "dd MMM yyyy")}</span>
                      {r.doctor?.full_name && <span>· Dr. {r.doctor.full_name}</span>}
                      {r.weight_kg != null && <Badge variant="outline">{r.weight_kg} kg</Badge>}
                    </div>
                    {r.diagnosis && <div className="mt-1"><span className="text-muted-foreground text-xs">Diagnosis: </span>{r.diagnosis}</div>}
                    {r.symptoms && <div className="text-xs text-muted-foreground">Symptoms: {r.symptoms}</div>}
                    {r.treatment && <div className="text-xs text-muted-foreground">Treatment: {r.treatment}</div>}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="prescriptions" className="mt-3 space-y-2">
                {(data?.presc.length ?? 0) === 0 && <Empty />}
                {data?.presc.map((p) => (
                  <div key={p.id} className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground tabular-nums">{format(new Date(p.issued_at), "dd MMM yyyy")}</div>
                    <ul className="mt-1 space-y-0.5">
                      {(p.items ?? []).map((i: any, idx: number) => (
                        <li key={idx} className="text-xs">
                          <span className="font-medium">{i.medicine_name}</span>
                          {[i.dosage, i.frequency, i.duration].filter(Boolean).length > 0 && (
                            <span className="text-muted-foreground"> — {[i.dosage, i.frequency, i.duration].filter(Boolean).join(" · ")}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {p.notes && <div className="text-xs text-muted-foreground mt-1">{p.notes}</div>}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="vaccinations" className="mt-3 space-y-2">
                {(data?.vacc.length ?? 0) === 0 && <Empty />}
                {data?.vacc.map((v) => (
                  <div key={v.id} className="rounded-md border p-3 text-sm flex flex-wrap items-center gap-2">
                    <span className="font-medium">{v.vaccine_name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{v.administered_at}</span>
                    {v.next_due_date && <Badge variant="outline">Next due {v.next_due_date}</Badge>}
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Empty() {
  return <div className="py-6 text-center text-sm text-muted-foreground">No records.</div>;
}
