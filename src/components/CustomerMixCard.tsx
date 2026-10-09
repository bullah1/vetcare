import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { UserPlus, Repeat, Users, Percent } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    { key: "all" as const, label: "Total Customers", value: String(data?.total ?? 0), icon: Users, tone: "text-primary" },
    { key: "new" as const, label: "New Customers", value: String(data?.newCustomers ?? 0), icon: UserPlus, tone: "text-success" },
    { key: "repeat" as const, label: "Repeat Customers", value: String(data?.repeatCustomers ?? 0), icon: Repeat, tone: "text-accent-foreground" },
  ];

  return (
    <>
      <Card className="shadow-[var(--shadow-soft)]">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Today's customers — New vs Repeat</CardTitle>
          </div>
          <CardDescription>Matched by mobile number, so one customer is never counted as new twice</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setOpen(t.key)}
              className="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                {t.label} <t.icon className={`h-4 w-4 ${t.tone}`} />
              </div>
              <div className="mt-1 text-2xl font-semibold">{t.value}</div>
            </button>
          ))}
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              Repeat Rate <Percent className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-1 text-2xl font-semibold">{(data?.repeatRate ?? 0).toFixed(1)}%</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              New {money(data?.newAmount ?? 0)} · Repeat {money(data?.repeatAmount ?? 0)}
            </div>
          </div>
        </CardContent>
      </Card>

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
