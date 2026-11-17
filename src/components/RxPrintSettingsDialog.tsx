import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getRxCalibration, printRxCalibrationPage, setRxCalibration } from "@/lib/prescription-print";

/** Pre-printed A4 paper setup: on/off, fine offsets in mm, and a calibration test sheet. */
export function RxPrintSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [preprinted, setPreprinted] = useState(false);
  const [offsetX, setOffsetX] = useState("0");
  const [offsetY, setOffsetY] = useState("0");

  useEffect(() => {
    if (!open) return;
    const c = getRxCalibration();
    setPreprinted(c.preprinted);
    setOffsetX(String(c.offsetX));
    setOffsetY(String(c.offsetY));
  }, [open]);

  const save = () => {
    setRxCalibration({
      preprinted,
      offsetX: Number(offsetX) || 0,
      offsetY: Number(offsetY) || 0,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Prescription print setup</DialogTitle>
          <DialogDescription>
            Use pre-printed letterhead paper: the printer skips the logo and footer, and only the patient and medicine text is printed. Saved on this computer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="rx-preprinted">Pre-printed A4 paper</Label>
            <Switch id="rx-preprinted" checked={preprinted} onCheckedChange={setPreprinted} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rx-ox">Shift left / right (mm)</Label>
              <Input id="rx-ox" type="number" step="0.5" value={offsetX} onChange={(e) => setOffsetX(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rx-oy">Shift up / down (mm)</Label>
              <Input id="rx-oy" type="number" step="0.5" value={offsetY} onChange={(e) => setOffsetY(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Positive X moves text right, positive Y moves it down. Print the test sheet on plain paper, hold it over the form, then adjust.
          </p>

          <Button type="button" variant="outline" className="w-full" onClick={() => printRxCalibrationPage()}>
            <Printer className="mr-2 h-4 w-4" /> Print calibration test sheet
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
