import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { fuzzyMatch, codeMatch, type MatchRange } from "@/lib/fuzzy-search";
import { HighlightText } from "@/components/HighlightText";

export type PickerProduct = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  purchase_price?: number | null;
  selling_price?: number | null;
  stock_quantity?: number | null;
};

type Props = {
  products: PickerProduct[];
  value?: string;
  onSelect: (product: PickerProduct) => void;
  placeholder?: string;
  /** search-only mode: keeps the trigger label constant (used for quick add) */
  quickAdd?: boolean;
  className?: string;
};

export function ProductPicker({
  products,
  value,
  onSelect,
  placeholder = "Search product…",
  quickAdd = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => products.find((p) => p.id === value),
    [products, value],
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return products.slice(0, 60).map((p) => ({ p, ranges: [] as MatchRange[] }));
    const scored: { p: PickerProduct; ranges: MatchRange[]; score: number }[] = [];
    for (const p of products) {
      const m = fuzzyMatch(p.name, q);
      if (m) scored.push({ p, ranges: m.ranges, score: m.score });
      else if (codeMatch(p.sku, q) || codeMatch(p.barcode, q)) scored.push({ p, ranges: [], score: 900 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 60);
  }, [products, query]);


  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate text-left">
            {quickAdd ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Search className="h-4 w-4" /> {placeholder}
              </span>
            ) : selected ? (
              <>
                {selected.name}
                {selected.sku ? (
                  <span className="text-muted-foreground"> ({selected.sku})</span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Type name, SKU or scan barcode…"
          />
          <CommandList>
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              {results.map(({ p, ranges }) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onSelect(p);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === p.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <HighlightText className="block truncate" text={p.name} ranges={ranges} />
                    <div className="text-xs text-muted-foreground">
                      {p.sku ? `SKU ${p.sku} · ` : ""}
                      Stock {Number(p.stock_quantity ?? 0)} · Cost ৳
                      {Number(p.purchase_price ?? 0)}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
