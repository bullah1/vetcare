import { useMemo, useState } from "react";
import { ChevronsUpDown, Loader2, Package, Search } from "lucide-react";
import { fuzzyMatch } from "@/lib/fuzzy-search";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { doseUnitFor, resolveDoseForm, type Medicine } from "@/lib/clinical-master";

/** Medicine-only picker. The list is already filtered to prescribable products. */
export function MedicinePicker({
  medicines,
  loading,
  value,
  onSelect,
}: {
  medicines: Medicine[];
  loading?: boolean;
  value: Medicine | null;
  onSelect: (m: Medicine) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return medicines.slice(0, 50);
    const scored: { m: Medicine; score: number }[] = [];
    for (const m of medicines) {
      const hit = fuzzyMatch(m.name, q);
      if (hit) scored.push({ m, score: hit.score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 50).map((s) => s.m);
  }, [medicines, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal min-w-0">
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? value.name : loading ? "Loading medicines…" : "Search medicine…"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,24rem)] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Medicine name…"
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {loading && (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No medicine found. Mark products as prescribable in Inventory.
            </div>
          )}
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onSelect(m);
                setOpen(false);
                setQuery("");
              }}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                m.id === value?.id && "bg-accent/60",
              )}
            >
              <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.name}</span>
                <span className="block truncate text-xs capitalize text-muted-foreground">
                  {resolveDoseForm(m) ?? "medicine"} · dosed in {doseUnitFor(m)} · stock {Number(m.stock_quantity)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
