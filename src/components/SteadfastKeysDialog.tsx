// Admin saves the Steadfast API key + secret key inside the app (no hosting setup needed).
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { checkSteadfastConnection } from "@/lib/courier.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const db = supabase as any;

export function SteadfastKeysDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const checkFn = useServerFn(checkSteadfastConnection);
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [status, setStatus] = useState<{ saved: boolean; api_key_end?: string; updated_at?: string } | null>(null);
  const [setupMissing, setSetupMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setApiKey(""); setSecretKey("");
    db.rpc("courier_credentials_status", { _courier: "steadfast" }).then(({ data, error }: any) => {
      if (error) { setSetupMissing(true); setStatus(null); } else { setSetupMissing(false); setStatus(data); }
    });
  }, [open]);

  const test = async () => {
    const r: any = await checkFn();
    if (r.ok) toast.success(`Steadfast connected ✓ — balance ৳${Number(r.balance).toLocaleString("en-BD")}`);
    else toast.error(`Steadfast not working: ${r.message}`, { duration: 12000 });
    return r.ok as boolean;
  };

  const save = async (clear = false) => {
    if (!clear && (!apiKey.trim() || !secretKey.trim())) { toast.error("Paste both the API key and the secret key"); return; }
    setBusy(true);
    try {
      const { error } = await db.rpc("set_courier_credentials", { _courier: "steadfast", _api_key: clear ? "" : apiKey, _secret_key: clear ? "" : secretKey });
      if (error) throw error;
      if (clear) { toast.success("Saved keys removed"); onOpenChange(false); return; }
      toast.success("Steadfast keys saved — testing…");
      if (await test()) onOpenChange(false);
      else {
        const { data } = await db.rpc("courier_credentials_status", { _courier: "steadfast" });
        setStatus(data);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the keys");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Steadfast API keys</DialogTitle></DialogHeader>
        {setupMissing ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            Run the courier keys SQL update in Supabase first, then open this again.
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Steadfast portal → <b>API</b> page: copy the <b>API Key</b> and <b>Secret Key</b> and paste them here. They are kept safe on the server — nobody can see them again here.
            </p>
            {status?.saved && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200">
                Keys saved (API key ends …{status.api_key_end}). Paste new ones only to change them.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder={status?.saved ? "Leave empty to keep the saved key" : "Paste API key"} />
            </div>
            <div className="space-y-1.5">
              <Label>Secret Key</Label>
              <Input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="new-password" spellCheck={false} placeholder={status?.saved ? "Leave empty to keep the saved key" : "Paste secret key"} />
            </div>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          {status?.saved && <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => save(true)}>Remove saved keys</Button>}
          <Button variant="outline" disabled={busy || setupMissing} onClick={() => void test()}>Test</Button>
          <Button disabled={busy || setupMissing || !apiKey.trim() || !secretKey.trim()} onClick={() => save(false)}>{busy ? "Saving…" : "Save & test"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
