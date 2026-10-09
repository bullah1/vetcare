import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PawPrint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAll } from "@/lib/fetch-all";

const SPECIES = ["dog", "cat", "bird", "cow", "goat", "rabbit", "other"] as const;

export function AddPetDialog({
  open,
  onOpenChange,
  onCreated,
  lockedOwnerId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (petId: string) => void;
  /** When set, the pet is always attached to this customer and the owner picker is hidden. */
  lockedOwnerId?: string;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [species, setSpecies] = useState<string>("cat");
  const [breed, setBreed] = useState("");
  const [gender, setGender] = useState("");
  const [weight, setWeight] = useState("");
  const [ownerIdState, setOwnerId] = useState("");
  const ownerId = lockedOwnerId || ownerIdState;
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerPhone, setNewOwnerPhone] = useState("");

  const { data: owners = [] } = useQuery({
    // Own cache key: ["owners","picker"] is used by the Pets page with a
    // different column set, so the two screens overwrote each other's data.
    queryKey: ["owners", "picker-with-phone"],
    queryFn: () =>
      fetchAll<{ id: string; full_name: string; phone: string | null }>(
        () => supabase.from("pet_owners").select("id,full_name,phone").order("full_name").order("id"),
        200000,
      ),
  });

  const reset = () => {
    setName(""); setSpecies("cat"); setBreed(""); setGender(""); setWeight("");
    setOwnerId(""); setNewOwnerName(""); setNewOwnerPhone("");
  };

  const create = useMutation({
    mutationFn: async () => {
      const petName = name.trim();
      if (!petName) throw new Error("Pet name required");

      let owner = ownerId;
      if (!owner) {
        const oname = newOwnerName.trim();
        if (!oname) throw new Error("Select an owner or type a new owner name");
        const { data, error } = await supabase
          .from("pet_owners")
          .insert({ full_name: oname, phone: newOwnerPhone.trim() || null })
          .select("id")
          .single();
        if (error) throw error;
        owner = data.id;
      }

      const { data: pet, error: petErr } = await supabase
        .from("pets")
        .insert({
          owner_id: owner,
          name: petName,
          species: species as any,
          breed: breed.trim() || null,
          gender: gender || null,
          weight_kg: weight ? Number(weight) : null,
        })
        .select("id")
        .single();
      if (petErr) throw petErr;
      return pet.id as string;
    },
    onSuccess: (id) => {
      toast.success("Pet added");
      qc.invalidateQueries({ queryKey: ["pets"] });
      qc.invalidateQueries({ queryKey: ["owners"] });
      onOpenChange(false);
      reset();
      onCreated?.(id);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to add pet"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PawPrint className="h-4 w-4" /> Add pet</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Pet name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Species</Label>
              <Select value={species} onValueChange={setSpecies}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SPECIES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Breed</Label>
              <Input value={breed} onChange={(e) => setBreed(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Weight (kg)</Label>
              <Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
          </div>

          {!lockedOwnerId && (
            <div className="space-y-2">
              <Label>Owner</Label>
              <Select value={ownerIdState} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue placeholder="Choose existing owner" /></SelectTrigger>
                <SelectContent>
                  {owners.map((o: any) => (
                    <SelectItem key={o.id} value={o.id}>{o.full_name}{o.phone ? ` · ${o.phone}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!ownerId && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-md border p-3">
              <div className="space-y-2 sm:col-span-2 text-xs text-muted-foreground">Or create a new owner</div>
              <div className="space-y-2">
                <Label>Owner name</Label>
                <Input value={newOwnerName} onChange={(e) => setNewOwnerName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={newOwnerPhone} onChange={(e) => setNewOwnerPhone(e.target.value)} placeholder="01XXXXXXXXX" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>Save pet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
