import { useEffect, useState } from "react";
import { Printer, RotateCcw, TestTube2 } from "lucide-react";
import {
  DEFAULT_THERMAL,
  getThermalSettings,
  printThermal,
  saveThermalSettings,
  testThermalReceipt,
  type ThermalSettings,
} from "@/lib/invoice-print";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type Props = {
  trigger?: React.ReactNode;
};

export default function ThermalPrinterSettings({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<ThermalSettings>(DEFAULT_THERMAL);

  useEffect(() => {
    if (open) setS(getThermalSettings());
  }, [open]);

  const upd = <K extends keyof ThermalSettings>(k: K, v: ThermalSettings[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const save = () => {
    saveThermalSettings(s);
    toast.success("Printer settings saved");
    setOpen(false);
  };

  const reset = () => setS({ ...DEFAULT_THERMAL });

  const test = () => printThermal(testThermalReceipt(), s);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Printer className="h-4 w-4" /> Printer settings
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thermal printer settings</DialogTitle>
          <DialogDescription>
            Tune paper width, layout and order for your thermal printer. If your printer prints the receipt
            upside-down (footer first, company name last), turn on <b>Reverse print order</b>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Paper width</Label>
              <Select
                value={String(s.paperWidth)}
                onValueChange={(v) => upd("paperWidth", Number(v) as ThermalSettings["paperWidth"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="58">58 mm</SelectItem>
                  <SelectItem value="72">72 mm</SelectItem>
                  <SelectItem value="80">80 mm (default)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Width fine-tune (mm)</Label>
              <Input
                type="number" min={-10} max={10} step={0.5}
                value={s.widthAdjust}
                onChange={(e) => upd("widthAdjust", Math.max(-10, Math.min(10, Number(e.target.value) || 0)))}
              />
              <p className="text-[10px] text-muted-foreground">
                Printed area = paper width + this. Use −2 to −4 if text gets cut on the right, + if the receipt looks too narrow.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Side margin (mm)</Label>
              <Input
                type="number" min={0} max={8} step={0.5}
                value={s.sideMargin}
                onChange={(e) => upd("sideMargin", Math.max(0, Math.min(8, Number(e.target.value) || 0)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Base font size (px)</Label>
              <Input
                type="number" min={9} max={16}
                value={s.fontSize}
                onChange={(e) => upd("fontSize", Math.max(9, Math.min(16, Number(e.target.value) || 12)))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Top margin (mm)</Label>
              <Input
                type="number" min={0} max={2} step={0.5}
                value={s.marginTop}
                onChange={(e) => upd("marginTop", Math.max(0, Math.min(2, Number(e.target.value) || 0)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bottom margin (mm)</Label>
              <Input
                type="number" min={0} max={20}
                value={s.marginBottom}
                onChange={(e) => upd("marginBottom", Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Top blank space (mm)</Label>
              <Input
                type="number" min={0} max={6} step={0.5}
                value={s.topFeedLines}
                onChange={(e) => upd("topFeedLines", Math.max(0, Math.min(6, Number(e.target.value) || 0)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bottom feed (mm)</Label>
              <Input
                type="number" min={0} max={3} step={0.5}
                value={s.feedLines}
                onChange={(e) => upd("feedLines", Math.max(0, Math.min(3, Number(e.target.value) || 0)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Print darkness</Label>
              <Select
                value={s.boldness}
                onValueChange={(v) => upd("boldness", v as ThermalSettings["boldness"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light (thinnest)</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="bold">Bold (default, recommended)</SelectItem>
                  <SelectItem value="extra">Extra dark</SelectItem>

                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Line spacing ({s.lineHeight.toFixed(2)}×)</Label>
              <input
                type="range"
                min={1}
                max={2}
                step={0.05}
                value={s.lineHeight}
                onChange={(e) => upd("lineHeight", Math.max(1, Math.min(2, Number(e.target.value) || 1.35)))}
                className="w-full accent-primary"
              />
              <p className="text-[10px] text-muted-foreground">
                Tight (1.00) → readable (1.35) → airy (2.00). Increase if lines overlap; decrease if the receipt looks too tall.
              </p>
            </div>

          </div>

          <div className="space-y-1.5">
            <Label>Footer note</Label>
            <Textarea
              rows={2}
              value={s.footerNote}
              onChange={(e) => upd("footerNote", e.target.value)}
              placeholder="Get well soon 🐾"
            />
          </div>

          <div className="grid gap-2 rounded-lg border p-3">
            <ToggleRow
              label="Reverse print order"
              hint="Turn ON if your printer prints upside-down (company name at bottom)."
              checked={s.reverseOrder}
              onChange={(v) => upd("reverseOrder", v)}
            />
            <ToggleRow
              label="Auto-open print dialog"
              hint="Keep OFF if the printer opens two print jobs or prints an extra blank receipt."
              checked={s.autoPrint}
              onChange={(v) => upd("autoPrint", v)}
            />
            <ToggleRow
              label="Show tagline"
              checked={s.showTagline}
              onChange={(v) => upd("showTagline", v)}
            />
            <ToggleRow
              label="Show clinic license"
              checked={s.showLicense}
              onChange={(v) => upd("showLicense", v)}
            />
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground leading-relaxed">
            <b>Tip:</b> If order is still wrong after enabling Reverse, check your printer driver's
            <i> "Reverse page order" / "Print last page first"</i> option and disable it. Windows: Devices &amp;
            Printers → your printer → Printing Preferences → Advanced.
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
            <Button variant="outline" size="sm" onClick={test} className="gap-1">
              <TestTube2 className="h-3.5 w-3.5" /> Test print
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save settings</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="space-y-0.5">
        <Label className="text-sm">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
