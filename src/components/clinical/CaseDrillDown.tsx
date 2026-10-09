import { ChevronRight, PawPrint, X } from "lucide-react";
import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DIMENSION_LABELS,
  ageLabel,
  applyCrumbs,
  buckets,
  patientSummaries,
  repeatPatientCount,
  uniquePatients,
  type CaseRow,
  type Crumb,
  type Dimension,
} from "@/lib/clinical-intel";

const BREAKDOWNS: Dimension[] = [
  "species",
  "breed",
  "gender",
  "weight",
  "age",
  "symptom",
  "diagnosis",
  "medicine",
  "test",
  "surgery",
  "doctor",
];

export function CaseDrillDown({
  rows,
  crumbs,
  setCrumbs,
  onOpenPatient,
}: {
  rows: CaseRow[];
  crumbs: Crumb[];
  setCrumbs: (c: Crumb[]) => void;
  onOpenPatient: (petId: string) => void;
}) {
  const open = crumbs.length > 0;
  const scoped = applyCrumbs(rows, crumbs);
  const last = crumbs[crumbs.length - 1];
  const patients = patientSummaries(scoped);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) setCrumbs([]); }}>
      <SheetContent className="w-full sm:max-w-3xl p-0">
        <div className="border-b px-6 py-4">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-lg">
              {last ? `${DIMENSION_LABELS[last.dim]}: ${last.value}` : "Case drill-down"}
            </SheetTitle>
            <SheetDescription>
              {scoped.length} case{scoped.length === 1 ? "" : "s"} · {uniquePatients(scoped)} patients ·{" "}
              {repeatPatientCount(scoped)} repeat · historical records only
            </SheetDescription>
          </SheetHeader>

          <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setCrumbs([])}>
              All cases
            </button>
            {crumbs.map((c, i) => (
              <span key={`${c.dim}-${c.value}`} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <button
                  className="rounded bg-muted px-2 py-0.5 font-medium hover:bg-accent"
                  onClick={() => setCrumbs(crumbs.slice(0, i + 1))}
                >
                  {c.value}
                </button>
              </span>
            ))}
            {crumbs.length > 1 && (
              <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => setCrumbs(crumbs.slice(0, -1))}>
                <X className="mr-1 h-3 w-3" /> Back
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="h-[calc(100vh-9.5rem)]">
          <div className="space-y-5 px-6 py-5">
            {scoped.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No clinical records for this selection.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {BREAKDOWNS.filter((dim) => buckets(scoped, dim, 8).length > 0).map((dim) => (
                    <div key={dim} className="rounded-lg border">
                      <div className="border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {DIMENSION_LABELS[dim]}
                      </div>
                      <div className="divide-y">
                        {buckets(scoped, dim, 8).map((b) => (
                          <button
                            key={b.name}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                            onClick={() => setCrumbs([...crumbs, { dim, value: b.name }])}
                          >
                            <span className="flex-1 truncate">{b.name}</span>
                            <Badge variant="secondary" className="tabular-nums">{b.count}</Badge>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border">
                  <div className="border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Patients ({patients.length})
                  </div>
                  <div className="divide-y">
                    {patients.map((p) => (
                      <button
                        key={p.petId}
                        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                        onClick={() => onOpenPatient(p.petId)}
                      >
                        <PawPrint className="h-3.5 w-3.5 text-primary" />
                        <span className="font-medium">{p.petName}</span>
                        <span className="text-xs text-muted-foreground">{p.ownerName}</span>
                        <Badge variant="outline" className="text-[10px]">{p.species}</Badge>
                        {p.breed !== "Unknown" && <span className="text-xs text-muted-foreground">{p.breed}</span>}
                        <span className="text-xs text-muted-foreground">
                          {ageLabel(p.ageMonths)}
                          {p.weightKg != null ? ` · ${p.weightKg} kg` : ""}
                        </span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {p.cases} case{p.cases === 1 ? "" : "s"} · {format(new Date(p.lastVisit), "dd MMM yy")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border">
                  <div className="border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Case timeline
                  </div>
                  <div className="divide-y">
                    {scoped.slice(0, 60).map((r) => (
                      <div key={r.id} className="px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {format(new Date(r.visitDate), "dd MMM yyyy")}
                          </span>
                          <button className="font-medium hover:underline" onClick={() => onOpenPatient(r.petId)}>
                            {r.petName}
                          </button>
                          <Badge variant="outline" className="text-[10px]">{r.species}</Badge>
                          <span className="text-xs text-muted-foreground">{r.doctorName}</span>
                        </div>
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {r.symptoms.length > 0 && <div>Symptoms: {r.symptoms.join(" · ")}</div>}
                          {r.diagnoses.length > 0 && <div>Diagnosis: {r.diagnoses.join(" · ")}</div>}
                          {r.tests.length > 0 && <div>Investigations: {r.tests.join(" · ")}</div>}
                          {r.medicines.length > 0 && <div>Prescribed: {r.medicines.join(" · ")}</div>}
                          {r.surgeryTypes.length > 0 && <div>Surgery: {r.surgeryTypes.join(" · ")}</div>}
                          {r.followUpDate && <div>Follow-up: {r.followUpDate}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
