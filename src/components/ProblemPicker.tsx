// Searchable problem list for appointments. Staff can add a new problem from the search box.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { addProblem, useProblems } from "@/lib/clinic";
import { cn } from "@/lib/utils";

export function ProblemPicker({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const qc = useQueryClient();
  const { data: problems = [] } = useProblems();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const active = problems.filter((p) => p.is_active || p.id === value);
  const selected = problems.find((p) => p.id === value);
  const term = search.trim();
  const exact = active.some((p) => p.name.toLowerCase() === term.toLowerCase());

  const add = async () => {
    setAdding(true);
    try {
      const p = await addProblem(term);
      await qc.invalidateQueries({ queryKey: ["clinic-problems"] });
      onChange(p.id, p.name);
      setSearch("");
      setOpen(false);
      toast.success(`Added "${p.name}"`);
    } catch (e: any) {
      toast.error(e.message ?? "Could not add the problem");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.name ?? "Choose problem"}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or type a new problem" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No problem found.</CommandEmpty>
            <CommandGroup>
              {active.map((p) => (
                <CommandItem key={p.id} value={p.name} onSelect={() => { onChange(p.id, p.name); setOpen(false); setSearch(""); }}>
                  <Check className={cn("h-4 w-4", p.id === value ? "opacity-100" : "opacity-0")} />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {term && !exact && (
            <div className="border-t p-1">
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" disabled={adding} onClick={add}>
                <Plus className="h-4 w-4" /> Add "{term}"
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
