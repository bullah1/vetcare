import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

export function ShiftStatusBadge() {
  const { data: shift } = useQuery({
    queryKey: ["global-open-shift"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_shifts")
        .select("id,status,opened_at")
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; status: string; opened_at: string } | null;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const open = !!shift;

  return (
    <Link to="/cash-drawer" className="shrink-0">
      <Badge variant={open ? "default" : "destructive"} className="gap-1">
        <Wallet className="h-3 w-3" />
        {open ? "Cash Open" : "Cash Closed"}
      </Badge>
    </Link>
  );
}
