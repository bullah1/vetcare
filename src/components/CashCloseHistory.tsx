import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Download, Share2, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ensureCloseReport, reportBlob, reportSignedUrl, type CloseReportRow } from "@/lib/cash-close-report";

const tk = (v: number) => `৳${Number(v || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function CashCloseHistory() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["cash_close_reports"],
    queryFn: async () => {
      const [{ data: reports, error }, { data: shifts }] = await Promise.all([
        supabase.from("cash_close_reports").select("*").order("closed_at", { ascending: false }).limit(200),
        supabase.from("cash_shifts").select("id,closed_at").eq("status", "closed").order("closed_at", { ascending: false }).limit(200),
      ]);
      if (error) throw error;
      const have = new Set((reports ?? []).map((r) => r.shift_id));
      return { reports: (reports ?? []) as CloseReportRow[], missing: (shifts ?? []).filter((s) => !have.has(s.id)) };
    },
  });

  const name = (r: CloseReportRow) => `${r.report_no}.pdf`;
  const view = async (r: CloseReportRow) => {
    const w = window.open("", "_blank");
    try {
      const url = URL.createObjectURL(await reportBlob(r.file_path));
      if (w) w.location.href = url; else window.location.href = url;
    } catch (e: any) { w?.close(); toast.error(e.message); }
  };
  const download = async (r: CloseReportRow) => {
    try {
      const url = URL.createObjectURL(await reportBlob(r.file_path));
      const a = document.createElement("a"); a.href = url; a.download = name(r); a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { toast.error(e.message); }
  };
  const share = async (r: CloseReportRow) => {
    try {
      const file = new File([await reportBlob(r.file_path)], name(r), { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Cash Close Report ${r.report_no}` });
        return;
      }
      const link = await reportSignedUrl(r.file_path, name(r));
      await navigator.clipboard.writeText(link);
      toast.success("Share link copied (valid 7 days)");
    } catch (e: any) { if (e?.name !== "AbortError") toast.error(e.message); }
  };
  const generate = async (shiftId: string) => {
    const { data, error } = await supabase.rpc("cash_shift_summary", { _shift_id: shiftId });
    if (error) return toast.error(error.message);
    try { await ensureCloseReport(data as any); toast.success("Report saved"); qc.invalidateQueries({ queryKey: ["cash_close_reports"] }); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" />Cash Close History</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Report</TableHead><TableHead>Closed</TableHead><TableHead>Cashier</TableHead>
            <TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Actual</TableHead>
            <TableHead className="text-right">Difference</TableHead><TableHead className="text-right">PDF</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {q.isLoading && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {q.error && <TableRow><TableCell colSpan={7} className="py-6 text-center text-destructive">Could not load reports</TableCell></TableRow>}
            {q.data?.reports.map((r) => {
              const d = Number(r.difference);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.report_no}</TableCell>
                  <TableCell className="text-xs">{when(r.closed_at)}</TableCell>
                  <TableCell className="text-xs">{r.cashier || "—"}</TableCell>
                  <TableCell className="text-right">{tk(r.expected_cash)}</TableCell>
                  <TableCell className="text-right">{tk(r.actual_cash)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={d < 0 ? "destructive" : "secondary"}>{tk(d)} {d < 0 ? "Short" : d > 0 ? "Over" : "OK"}</Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" aria-label="View PDF" onClick={() => view(r)}><Eye className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Download PDF" onClick={() => download(r)}><Download className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Share PDF" onClick={() => share(r)}><Share2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {q.data && !q.data.reports.length && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No cash close reports yet</TableCell></TableRow>}
          </TableBody>
        </Table>
        {!!q.data?.missing.length && (
          <div className="mt-4 rounded border p-3 text-xs space-y-2">
            <p className="text-muted-foreground">Shifts closed before this feature have no saved report. Generating one now snapshots their current data.</p>
            <div className="flex flex-wrap gap-2">
              {q.data.missing.slice(0, 20).map((s) => (
                <Button key={s.id} size="sm" variant="outline" onClick={() => generate(s.id)}>
                  Save report · {s.closed_at ? when(s.closed_at) : s.id.slice(0, 8)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
