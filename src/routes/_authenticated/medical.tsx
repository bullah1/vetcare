import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/medical")({
  head: () => ({ meta: [{ title: "Medical Records — Pet Care Vet ERP" }] }),
  component: MedicalPage,
});

function MedicalPage() {
  const { data: records = [] } = useQuery({
    queryKey: ["medical-recent"],
    queryFn: async () => {
      const { data, error } = await supabase.from("medical_records")
        .select("*, pet:pets(name,species,owner:pet_owners(full_name)), doctor:doctors(full_name)")
        .order("visit_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div>
      <PageHeader
        title="Medical Records"
        description="Recent visits across all patients. Add new records from a pet's profile."
        icon={Stethoscope}
      />
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Pet</TableHead><TableHead>Owner</TableHead>
            <TableHead>Doctor</TableHead><TableHead>Diagnosis</TableHead><TableHead>Treatment</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {records.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No medical records yet. Open a pet's profile to add one.</TableCell></TableRow>}
            {records.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.visit_date).toLocaleDateString()}</TableCell>
                <TableCell className="font-medium">{r.pet?.name ?? "—"}</TableCell>
                <TableCell>{r.pet?.owner?.full_name ?? "—"}</TableCell>
                <TableCell>{r.doctor?.full_name ?? "—"}</TableCell>
                <TableCell className="max-w-64 truncate">{r.diagnosis ?? "—"}</TableCell>
                <TableCell className="max-w-64 truncate">{r.treatment ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
