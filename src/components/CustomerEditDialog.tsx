import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type EditableCustomer = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  gender?: string | null;
};

type Props = {
  customer: EditableCustomer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

export function CustomerEditDialog({ customer, open, onOpenChange, onSaved }: Props) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [ctype, setCtype] = useState<"retail" | "b2b">("retail");
  const [ctypeLoaded, setCtypeLoaded] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!customer) return;
    setFullName(customer.full_name ?? "");
    setPhone(customer.phone ?? "");
    setGender((customer.gender as "male" | "female") ?? "");
    setEmail(customer.email ?? "");
    setAddress(customer.address ?? "");
    setNotes(customer.notes ?? "");
    setCtypeLoaded(false);
    // Read separately so older databases without the column still work.
    (supabase as any).from("pet_owners").select("customer_type").eq("id", customer.id).maybeSingle()
      .then(({ data, error }: any) => {
        if (!error) { setCtype(data?.customer_type === "b2b" ? "b2b" : "retail"); setCtypeLoaded(true); }
      });
  }, [customer?.id, open]);

  const save = useMutation({
    mutationFn: async () => {
      if (!customer) throw new Error("No customer selected");
      const name = fullName.trim();
      if (!name) throw new Error("Customer name required");
      const { error } = await supabase
        .from("pet_owners")
        .update({
          full_name: name,
          phone: phone.trim() || null,
          gender: gender || null,
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        })
        .eq("id", customer.id);
      if (error) throw error;
      if (ctypeLoaded) {
        const { error: tErr } = await (supabase as any).from("pet_owners").update({ customer_type: ctype }).eq("id", customer.id);
        if (tErr) throw new Error(`Saved, but customer type was not saved: ${tErr.message}`);
      }
    },
    onSuccess: () => {
      toast.success("Customer details updated");
      // POS keeps the customer list in memory — refresh it so B2B / name changes show at once.
      qc.invalidateQueries({ queryKey: ["owners"] });
      onOpenChange(false);
      onSaved?.();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update customer"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit customer
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Full name *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Gender</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["male", "female"] as const).map((g) => (
                <Button key={g} type="button" variant={gender === g ? "default" : "outline"} className="capitalize"
                  onClick={() => setGender(gender === g ? "" : g)}>
                  {g}
                </Button>
              ))}
            </div>
          </div>
          {ctypeLoaded && (
            <div className="space-y-2">
              <Label>Customer type</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={ctype === "retail" ? "default" : "outline"} onClick={() => setCtype("retail")}>Retail</Button>
                <Button type="button" variant={ctype === "b2b" ? "default" : "outline"} onClick={() => setCtype("b2b")}>B2B / Wholesale</Button>
              </div>
              {ctype === "b2b" && <p className="text-xs text-muted-foreground">POS uses the wholesale price for this customer, and allowed users can change prices on the bill.</p>}
            </div>
          )}
          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="optional" />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !fullName.trim()}>
            {save.isPending ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
