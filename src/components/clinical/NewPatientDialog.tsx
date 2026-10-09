import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PawPrint } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OwnerOption } from "@/components/CustomerPetPicker";

const SPECIES = ["dog", "cat", "bird", "cow", "goat", "rabbit", "other"] as const;
const digits = (s: string) => (s || "").replace(/\D/g, "");

/**
 * One-stop new patient: pet + owner in a single save. An existing owner with the
 * same phone (or exact name when no phone) is reused, so no duplicate is created.
 */
export function NewPatientDialog({
  open,
  onOpenChange,
  owners,
  onCreated,
  presetOwnerId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  owners: OwnerOption[];
  onCreated: (petId: string, ownerId: string) => void;
  presetOwnerId?: string;
}) {
  const qc = useQueryClient();
  const preset = owners.find((o) => o.id === presetOwnerId) ?? null;

  const [name, setName] = useState("");
  const [species, setSpecies] = useState<string>("dog");
  const [breed, setBreed] = useState("");
  const [gender, setGender] = useState("");
  const [ageYears, setAgeYears] = useState("");
  const [ageMonths, setAgeMonths] = useState("");
  const [weight, setWeight] = useState("");
  const [ownerName, setOwnerName] = useState(preset?.full_name ?? "");
  const [ownerPhone, setOwnerPhone] = useState(preset?.phone ?? "");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const reset = () => {
    setName(""); setSpecies("dog"); setBreed(""); setGender("");
    setAgeYears(""); setAgeMonths(""); setWeight("");
    setOwnerName(""); setOwnerPhone(""); setNotes(""); setPhotoUrl("");
  };

  const create = useMutation({
    mutationFn: async () => {
      const petName = name.trim();
      if (!petName) throw new Error("Pet name is required");

      let ownerId = presetOwnerId ?? "";
      if (!ownerId) {
        const oname = ownerName.trim();
        const ophone = ownerPhone.trim();
        if (!oname) throw new Error("Owner name is required");
        const pd = digits(ophone);
        const dupe = owners.find(
          (o) =>
            (pd && o.phone && digits(o.phone) === pd) ||
            (!pd && o.full_name.trim().toLowerCase() === oname.toLowerCase()),
        );
        if (dupe) {
          ownerId = dupe.id;
        } else {
          const { data, error } = await supabase
            .from("pet_owners")
            .insert({ full_name: oname, phone: ophone || null })
            .select("id")
            .single();
          if (error) throw error;
          ownerId = data.id as string;
        }
      }

      // Age (years/months) is stored as an approximate date of birth.
      let dob: string | null = null;
      const y = Number(ageYears) || 0;
      const m = Number(ageMonths) || 0;
      if (y || m) {
        const d = new Date();
        d.setFullYear(d.getFullYear() - y);
        d.setMonth(d.getMonth() - m);
        dob = d.toISOString().slice(0, 10);
      }

      const { data: pet, error: petErr } = await supabase
        .from("pets")
        .insert({
          owner_id: ownerId,
          name: petName,
          species: species as any,
          breed: breed.trim() || null,
          gender: gender || null,
          weight_kg: weight ? Number(weight) : null,
          date_of_birth: dob,
          notes: notes.trim() || null,
          photo_url: photoUrl.trim() || null,
        })
        .select("id")
        .single();
      if (petErr) throw petErr;
      return { petId: pet.id as string, ownerId };
    },
    onSuccess: async ({ petId, ownerId }) => {
      await qc.invalidateQueries({ queryKey: ["owners"] });
      await qc.invalidateQueries({ queryKey: ["pets"] });
      toast.success("Patient added");
      onOpenChange(false);
      reset();
      onCreated(petId, ownerId);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save patient"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PawPrint className="h-4 w-4" /> Add new pet
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 col-span-2">
            <Label>Pet name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Species</Label>
            <Select value={species} onValueChange={setSpecies}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPECIES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Breed</Label>
            <Input value={breed} onChange={(e) => setBreed(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Sex</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Weight (kg)</Label>
            <Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Age — years</Label>
            <Input inputMode="numeric" value={ageYears} onChange={(e) => setAgeYears(e.target.value)} placeholder="2" />
          </div>
          <div className="space-y-1.5">
            <Label>Age — months</Label>
            <Input inputMode="numeric" value={ageMonths} onChange={(e) => setAgeMonths(e.target.value)} placeholder="6" />
          </div>

          {!presetOwnerId && (
            <>
              <div className="space-y-1.5">
                <Label>Owner name *</Label>
                <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Owner phone</Label>
                <Input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="01XXXXXXXXX" />
              </div>
            </>
          )}
          {presetOwnerId && preset && (
            <div className="col-span-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Owner: <b className="text-foreground">{preset.full_name}</b>
              {preset.phone ? ` · ${preset.phone}` : ""}
            </div>
          )}

          <div className="space-y-1.5 col-span-2">
            <Label>Address / notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Photo URL (optional)</Label>
            <Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
            {create.isPending ? "Saving…" : "Save & select"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
