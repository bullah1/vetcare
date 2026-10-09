import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PawPrint, Plus, Search, User, Stethoscope, Pill, Syringe, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { printVaccinationCertificate } from "@/lib/vaccination-certificate";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/pets")({
  head: () => ({ meta: [{ title: "Pets & Owners — Pet Care Vet ERP" }] }),
  component: PetsPage,
});

const SPECIES = ["dog", "cat", "bird", "cow", "goat", "rabbit", "other"] as const;

type Owner = { id: string; full_name: string; phone: string | null; email: string | null; address: string | null };
type Pet = { id: string; owner_id: string; name: string; species: string; breed: string | null; gender: string | null; date_of_birth: string | null; weight_kg: number | null; color: string | null; notes: string | null };

function PetsPage() {
  const [selectedPet, setSelectedPet] = useState<Pet | null>(null);

  return (
    <div>
      <PageHeader title="Pets & Owners" description="Full patient registry." icon={PawPrint} />
      <Tabs defaultValue="pets">
        <TabsList>
          <TabsTrigger value="pets">Pets</TabsTrigger>
          <TabsTrigger value="owners">Owners</TabsTrigger>
        </TabsList>
        <TabsContent value="pets" className="mt-4"><PetsTab onOpen={setSelectedPet} /></TabsContent>
        <TabsContent value="owners" className="mt-4"><OwnersTab /></TabsContent>
      </Tabs>
      <PetDetailSheet pet={selectedPet} onClose={() => setSelectedPet(null)} />
    </div>
  );
}

/* ---------- Owners ---------- */

function OwnersTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", address: "" });
  const [q, setQ] = useState("");

  const { data: owners = [] } = useQuery({
    queryKey: ["owners", "list"],
    queryFn: async () => {
      return fetchAll<Owner>(() => supabase.from("pet_owners").select("*").order("full_name").order("id"), 200000);
    },
  });

  const filtered = owners.filter((o) => {
    const s = q.toLowerCase();
    return !s || o.full_name.toLowerCase().includes(s) || o.phone?.toLowerCase().includes(s);
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pet_owners").insert(form);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Owner added");
      qc.invalidateQueries({ queryKey: ["owners"] });
      setForm({ full_name: "", phone: "", email: "", address: "" });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search owners..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> New owner</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New owner</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2"><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="space-y-2"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>Address</Label><Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={!form.full_name || create.isPending}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>Address</TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No owners.</TableCell></TableRow>}
            {filtered.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" />{o.full_name}</TableCell>
                <TableCell>{o.phone ?? "—"}</TableCell>
                <TableCell>{o.email ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{o.address ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

/* ---------- Pets ---------- */

function PetsTab({ onOpen }: { onOpen: (p: Pet) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ owner_id: "", name: "", species: "dog", breed: "", gender: "", date_of_birth: "", weight_kg: 0, color: "", notes: "" });

  const { data: owners = [] } = useQuery({
    queryKey: ["owners", "picker"],
    queryFn: () => fetchAll<{ id: string; full_name: string }>(() => supabase.from("pet_owners").select("id,full_name").order("full_name").order("id"), 200000),
  });

  const { data: pets = [] } = useQuery({
    queryKey: ["pets"],
    queryFn: async () => {
      return fetchAll<Pet & { owner: { full_name: string; phone: string | null } | null }>(
        () => supabase.from("pets").select("*, owner:pet_owners(full_name,phone)").order("name").order("id"),
        200000,
      );
    },
  });

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return pets.filter((p) => !s || p.name.toLowerCase().includes(s) || p.owner?.full_name.toLowerCase().includes(s));
  }, [pets, q]);

  const create = useMutation({
    mutationFn: async () => {
      const payload: any = { ...form, weight_kg: form.weight_kg || null, date_of_birth: form.date_of_birth || null };
      const { error } = await supabase.from("pets").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pet added");
      qc.invalidateQueries({ queryKey: ["pets"] });
      setForm({ owner_id: "", name: "", species: "dog", breed: "", gender: "", date_of_birth: "", weight_kg: 0, color: "", notes: "" });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search pets or owners..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> New pet</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New pet</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Owner</Label>
                <Select value={form.owner_id} onValueChange={(v) => setForm({ ...form, owner_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose owner" /></SelectTrigger>
                  <SelectContent>{owners.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Pet name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Species</Label>
                <Select value={form.species} onValueChange={(v) => setForm({ ...form, species: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SPECIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Breed</Label><Input value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} /></div>
              <div className="space-y-2"><Label>Gender</Label><Input value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} placeholder="male / female" /></div>
              <div className="space-y-2"><Label>Date of birth</Label><Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></div>
              <div className="space-y-2"><Label>Weight (kg)</Label><Input type="number" step="0.1" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: Number(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Color</Label><Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={!form.owner_id || !form.name || create.isPending}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Pet</TableHead><TableHead>Species</TableHead><TableHead>Breed</TableHead><TableHead>Owner</TableHead><TableHead>Phone</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No pets yet.</TableCell></TableRow>}
            {filtered.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => onOpen(p)}>
                <TableCell className="font-medium flex items-center gap-2"><PawPrint className="h-4 w-4 text-primary" />{p.name}</TableCell>
                <TableCell><Badge variant="outline">{p.species}</Badge></TableCell>
                <TableCell>{p.breed ?? "—"}</TableCell>
                <TableCell>{p.owner?.full_name ?? "—"}</TableCell>
                <TableCell>{p.owner?.phone ?? "—"}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="ghost">Open</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

/* ---------- Pet Detail Sheet ---------- */

function PetDetailSheet({ pet, onClose }: { pet: Pet | null; onClose: () => void }) {
  return (
    <Sheet open={!!pet} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        {pet && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2"><PawPrint className="h-5 w-5 text-primary" />{pet.name}</SheetTitle>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{pet.species}</Badge>
                {pet.breed && <span>{pet.breed}</span>}
                {pet.gender && <span>· {pet.gender}</span>}
                {pet.weight_kg && <span>· {pet.weight_kg} kg</span>}
              </div>
            </SheetHeader>
            <div className="mt-4">
              <Tabs defaultValue="medical">
                <TabsList className="w-full">
                  <TabsTrigger value="medical" className="flex-1"><Stethoscope className="h-3.5 w-3.5" /> Medical</TabsTrigger>
                  <TabsTrigger value="rx" className="flex-1"><Pill className="h-3.5 w-3.5" /> Prescriptions</TabsTrigger>
                  <TabsTrigger value="vax" className="flex-1"><Syringe className="h-3.5 w-3.5" /> Vaccinations</TabsTrigger>
                </TabsList>
                <TabsContent value="medical" className="mt-4"><PetMedical petId={pet.id} /></TabsContent>
                <TabsContent value="rx" className="mt-4"><PetRx petId={pet.id} /></TabsContent>
                <TabsContent value="vax" className="mt-4"><PetVax petId={pet.id} pet={pet} /></TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PetMedical({ petId }: { petId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ weight_kg: 0, temperature: 0, symptoms: "", diagnosis: "", treatment: "", notes: "" });
  const { data: records = [] } = useQuery({
    queryKey: ["records", petId],
    queryFn: async () => (await supabase.from("medical_records").select("*").eq("pet_id", petId).order("visit_date", { ascending: false })).data ?? [],
  });
  const create = useMutation({
    mutationFn: async () => {
      const payload: any = { pet_id: petId, ...form, weight_kg: form.weight_kg || null, temperature: form.temperature || null };
      const { error } = await supabase.from("medical_records").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Record saved"); qc.invalidateQueries({ queryKey: ["records", petId] }); setForm({ weight_kg: 0, temperature: 0, symptoms: "", diagnosis: "", treatment: "", notes: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <Card><CardContent className="p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">New visit</p>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" step="0.1" placeholder="Weight (kg)" value={form.weight_kg || ""} onChange={(e) => setForm({ ...form, weight_kg: Number(e.target.value) })} />
          <Input type="number" step="0.1" placeholder="Temp (°C)" value={form.temperature || ""} onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} />
        </div>
        <Textarea rows={2} placeholder="Symptoms" value={form.symptoms} onChange={(e) => setForm({ ...form, symptoms: e.target.value })} />
        <Textarea rows={2} placeholder="Diagnosis" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
        <Textarea rows={2} placeholder="Treatment" value={form.treatment} onChange={(e) => setForm({ ...form, treatment: e.target.value })} />
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>Save record</Button>
      </CardContent></Card>
      {records.map((r: any) => (
        <Card key={r.id}><CardContent className="p-3 space-y-1 text-sm">
          <p className="text-xs text-muted-foreground">{new Date(r.visit_date).toLocaleString()}</p>
          {r.diagnosis && <p><span className="font-medium">Diagnosis:</span> {r.diagnosis}</p>}
          {r.treatment && <p><span className="font-medium">Treatment:</span> {r.treatment}</p>}
          {r.symptoms && <p className="text-muted-foreground">{r.symptoms}</p>}
        </CardContent></Card>
      ))}
      {records.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">No records yet.</p>}
    </div>
  );
}

function PetRx({ petId }: { petId: string }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<{ medicine_name: string; dosage: string; frequency: string; duration: string; instructions: string }[]>([
    { medicine_name: "", dosage: "", frequency: "", duration: "", instructions: "" },
  ]);
  const [notes, setNotes] = useState("");

  const { data: list = [] } = useQuery({
    queryKey: ["rx", petId],
    queryFn: async () => (await supabase.from("prescriptions").select("*, items:prescription_items(*)").eq("pet_id", petId).order("issued_at", { ascending: false })).data ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      const valid = items.filter((i) => i.medicine_name.trim());
      if (valid.length === 0) throw new Error("Add at least one medicine");
      const { data: rx, error } = await supabase.from("prescriptions").insert({ pet_id: petId, notes } as any).select().single();
      if (error) throw error;
      const { error: ie } = await supabase.from("prescription_items").insert(valid.map((i) => ({ prescription_id: rx.id, ...i })) as any);
      if (ie) throw ie;
    },
    onSuccess: () => { toast.success("Prescription saved"); qc.invalidateQueries({ queryKey: ["rx", petId] }); setItems([{ medicine_name: "", dosage: "", frequency: "", duration: "", instructions: "" }]); setNotes(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <Card><CardContent className="p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">New prescription</p>
        {items.map((it, idx) => (
          <div key={idx} className="grid grid-cols-2 gap-2 border-b pb-2">
            <Input placeholder="Medicine" value={it.medicine_name} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, medicine_name: e.target.value } : x))} className="col-span-2" />
            <Input placeholder="Dosage (e.g. 5mg)" value={it.dosage} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, dosage: e.target.value } : x))} />
            <Input placeholder="Frequency (e.g. 2x/day)" value={it.frequency} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, frequency: e.target.value } : x))} />
            <Input placeholder="Duration (e.g. 7 days)" value={it.duration} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, duration: e.target.value } : x))} />
            <Input placeholder="Instructions" value={it.instructions} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, instructions: e.target.value } : x))} />
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setItems([...items, { medicine_name: "", dosage: "", frequency: "", duration: "", instructions: "" }])}><Plus className="h-3 w-3" /> Add medicine</Button>
        <Textarea rows={2} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>Save prescription</Button>
      </CardContent></Card>
      {list.map((rx: any) => (
        <Card key={rx.id}><CardContent className="p-3 text-sm space-y-1">
          <p className="text-xs text-muted-foreground">{new Date(rx.issued_at).toLocaleString()}</p>
          <ul className="list-disc pl-4">
            {rx.items?.map((it: any) => <li key={it.id}><span className="font-medium">{it.medicine_name}</span> — {it.dosage} · {it.frequency} · {it.duration}</li>)}
          </ul>
          {rx.notes && <p className="text-muted-foreground">{rx.notes}</p>}
        </CardContent></Card>
      ))}
      {list.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">No prescriptions yet.</p>}
    </div>
  );
}

function PetVax({ petId, pet }: { petId: string; pet: Pet & { owner?: { full_name: string; phone: string | null } | null } }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ vaccine_name: "", administered_at: new Date().toISOString().slice(0, 10), next_due_date: "", batch_no: "", notes: "" });
  const { data: list = [] } = useQuery({
    queryKey: ["vax", petId],
    queryFn: async () => (await supabase.from("vaccinations").select("*, doctor:doctors(full_name)").eq("pet_id", petId).order("administered_at", { ascending: false })).data ?? [],
  });
  const create = useMutation({
    mutationFn: async () => {
      const payload: any = { pet_id: petId, ...form, next_due_date: form.next_due_date || null };
      const { error } = await supabase.from("vaccinations").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Vaccination recorded"); qc.invalidateQueries({ queryKey: ["vax", petId] }); setForm({ vaccine_name: "", administered_at: new Date().toISOString().slice(0, 10), next_due_date: "", batch_no: "", notes: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const printCert = (records: any[]) => {
    if (records.length === 0) { toast.error("No vaccination records to print"); return; }
    printVaccinationCertificate({
      petName: pet.name,
      species: pet.species,
      breed: pet.breed,
      gender: pet.gender,
      ownerName: pet.owner?.full_name ?? null,
      ownerPhone: pet.owner?.phone ?? null,
      vaccinations: records.map((v) => ({
        vaccine_name: v.vaccine_name,
        administered_at: v.administered_at,
        next_due_date: v.next_due_date,
        batch_no: v.batch_no,
        notes: v.notes,
        doctor_name: v.doctor?.full_name ?? null,
      })),
    });
  };

  return (
    <div className="space-y-3">
      <Card><CardContent className="p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">New vaccination</p>
        <Input placeholder="Vaccine name" value={form.vaccine_name} onChange={(e) => setForm({ ...form, vaccine_name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Given on</Label><Input type="date" value={form.administered_at} onChange={(e) => setForm({ ...form, administered_at: e.target.value })} /></div>
          <div><Label className="text-xs">Next due</Label><Input type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} /></div>
        </div>
        <Input placeholder="Batch #" value={form.batch_no} onChange={(e) => setForm({ ...form, batch_no: e.target.value })} />
        <Textarea rows={2} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <Button size="sm" onClick={() => create.mutate()} disabled={!form.vaccine_name || create.isPending}>Save</Button>
      </CardContent></Card>
      {list.length > 0 && (
        <Button size="sm" variant="outline" className="w-full" onClick={() => printCert(list)}>
          <Printer className="h-4 w-4" /> Print vaccination certificate
        </Button>
      )}
      {list.map((v: any) => {
        const due = v.next_due_date && new Date(v.next_due_date) < new Date();
        return (
          <Card key={v.id}><CardContent className="p-3 text-sm">
            <div className="flex justify-between items-start gap-2">
              <div>
                <p className="font-medium">{v.vaccine_name}</p>
                <p className="text-xs text-muted-foreground">Given {new Date(v.administered_at).toLocaleDateString()}{v.batch_no && ` · Batch ${v.batch_no}`}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {v.next_due_date && <Badge variant={due ? "destructive" : "outline"}>Next: {new Date(v.next_due_date).toLocaleDateString()}</Badge>}
                <Button size="sm" variant="ghost" onClick={() => printCert([v])}><Printer className="h-3.5 w-3.5" /> Certificate</Button>
              </div>
            </div>
          </CardContent></Card>
        );
      })}
      {list.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">No vaccinations yet.</p>}
    </div>
  );
}
