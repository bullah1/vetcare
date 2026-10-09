import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const CONFIRM_WORD = "RESET";

export default function FreshStartReset() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [keepDues, setKeepDues] = useState(true);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  if (!hasRole("admin")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Fresh Start</CardTitle>
          <CardDescription>Only an admin can reset transaction data.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const run = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("reset_transactions" as any, {
      _keep_dues: keepDues,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const r = (data ?? {}) as Record<string, number>;
    toast.success(
      `Reset done — ${r["sales_deleted"] ?? 0} sales & ${r["purchase_invoices_deleted"] ?? 0} purchase invoices cleared, stock zeroed`,
    );
    setOpen(false);
    setConfirm("");
    await qc.invalidateQueries();
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" /> POS Reset / Fresh Start
        </CardTitle>
        <CardDescription>
          Delete transaction data and start fresh. Master data (Products, Suppliers, Customers) will be kept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <ul className="space-y-1 text-muted-foreground">
            <li>• Delete all Sales History</li>
            <li>• Delete all Purchase History</li>
            <li>• All Stock Quantity = 0</li>
            <li>• Stock batch / adjustment history clear</li>
          </ul>
          <ul className="space-y-1 text-muted-foreground">
            <li>• Clear cash drawer shifts and movements</li>
            <li>• Products will not be deleted</li>
            <li>• Suppliers and Customers will be kept</li>
            <li>• Supplier due unchanged</li>
          </ul>
        </div>

        <label className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
          <Checkbox checked={keepDues} onCheckedChange={(v) => setKeepDues(Boolean(v))} className="mt-0.5" />
          <span className="text-sm">
            <span className="font-medium">Keep due invoices</span>
            <span className="block text-muted-foreground">
              Customer dues and unpaid purchase invoices will be kept so outstanding balances are not lost.
              If turned off, everything starts from zero (all dues will be deleted).
            </span>
          </span>
        </label>

        <Button variant="destructive" onClick={() => setOpen(true)}>
          <RotateCcw className="mr-2 h-4 w-4" /> Fresh Start
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirm(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This action cannot be undone</DialogTitle>
            <DialogDescription>
              All sales, purchase, stock movement and cash records will be deleted and stock will be set to 0.
              {keepDues ? " Due invoices will be kept." : " Everything including due invoices will be deleted."}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm</Label>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={CONFIRM_WORD} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={run} disabled={busy || confirm.trim().toUpperCase() !== CONFIRM_WORD}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Reset now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
