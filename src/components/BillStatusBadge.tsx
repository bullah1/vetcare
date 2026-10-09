import { Badge } from "@/components/ui/badge";
import { Clock, AlertCircle, CheckCircle2, XCircle } from "lucide-react";

export type BillStatus = "pending" | "due" | "partial" | "paid" | "cancelled";

const MAP: Record<BillStatus, { label: string; className: string; Icon: typeof Clock }> = {
  pending: { label: "Pending", className: "bg-amber-500/10 text-amber-600 border-amber-500/30", Icon: Clock },
  due: { label: "Due", className: "bg-destructive/10 text-destructive border-destructive/30", Icon: AlertCircle },
  partial: { label: "Due (partial)", className: "bg-destructive/10 text-destructive border-destructive/30", Icon: AlertCircle },
  paid: { label: "Paid / Completed", className: "bg-primary/10 text-primary border-primary/30", Icon: CheckCircle2 },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border-border", Icon: XCircle },
};

export function BillStatusBadge({ status }: { status: BillStatus }) {
  const s = MAP[status];
  return (
    <Badge variant="outline" className={`gap-1 ${s.className}`}>
      <s.Icon className="h-3 w-3" />
      {s.label}
    </Badge>
  );
}
