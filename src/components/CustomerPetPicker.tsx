import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Phone, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { fuzzyMatch } from "@/lib/fuzzy-search";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type OwnerOption = {
  id: string;
  full_name: string;
  phone: string | null;
  pets: { id: string; name: string; species: string | null }[];
};

const digits = (s: string) => (s || "").replace(/\D/g, "");

/** Owners with their pets — shared cache so the picker and pet list stay in sync. */
export function useOwnerOptions() {
  return useQuery({
    queryKey: ["owners", "with-pets"],
    queryFn: async () =>
      (await fetchAll<OwnerOption>(() =>
        supabase
          .from("pet_owners")
          .select("id,full_name,phone,pets(id,name,species)")
          .order("full_name", { ascending: true })
          .order("id"),
        200000,
      )) ?? [],
    staleTime: 60_000,
  });
}

export function searchOwners(owners: OwnerOption[], query: string, limit = 40): OwnerOption[] {
  const q = query.trim();
  if (!q) return owners.slice(0, limit);
  const qDigits = digits(q);
  const scored: { o: OwnerOption; score: number }[] = [];
  for (const o of owners) {
    let score = -1;
    if (qDigits && o.phone && digits(o.phone).includes(qDigits)) score = 2000;
    const nameHit = fuzzyMatch(o.full_name, q);
    if (nameHit && nameHit.score > score) score = nameHit.score;
    for (const p of o.pets ?? []) {
      const petHit = fuzzyMatch(p.name, q);
      if (petHit && petHit.score - 50 > score) score = petHit.score - 50;
    }
    if (score > 0) scored.push({ o, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.o);
}

/**
 * Searchable customer picker (name or phone) with a guarded "new customer" flow.
 * Never creates a duplicate: an existing phone/name match is selected instead.
 */
export function CustomerPicker({
  owners,
  value,
  onChange,
  loading,
  disabled,
}: {
  owners: OwnerOption[];
  value: string;
  onChange: (ownerId: string) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const selected = owners.find((o) => o.id === value) ?? null;
  const results = useMemo(() => searchOwners(owners, query), [owners, query]);

  const createOwner = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      const p = phone.trim();
      if (!n) throw new Error("Customer name required");

      const pd = digits(p);
      const dupe = owners.find(
        (o) =>
          (pd && o.phone && digits(o.phone) === pd) ||
          (!pd && o.full_name.trim().toLowerCase() === n.toLowerCase()),
      );
      if (dupe) return { id: dupe.id, existing: true };

      const { data, error } = await supabase
        .from("pet_owners")
        .insert({ full_name: n, phone: p || null })
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string, existing: false };
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["owners"] });
      onChange(res.id);
      setNewOpen(false);
      setName("");
      setPhone("");
      toast[res.existing ? "info" : "success"](
        res.existing ? "Customer already exists — selected instead" : "Customer added",
      );
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to add customer"),
  });

  return (
    <>
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="flex-1 justify-between font-normal min-w-0"
            >
              <span className="truncate">
                {selected
                  ? `${selected.full_name}${selected.phone ? ` · ${selected.phone}` : ""}`
                  : loading
                    ? "Loading customers…"
                    : "Search customer by name or phone"}
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(92vw,26rem)] p-0" align="start">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or phone…"
                className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {loading && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>}
              {!loading && results.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">No customer found</div>
              )}
              {results.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                    o.id === value && "bg-accent/60",
                  )}
                >
                  <Check className={cn("h-4 w-4 shrink-0", o.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {o.phone ? o.phone : "no phone"}
                      {o.pets?.length ? ` · ${o.pets.length} pet${o.pets.length > 1 ? "s" : ""}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="border-t p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  const q = query.trim();
                  setName(digits(q) === q ? "" : q);
                  setPhone(digits(q) === q ? q : "");
                  setOpen(false);
                  setNewOpen(true);
                }}
              >
                <UserPlus className="h-4 w-4" /> Create new customer
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <Button type="button" variant="outline" onClick={() => setNewOpen(true)} disabled={disabled}>
          <UserPlus className="h-4 w-4" />
          <span className="sr-only">New customer</span>
        </Button>
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="gap-1">
            <Phone className="h-3 w-3" /> {selected.phone ?? "—"}
          </Badge>
          <span>{selected.pets?.length ?? 0} pet(s) on file</span>
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Customer name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" />
            </div>
            <p className="text-xs text-muted-foreground">
              A matching phone number reuses the existing customer, so no duplicate is created.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => createOwner.mutate()} disabled={createOwner.isPending || !name.trim()}>
              Save customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
