import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Search, Play, XCircle, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import {
  cancelHeldBill,
  deleteHeldBill,
  fetchHeldBills,
  queueResume,
  reopenHeldBill,
  HELD_CHANNEL_LABELS,
  type HeldBill,
} from "@/lib/held-bills";

const fmt = (n: number) =>
  `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Filter = "pending" | "converted" | "cancelled" | "all";

export function PendingBillsList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("pending");

  const { data = [], isFetching } = useQuery({
    queryKey: ["held-bills"],
    queryFn: () => fetchHeldBills(),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["held-bills"] });
  };

  const cancel = useMutation({
    mutationFn: cancelHeldBill,
    onSuccess: () => { toast.success("Pending bill cancelled"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reopen = useMutation({
    mutationFn: reopenHeldBill,
    onSuccess: () => { toast.success("Pending bill reopened"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: deleteHeldBill,
    onSuccess: () => { toast.success("Pending bill deleted"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    let list = data;
    if (filter !== "all") list = list.filter((b) => b.status === filter);
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (b) =>
        b.bill_no.toLowerCase().includes(term) ||
        (b.customer_name ?? "").toLowerCase().includes(term) ||
        (b.customer_phone ?? "").includes(term),
    );
  }, [data, filter, q]);

  const report = useMemo(() => {
    const pending = data.filter((b) => b.status === "pending");
    const today = new Date().toDateString();
    return {
      count: pending.length,
      value: pending.reduce((a, b) => a + Number(b.total), 0),
      items: pending.reduce((a, b) => a + (b.items?.length ?? 0), 0),
      convertedToday: data.filter(
        (b) => b.status === "converted" && new Date(b.updated_at).toDateString() === today,
      ).length,
    };
  }, [data]);

  function resume(bill: HeldBill) {
    queueResume(bill);
    toast.success(`Loading ${bill.bill_no} into POS`);
    navigate({ to: "/pos" });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Pending bills</div>
          <div className="text-2xl font-semibold tabular-nums">{report.count}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Reserved value</div>
          <div className="text-2xl font-semibold tabular-nums text-amber-600">{fmt(report.value)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Lines held</div>
          <div className="text-2xl font-semibold tabular-nums">{report.items}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Completed today</div>
          <div className="text-2xl font-semibold tabular-nums">{report.convertedToday}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search bill no, customer or phone"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8"
              />
            </div>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="converted">Completed</TabsTrigger>
                <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="-mx-3 overflow-x-auto sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill No</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
                )}
                {!isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No pending bills. Hold a cart from the POS counter to create one.
                  </TableCell></TableRow>
                )}
                {rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="font-medium">{b.bill_no}</div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(b.created_at), "dd MMM yyyy, hh:mm a")}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {b.customer_name ?? <span className="text-muted-foreground">Walk-in</span>}
                      {b.customer_phone && <div className="text-xs text-muted-foreground">{b.customer_phone}</div>}
                      {b.note && <div className="text-xs text-muted-foreground italic">{b.note}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{HELD_CHANNEL_LABELS[b.channel] ?? b.channel}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.items?.length ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(b.total)}</TableCell>
                    <TableCell>
                      <BillStatusBadge
                        status={b.status === "pending" ? "pending" : b.status === "converted" ? "paid" : "cancelled"}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {b.status === "pending" && (
                          <>
                            <Button size="sm" onClick={() => resume(b)}>
                              <Play className="h-4 w-4" /> Complete
                            </Button>
                            <Button size="sm" variant="ghost" title="Cancel" onClick={() => cancel.mutate(b.id)}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {b.status === "cancelled" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => reopen.mutate(b.id)}>
                              <RotateCcw className="h-4 w-4" /> Reopen
                            </Button>
                            <Button size="sm" variant="ghost" title="Delete" onClick={() => remove.mutate(b.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
