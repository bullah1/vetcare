import { useState, type ReactNode } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string };
export type FilterGroup = {
  key: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  /** value considered "no filter" — defaults to "all" */
  neutral?: string;
};

type Props = {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  groups?: FilterGroup[];
  onClear?: () => void;
  /** extra actions rendered at the end (desktop) / under the row (mobile) */
  actions?: ReactNode;
  className?: string;
};

/**
 * App-style filter bar: on phones it shows a full-width search field, a
 * "Filters" button that opens a bottom sheet with tappable chips, and a
 * scrollable row of active filter chips. On desktop it falls back to inline
 * selects.
 */
export function MobileFilterBar({ search, groups = [], onClear, actions, className }: Props) {
  const [open, setOpen] = useState(false);

  const isActive = (g: FilterGroup) => g.value !== (g.neutral ?? "all");
  const activeGroups = groups.filter(isActive);
  const activeCount = activeGroups.length + (search?.value ? 1 : 0);

  const labelFor = (g: FilterGroup) =>
    g.options.find((o) => o.value === g.value)?.label ?? g.value;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        {search && (
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={search.placeholder ?? "Search…"}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              className="h-11 rounded-xl pl-8 pr-8 sm:h-9"
              inputMode="search"
            />
            {search.value && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => search.onChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* mobile: single filters button */}
        {groups.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 gap-1.5 rounded-xl px-3 sm:hidden"
            onClick={() => setOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeGroups.length > 0 && (
              <Badge className="ml-0.5 h-5 min-w-5 justify-center px-1 text-[10px]">
                {activeGroups.length}
              </Badge>
            )}
          </Button>
        )}

        {/* desktop: inline selects */}
        <div className="hidden items-center gap-2 sm:flex">
          {groups.map((g) => (
            <Select key={g.key} value={g.value} onValueChange={g.onChange}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder={g.label} />
              </SelectTrigger>
              <SelectContent>
                {g.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
          {onClear && activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
          {actions}
        </div>
      </div>

      {actions && <div className="flex flex-wrap gap-2 sm:hidden">{actions}</div>}

      {/* active chips (mobile) */}
      {activeGroups.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 sm:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {activeGroups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => g.onChange(g.neutral ?? "all")}
              className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground"
            >
              {labelFor(g)}
              <X className="h-3 w-3" />
            </button>
          ))}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-2">
            {groups.map((g) => (
              <div key={g.key} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {g.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => g.onChange(o.value)}
                      className={cn(
                        "rounded-full border px-3.5 py-2 text-sm transition-colors",
                        g.value === o.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-foreground",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <SheetFooter className="flex-row gap-2">
            {onClear && (
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-xl"
                onClick={() => onClear()}
              >
                Clear all
              </Button>
            )}
            <Button className="h-11 flex-1 rounded-xl" onClick={() => setOpen(false)}>
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
