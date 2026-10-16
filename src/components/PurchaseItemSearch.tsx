// Keyboard-first product search for purchase entry.
// Type a name / SKU / barcode → ↑ ↓ to move → Enter to pick. A scanned barcode
// (exact code match) is picked straight away on Enter. Esc clears the box.
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { fuzzyMatch, codeMatch, type MatchRange } from "@/lib/fuzzy-search";
import { HighlightText } from "@/components/HighlightText";
import { cn } from "@/lib/utils";

export type SearchProduct = {
  id: string; name: string; sku: string | null; barcode: string | null;
  unit?: string | null; purchase_price: number; stock_quantity: number;
};

type Props = {
  products: SearchProduct[];
  onPick: (p: SearchProduct) => void;
  /** Called on Enter when nothing matches (e.g. unknown barcode). */
  onNoMatch?: (query: string) => void;
  className?: string;
};

const fmt = (n: number) => Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 });

export const PurchaseItemSearch = forwardRef<HTMLInputElement, Props>(function PurchaseItemSearch(
  { products, onPick, onNoMatch, className },
  ref,
) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as { p: SearchProduct; ranges: MatchRange[] }[];
    const key = q.toLowerCase();
    const exact: { p: SearchProduct; ranges: MatchRange[]; score: number }[] = [];
    const scored: { p: SearchProduct; ranges: MatchRange[]; score: number }[] = [];
    for (const p of products) {
      if ((p.barcode ?? "").toLowerCase() === key || (p.sku ?? "").toLowerCase() === key) {
        exact.push({ p, ranges: [], score: 10_000 });
        continue;
      }
      const m = fuzzyMatch(p.name, q);
      if (m) scored.push({ p, ranges: m.ranges, score: m.score });
      else if (codeMatch(p.sku, q) || codeMatch(p.barcode, q)) scored.push({ p, ranges: [], score: 900 });
    }
    scored.sort((a, b) => b.score - a.score);
    return [...exact, ...scored].slice(0, 40);
  }, [products, query]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (p: SearchProduct) => {
    setQuery("");
    setOpen(false);
    onPick(p);
  };

  const showList = open && query.trim() !== "";
  const listId = "purchase-item-search-list";

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (results[active]) pick(results[active].p);
            else if (query.trim()) onNoMatch?.(query.trim());
          } else if (e.key === "Escape" && query) {
            // Clear the search instead of closing the whole purchase window.
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }
        }}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search product by name, SKU or scan barcode"
        className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-[15px] outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
      />
      {showList && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">No product found. Press Enter to check the barcode, or create the product in Inventory.</li>
          ) : results.map(({ p, ranges }, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
                i === active ? "bg-accent text-accent-foreground" : "",
              )}
            >
              <div className="min-w-0 flex-1">
                <HighlightText className="block truncate font-medium" text={p.name} ranges={ranges} />
                <div className="truncate text-xs text-muted-foreground">
                  {[p.sku && `SKU ${p.sku}`, p.unit, `Stock ${fmt(p.stock_quantity)}`].filter(Boolean).join("   ")}
                </div>
              </div>
              <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                Last cost<br /><span className="text-sm font-medium text-foreground">৳{fmt(p.purchase_price)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
