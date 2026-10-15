import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { UserPlus, Repeat, Users, Percent } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchCustomerMix } from "@/lib/customer-mix";

const money = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 0 })}`;

export function CustomerMixCard() {
  const [open, setOpen] = useState<null | "all" | "new" | "repeat">(null);

  const { fromISO, toISO } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(-1);
    return { fromISO: start.toISOString(), toISO: end.toISOString() };
  }, []);

  const { data } = useQuery({
    queryKey: ["customer-mix-today", fromISO],
    queryFn: () => fetchCustomerMix(fromISO, toISO),
    refetchInterval: 60_000,
  });

  const rows = (data?.rows ?? []).filter((r) => (open === "all" || open === null ? true : r.type === open));

  const tiles = [
    { key: "all" as const, label: "Customers", value: String(data?.total ?? 0), icon: Users, hint: "Served today" },
    { key: "new" as const, label: "New", value: String(data?.newCustomers ?? 0), icon: UserPlus, hint: money(data?.newAmount ?? 0) },
    { key: "repeat" as const, label: "Returning", value: String(data?.repeatCustomers ?? 0), icon: Repeat, hint: money(data?.repeatAmount ?? 0) },
  ];
  const rate = data?.repeatRate ?? 0;

  return (
    <>
      <section className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:items-center">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Customers today</h2>
            <p className="text-xs text-muted-foreground">Matched by mobile number, so nobody is counted as new twice. Tap a number to see who.</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setOpen(t.key)}
                className="group min-w-0 rounded-xl bg-muted/60 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><t.icon className="h-3.5 w-3.5" /> {t.label}</span>
                <span className="mt-0.5 block text-xl font-bold tabular-nums">{t.value}</span>
                <span className="block truncate text-[11px] text-muted-foreground tabular-nums">{t.hint}</span>
              </button>
            ))}
            <div className="min-w-0 rounded-xl bg-muted/60 px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Percent className="h-3.5 w-3.5" /> Return rate</span>
              <span className="mt-0.5 block text-xl font-bold tabular-nums">{rate.toFixed(0)}%</span>
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-background"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, rate)}%` }} /></span>
            </div>
          </div>
        </div>
      </section>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {open === "new" ? "New customers today" : open === "repeat" ? "Repeat customers today" : "All customers today"}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Orders today</TableHead>
                  <TableHead className="text-right">Spent today</TableHead>
                  <TableHead className="text-right">Gap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No customers yet.</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>
                      <Button variant="link" className="h-auto p-0" asChild>
                        <Link to="/customers/$id" params={{ id: r.ownerId }}>{r.name}</Link>
                      </Button>
                      <div className="text-xs text-muted-foreground">{r.phone ?? "—"}</div>
                      {r.firstPurchase && (
                        <div className="text-[11px] text-muted-foreground">
                          First: {format(new Date(r.firstPurchase), "dd MMM yyyy")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.type === "new" ? "default" : "secondary"}>{r.type}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.ordersInRange}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.amountInRange)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.gapDays === null ? "—" : `${r.gapDays}d`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
