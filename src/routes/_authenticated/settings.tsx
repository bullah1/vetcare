import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, Save, RotateCcw, Printer, Building2, Receipt as ReceiptIcon, Palette } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import ThermalPrinterSettings from "@/components/ThermalPrinterSettings";
import FreshStartReset from "@/components/FreshStartReset";
import BrandThemeSettings from "@/components/BrandThemeSettings";

import { getClinic, saveClinic, resetClinic, syncClinicFromServer, DEFAULT_CLINIC, type ClinicInfo } from "@/lib/clinic-settings";
import { printInvoice, printThermal, testThermalReceipt } from "@/lib/invoice-print";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Pet Care Vet ERP" },
      { name: "description", content: "Clinic profile, invoice defaults and thermal printer setup for the Pet Care Vet POS." },
      { property: "og:title", content: "Settings — Pet Care Vet ERP" },
      { property: "og:description", content: "Manage clinic details, invoice format and printer configuration." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [form, setForm] = useState<ClinicInfo>(DEFAULT_CLINIC);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load the cached copy instantly, then refresh from the shared server copy so
  // the profile is the same on every device instead of resetting per browser.
  useEffect(() => {
    setForm(getClinic());
    let cancelled = false;
    syncClinicFromServer().then((c) => {
      if (!cancelled) {
        setForm((prev) => (dirtyRef.current ? prev : c));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const set = <K extends keyof ClinicInfo>(k: K, v: ClinicInfo[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    const res = await saveClinic(form);
    setSaving(false);
    if (res.ok) {
      setDirty(false);
      toast.success("Settings saved for all devices — invoices, receipts and labels updated");
    } else {
      toast.error(`Saved on this device only — server save failed: ${res.error ?? "unknown error"}`);
    }
  };

  const onReset = async () => {
    await resetClinic();
    setForm(getClinic());
    setDirty(false);
    toast.success("Restored default clinic settings");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Clinic profile, invoice format and printer setup — used by every printed document."
        icon={SettingsIcon}
      />

      <Tabs defaultValue="clinic" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="clinic"><Building2 className="mr-2 h-4 w-4" />Clinic</TabsTrigger>
          <TabsTrigger value="invoice"><ReceiptIcon className="mr-2 h-4 w-4" />Invoice</TabsTrigger>
          <TabsTrigger value="printer"><Printer className="mr-2 h-4 w-4" />Printing</TabsTrigger>
          <TabsTrigger value="theme"><Palette className="mr-2 h-4 w-4" />Theme</TabsTrigger>
          <TabsTrigger value="reset"><RotateCcw className="mr-2 h-4 w-4" />Reset</TabsTrigger>

        </TabsList>

        <TabsContent value="clinic">
          <Card>
            <CardHeader>
              <CardTitle>Clinic profile</CardTitle>
              <CardDescription>Shown on A4 invoices, thermal receipts, prescriptions and purchase receipts.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Clinic name" value={form.name} onChange={(v) => set("name", v)} />
              <Field label="Tagline" value={form.tagline} onChange={(v) => set("tagline", v)} />
              <div className="md:col-span-2">
                <Label>Address</Label>
                <Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
              </div>
              <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} />
              <Field label="Email" value={form.email} onChange={(v) => set("email", v)} />
              <Field label="Website" value={form.website} onChange={(v) => set("website", v)} />
              <Field label="License no." value={form.license} onChange={(v) => set("license", v)} />
              <Field
                label="Short name on barcode labels"
                value={form.labelName}
                onChange={(v) => set("labelName", v)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoice">
          <Card>
            <CardHeader>
              <CardTitle>Invoice & tax defaults</CardTitle>
              <CardDescription>Currency symbol, default VAT and footer text on printed invoices.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Currency symbol" value={form.currency} onChange={(v) => set("currency", v)} />
              <div>
                <Label>Default VAT / Tax (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.defaultTaxPercent}
                  onChange={(e) => set("defaultTaxPercent", Number(e.target.value) || 0)}
                />
              </div>
              <Field label="Invoice prefix" value={form.invoicePrefix} onChange={(v) => set("invoicePrefix", v)} />
              <Field label="Receipt footer note" value={form.invoiceFooter} onChange={(v) => set("invoiceFooter", v)} />
              <Separator className="md:col-span-2" />
              <div className="md:col-span-2 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => printInvoice(testThermalReceipt())}>
                  <Printer className="mr-2 h-4 w-4" />Preview A4 invoice
                </Button>
                <Button variant="outline" onClick={() => printThermal(testThermalReceipt())}>
                  <Printer className="mr-2 h-4 w-4" />Preview thermal receipt
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="printer">
          <Card>
            <CardHeader>
              <CardTitle>Thermal printer</CardTitle>
              <CardDescription>Paper width, darkness, line spacing, margins and feed lines for 58/72/80mm rolls.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ThermalPrinterSettings
                trigger={
                  <Button>
                    <Printer className="mr-2 h-4 w-4" />Open printer settings
                  </Button>
                }
              />
              <p className="text-sm text-muted-foreground">
                Barcode labels print at 38 × 25 mm. In the browser print dialog use Margins: None and Scale: 100%,
                or use the Download PDF option from Inventory.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="theme">
          <BrandThemeSettings />
        </TabsContent>

        <TabsContent value="reset">
          <FreshStartReset />
        </TabsContent>
      </Tabs>


      <div className="flex items-center gap-2">
        <Button onClick={onSave} disabled={!dirty || saving}>
          <Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save settings"}
        </Button>
        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="mr-2 h-4 w-4" />Reset to defaults
        </Button>
        {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
