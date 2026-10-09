import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Users, Search, Cake, MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAll } from "@/lib/fetch-all";
import { todayDhaka } from "@/lib/sales-ledger";
import { shiftDay } from "@/lib/sales-summary";

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM — Pet Care Vet ERP" }] }),
  component: CrmPage,
});

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

function CrmPage() {
  const [owners, setOwners] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [vacc, setVacc] = useState<any[]>([]);
  const [pets, setPets] = useState<any[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      // Paged: each list was silently cut at 1000 rows by the API.
      try {
        const [o, s, v, p] = await Promise.all([
          fetchAll(() => supabase.from("pet_owners").select("*").order("full_name").order("id"), 200000),
          fetchAll(() => supabase.from("sales").select("id,owner_id,total,paid,due,status,created_at").order("id"), 500000),
          fetchAll(() => supabase.from("vaccinations").select("*").not("next_due_date", "is", null).order("id"), 200000),
          fetchAll(() => supabase.from("pets").select("id,name,owner_id,species,date_of_birth").order("id"), 200000)
            // the column is date_of_birth; selecting a non-existent "birthday"
            // made this request fail, so pet counts and birthdays were empty
            .then((rows: any[]) => rows.map((r) => ({ ...r, birthday: r.date_of_birth }))),
        ]);
        setOwners(o); setSales(s); setVacc(v); setPets(p);
      } catch (err: any) {
        toast.error(err?.message ?? "Could not load CRM data");
      }
    })();
  }, []);

  const enriched = useMemo(() => {
    // Group once (was a full scan of all sales/pets per customer) and skip
    // cancelled invoices; paid + due is the value after returns.
    const salesByOwner = new Map<string, any[]>();
    for (const s of sales) {
      if (!s.owner_id || s.status === "void") continue;
      const arr = salesByOwner.get(s.owner_id) ?? [];
      arr.push(s);
      salesByOwner.set(s.owner_id, arr);
    }
    const petsByOwner = new Map<string, number>();
    for (const p of pets) if (p.owner_id) petsByOwner.set(p.owner_id, (petsByOwner.get(p.owner_id) ?? 0) + 1);
    return owners.map(o => {
      const os = salesByOwner.get(o.id) ?? [];
      const spend = os.reduce((a, s) => a + Number(s.paid) + Number(s.due), 0);
      const due = os.reduce((a, s) => a + Number(s.due), 0);
      const last = os.map(s => s.created_at).sort().at(-1);
      const petCount = petsByOwner.get(o.id) ?? 0;
      return { ...o, spend, due, last, visits: os.length, petCount };
    }).filter(o => !q || o.full_name.toLowerCase().includes(q.toLowerCase()) || (o.phone || "").includes(q));
  }, [owners, sales, pets, q]);

  const upcomingVacc = useMemo(() => {
    const today = todayDhaka();
    const next30 = shiftDay(today, 30);
    return vacc
      .filter(v => v.next_due_date >= today && v.next_due_date <= next30)
      .map(v => {
        const pet = pets.find(p => p.id === v.pet_id);
        const owner = owners.find(o => o.id === pet?.owner_id);
        return { ...v, petName: pet?.name, ownerName: owner?.full_name, ownerPhone: owner?.phone };
      })
      .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date));
  }, [vacc, pets, owners]);

  const birthdays = useMemo(() => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const list: any[] = [];
    pets.filter(p => p.birthday).forEach(p => {
      if (p.birthday.slice(5, 7) === mm) {
        const owner = owners.find(o => o.id === p.owner_id);
        list.push({ ...p, ownerName: owner?.full_name, ownerPhone: owner?.phone });
      }
    });
    return list;
  }, [pets, owners]);

  return (
    <div className="p-0 sm:p-2">
      <PageHeader title="CRM" description="Customers, retention & outreach" icon={Users} />

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="vaccine">Vaccination Reminders</TabsTrigger>
          <TabsTrigger value="birthdays">Birthdays This Month</TabsTrigger>
        </TabsList>

        <TabsContent value="customers">
          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Customer List</CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search name / phone" className="pl-8" value={q} onChange={e => setQ(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Name</TableHead><TableHead>Phone</TableHead>
                  <TableHead>Pets</TableHead><TableHead>Visits</TableHead>
                  <TableHead>Last Visit</TableHead>
                  <TableHead className="text-right">Lifetime</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {enriched.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.full_name}</TableCell>
                      <TableCell>{o.phone || "—"}</TableCell>
                      <TableCell>{o.petCount}</TableCell>
                      <TableCell>{o.visits}</TableCell>
                      <TableCell>{o.last ? new Date(o.last).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-right">{fmt(o.spend)}</TableCell>
                      <TableCell className="text-right">{o.due > 0 ? <span className="text-destructive font-medium">{fmt(o.due)}</span> : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {enriched.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No customers</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vaccine">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageCircle className="h-4 w-4" /> Due in next 30 days</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Due Date</TableHead><TableHead>Pet</TableHead>
                  <TableHead>Vaccine</TableHead><TableHead>Owner</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {upcomingVacc.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nothing due soon</TableCell></TableRow>}
                  {upcomingVacc.map(v => (
                    <TableRow key={v.id}>
                      <TableCell><Badge>{v.next_due_date}</Badge></TableCell>
                      <TableCell>{v.petName || "—"}</TableCell>
                      <TableCell>{v.vaccine_name}</TableCell>
                      <TableCell>{v.ownerName || "—"}</TableCell>
                      <TableCell>{v.ownerPhone || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="birthdays">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Cake className="h-4 w-4" /> Pet birthdays this month</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Birthday</TableHead><TableHead>Pet</TableHead>
                  <TableHead>Species</TableHead><TableHead>Owner</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {birthdays.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No birthdays this month</TableCell></TableRow>}
                  {birthdays.map(p => (
                    <TableRow key={p.id}>
                      <TableCell>{p.birthday}</TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="capitalize">{p.species}</TableCell>
                      <TableCell>{p.ownerName || "—"}</TableCell>
                      <TableCell>{p.ownerPhone || "—"}</TableCell>
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
