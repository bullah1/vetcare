import { useMemo, useState } from "react";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { fuzzyMatch } from "@/lib/fuzzy-search";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useInvalidateMaster,
  useMasterList,
  quickAddMaster,
  type MasterItem,
  type MasterTable,
} from "@/lib/clinical-master";

export type Picked = { id: string; label: string };

/**
 * Search-first multi-select over a clinical master table with inline
 * "+ Add new" that saves to the database and selects the row immediately.
 */
export function MasterMultiSelect({
  table,
  placeholder,
  selected,
  onChange,
  showCommonChips = true,
  emptyHint,
}: {
  table: MasterTable;
  placeholder: string;
  selected: Picked[];
  onChange: (next: Picked[]) => void;
  showCommonChips?: boolean;
  emptyHint?: string;
}) {
  const { data: items = [], isLoading, isError } = useMasterList(table);
  const invalidate = useInvalidateMaster();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const selectedIds = new Set(selected.map((s) => s.id));

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 60);
    const scored: { item: MasterItem; score: number }[] = [];
    for (const item of items) {
      const hit = fuzzyMatch(item.label, q);
      if (hit) scored.push({ item, score: hit.score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 60).map((s) => s.item);
  }, [items, query]);

  const commonChips = useMemo(
    () => items.filter((i) => i.is_common && !selectedIds.has(i.id)).slice(0, 10),
    [items, selected],
  );

  const toggle = (item: MasterItem | Picked) => {
    if (selectedIds.has(item.id)) onChange(selected.filter((s) => s.id !== item.id));
    else onChange([...selected, { id: item.id, label: item.label }]);
  };

  const addNew = async () => {
    const value = query.trim();
    if (!value) return;
    setAdding(true);
    try {
      const created = await quickAddMaster(table, value);
      invalidate(table);
      if (!selectedIds.has(created.id)) onChange([...selected, { id: created.id, label: created.label }]);
      setQuery("");
      setOpen(false);
      toast.success(`"${created.label}" added`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setAdding(false);
    }
  };

  const exactExists = items.some((i) => i.label.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((s) => (
          <Badge key={s.id} variant="secondary" className="gap-1 py-1">
            {s.label}
            <button type="button" onClick={() => toggle(s)} aria-label={`Remove ${s.label}`}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1 border-dashed">
              <Plus className="h-3.5 w-3.5" /> {placeholder}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(92vw,22rem)] p-0" align="start">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim() && !exactExists) {
                    e.preventDefault();
                    void addNew();
                  }
                }}
                placeholder="Search or type new…"
                className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-60 overflow-y-auto py-1">
              {isLoading && (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              )}
              {isError && (
                <div className="px-3 py-6 text-center text-sm text-destructive">Could not load list</div>
              )}
              {!isLoading && !isError && results.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {query.trim() ? "No match — add it below" : (emptyHint ?? "Nothing saved yet")}
                </div>
              )}
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent",
                    selectedIds.has(item.id) && "bg-accent/60",
                  )}
                >
                  <Check className={cn("h-4 w-4 shrink-0", selectedIds.has(item.id) ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              ))}
            </div>
            {query.trim() && !exactExists && (
              <div className="border-t p-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={adding}
                  onClick={() => void addNew()}
                >
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add “{query.trim()}”
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {showCommonChips && commonChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {commonChips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c)}
              className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
