import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Stethoscope } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AddDoctorDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (doctorId: string) => void;
}) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [degree, setDegree] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [designation, setDesignation] = useState("");
  const [additional, setAdditional] = useState("");
  const [registrationNo, setRegistrationNo] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [fee, setFee] = useState("");

  const reset = () => {
    setFullName(""); setDegree(""); setSpecialization(""); setDesignation("");
    setAdditional(""); setRegistrationNo(""); setPhone(""); setPhotoUrl(""); setFee("");
  };

  const create = useMutation({
    mutationFn: async () => {
      const name = fullName.trim();
      if (!name) throw new Error("Doctor name required");
      const { data, error } = await supabase
        .from("doctors")
        .insert({
          full_name: name,
          degree: degree.trim() || null,
          specialization: specialization.trim() || null,
          designation: designation.trim() || null,
          additional_qualification: additional.trim() || null,
          registration_no: registrationNo.trim() || null,
          phone: phone.trim() || null,
          photo_url: photoUrl.trim() || null,
          consultation_fee: fee ? Number(fee) : null,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success("Doctor added");
      qc.invalidateQueries({ queryKey: ["doctors"] });
      onOpenChange(false);
      reset();
      onCreated?.(id);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to add doctor"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Stethoscope className="h-4 w-4" /> Add doctor</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Full name *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Degree / qualification</Label>
            <Input value={degree} onChange={(e) => setDegree(e.target.value)} placeholder="DVM, MS (Surgery)" />
          </div>
          <div className="space-y-1.5">
            <Label>Specialization</Label>
            <Input value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="Pet Consultant" />
          </div>
          <div className="space-y-1.5">
            <Label>Designation</Label>
            <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Veterinary Surgeon" />
          </div>
          <div className="space-y-1.5">
            <Label>Additional qualification</Label>
            <Input value={additional} onChange={(e) => setAdditional(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Registration number</Label>
            <Input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} placeholder="BVC Reg. No." />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Profile photo URL</Label>
            <Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="space-y-1.5">
            <Label>Default consultation fee</Label>
            <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="500" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !fullName.trim()}>Save doctor</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
