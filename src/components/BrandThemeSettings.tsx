import { useEffect, useState } from "react";
import { Palette, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  BRAND_THEME_FIELDS,
  DEFAULT_BRAND_THEME,
  applyBrandTheme,
  getBrandTheme,
  resetBrandTheme,
  saveBrandTheme,
  type BrandTheme,
} from "@/lib/brand-theme";

export default function BrandThemeSettings() {
  const [theme, setTheme] = useState<BrandTheme>(DEFAULT_BRAND_THEME);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const stored = getBrandTheme();
    setTheme(stored);
    applyBrandTheme(stored);
  }, []);

  // live preview: every change paints the whole UI immediately
  const set = (key: keyof BrandTheme, value: string) => {
    const next = { ...theme, [key]: value };
    setTheme(next);
    setDirty(true);
    applyBrandTheme(next);
  };

  const onSave = () => {
    saveBrandTheme(theme);
    setDirty(false);
    toast.success("Brand theme saved");
  };

  const onReset = () => {
    setTheme(resetBrandTheme());
    setDirty(false);
    toast.success("Restored the default Orange / Black theme");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          Brand theme
        </CardTitle>
        <CardDescription>
          Change any brand colour — the sidebar, buttons, cards and tables update instantly. Save to keep it on this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {BRAND_THEME_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-sm">{f.label}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`${f.label} colour`}
                  value={theme[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-card p-1"
                />
                <Input
                  value={theme[f.key]}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setTheme((t) => ({ ...t, [f.key]: v }));
                    setDirty(true);
                    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) applyBrandTheme({ ...theme, [f.key]: v });
                  }}
                  className="font-mono uppercase"
                />
              </div>
              <p className="text-xs text-muted-foreground">{f.hint}</p>
            </div>
          ))}
        </div>

        <Separator />

        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">Live preview</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Primary action</Button>
            <Button size="sm" variant="outline">Secondary</Button>
            <Button size="sm" variant="destructive">Delete</Button>
            <Badge className="bg-success text-success-foreground">Paid</Badge>
            <Badge variant="destructive">Out of stock</Badge>
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-3 bg-muted px-3 py-2 text-xs font-medium">
              <span>Product</span><span>Qty</span><span className="text-right">Total</span>
            </div>
            <div className="grid grid-cols-3 bg-accent px-3 py-2 text-sm text-accent-foreground">
              <span>Selected row</span><span>2</span><span className="text-right">৳ 480</span>
            </div>
            <div className="grid grid-cols-3 bg-card px-3 py-2 text-sm">
              <span>Normal row</span><span>1</span><span className="text-right">৳ 240</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onSave} disabled={!dirty}>
            <Save className="mr-2 h-4 w-4" />Save theme
          </Button>
          <Button variant="outline" onClick={onReset}>
            <RotateCcw className="mr-2 h-4 w-4" />Reset to Orange / Black
          </Button>
          {dirty && <span className="text-sm text-muted-foreground">Previewing unsaved colours</span>}
        </div>
      </CardContent>
    </Card>
  );
}
