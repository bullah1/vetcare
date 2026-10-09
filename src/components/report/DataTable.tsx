import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type Column<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  render?: (row: T) => ReactNode;
  /** Value used for sorting and searching (defaults to row[key]). */
  value?: (row: T) => string | number | null | undefined;
  className?: string;
};

/** Small table with search, sorting and pagination — used across the Business Report. */
export function DataTable<T>({
  rows,
  columns,
  pageSize = 15,
  searchable = true,
  empty = "Nothing in this period.",
  initialSort,
  footer,
}: {
  rows: T[];
  columns: Column<T>[];
  pageSize?: number;
  searchable?: boolean;
  empty?: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  footer?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const val = (c: Column<T>, r: T) => (c.value ? c.value(r) : (r as any)[c.key]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = term ? rows.filter((r) => columns.some((c) => String(val(c, r) ?? "").toLowerCase().includes(term))) : rows;
    if (sort) {
      const c = columns.find((x) => x.key === sort.key);
      if (c) {
        list = [...list].sort((a, b) => {
          const x = val(c, a), y = val(c, b);
          const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
          return sort.dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, columns]);

  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = shown.slice(cur * pageSize, cur * pageSize + pageSize);

  return (
    <div className="min-w-0">
      {searchable && rows.length > 8 && (
        <div className="relative mb-2 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search…" className="h-8 pl-8 text-xs" />
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={`h-9 cursor-pointer select-none whitespace-nowrap text-xs ${c.align === "right" ? "text-right" : ""}`}
                  onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.align === "right" ? "desc" : "asc" }))}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((r, i) => (
              <TableRow key={i}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={`py-2 text-sm ${c.align === "right" ? "text-right tabular-nums" : ""} ${c.className ?? ""}`}>
                    {c.render ? c.render(r) : String(val(c, r) ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!slice.length && (
              <TableRow><TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">{empty}</TableCell></TableRow>
            )}
          </TableBody>
          {footer}
        </Table>
      </div>
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>{shown.length} rows · page {cur + 1} of {pages}</span>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={cur === 0} onClick={() => setPage(cur - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
        </div>
      )}
    </div>
  );
}
