import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Truck, Plus, Trash2, Eye, RotateCcw, Wallet, Printer, X, Barcode } from "lucide-react";
import { BarcodeLabelDialog, type LabelProduct } from "@/components/BarcodeLabelDialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ProductPicker } from "@/components/ProductPicker";


export const Route = createFileRoute("/_authenticated/purchases")({
  head: () => ({ meta: [{ title: "Purchases — Pet Care Vet ERP" }] }),
  component: PurchasesPage,
});

const fmt = (n: number) => `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const today = todayDhaka;

import { getClinic } from "@/lib/clinic-settings";
import { todayDhaka } from "@/lib/sales-ledger";
import { fetchAll } from "@/lib/fetch-all";

type PaymentReceipt = {
  receipt_no: string;
  date: string;
  amount: number;
  method: string;
  reference?: string | null;
  supplier_name?: string | null;
  invoice_no?: string | null;
  invoice_total?: number | null;
  paid_to_date?: number | null;
  balance_due?: number | null;
};

function printPaymentReceipt(r: PaymentReceipt) {
  const CLINIC = getClinic();
  const w = window.open("", "", "width=900,height=1000");
  if (!w) return;
  const money = (n: number | null | undefined) =>
    `৳${Number(n || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
  const methodLabel = (m: string) =>
    ({ cash: "Cash", card: "Card", mobile_banking: "Mobile Banking", bank_transfer: "Bank Transfer", due: "Due" } as any)[m] || m;

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Payment Receipt ${r.receipt_no}</title>
    <style>
      @page{size:A5 landscape;margin:12mm}
      @media print{.no-print{display:none}}
      body{font-family:Inter,Arial,sans-serif;font-size:12px;color:#111;margin:0;padding:16px}
      .card{border:2px solid #1f7a58;border-radius:8px;padding:16px;max-width:640px;margin:0 auto}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:12px}
      h1{margin:0;font-size:20px;color:#1f7a58}
      .muted{color:#666;font-size:11px}
      .title{text-align:center;font-size:16px;font-weight:600;letter-spacing:1px;margin:6px 0 14px;text-transform:uppercase;color:#1f7a58}
      table{width:100%;border-collapse:collapse}
      td{padding:5px 0;vertical-align:top}
      .lbl{color:#555;width:40%}
      .val{font-weight:600;text-align:right}
      .amount{background:#f0fdf4;border:1px dashed #16a34a;padding:10px;margin:12px 0;text-align:center;border-radius:6px}
      .amount .big{font-size:26px;font-weight:700;color:#166534}
      .footer{margin-top:20px;display:flex;justify-content:space-between;font-size:11px;color:#555}
      .sig{border-top:1px solid #999;width:180px;text-align:center;padding-top:4px;margin-top:36px}
      .thanks{text-align:center;margin-top:12px;color:#1f7a58;font-weight:600}
      .toolbar{max-width:640px;margin:0 auto 10px;text-align:right}
      .btn{background:#1f7a58;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px}
    </style></head><body>
    <div class="toolbar no-print">
      <button class="btn" onclick="window.print()">Print</button>
      <button class="btn" onclick="window.close()" style="background:#666;margin-left:6px">Close</button>
    </div>
    <div class="card">
      <div class="head">
        <div>
          <h1>${CLINIC.name}</h1>
          <div class="muted">${CLINIC.address}</div>
          <div class="muted">${CLINIC.phone} • ${CLINIC.email}</div>
        </div>
        <div style="text-align:right">
          <div><b>${r.receipt_no}</b></div>
          <div class="muted">${r.date}</div>
        </div>
      </div>
      <div class="title">Payment Receipt</div>
      <table>
        <tr><td class="lbl">Paid To (Supplier)</td><td class="val">${r.supplier_name ?? "—"}</td></tr>
        ${r.invoice_no ? `<tr><td class="lbl">Against Invoice</td><td class="val">${r.invoice_no}</td></tr>` : ""}
        <tr><td class="lbl">Payment Method</td><td class="val">${methodLabel(r.method)}</td></tr>
        ${r.reference ? `<tr><td class="lbl">Reference</td><td class="val">${r.reference}</td></tr>` : ""}
        <tr><td class="lbl">Payment Date</td><td class="val">${r.date}</td></tr>
      </table>
      <div class="amount">
        <div class="muted">Amount Received</div>
        <div class="big">${money(r.amount)}</div>
      </div>
      ${(r.invoice_total != null || r.paid_to_date != null || r.balance_due != null) ? `
      <table>
        ${r.invoice_total != null ? `<tr><td class="lbl">Invoice Total</td><td class="val">${money(r.invoice_total)}</td></tr>` : ""}
        ${r.paid_to_date != null ? `<tr><td class="lbl">Paid To Date</td><td class="val" style="color:#16a34a">${money(r.paid_to_date)}</td></tr>` : ""}
        ${r.balance_due != null ? `<tr><td class="lbl">Balance Due</td><td class="val" style="color:${Number(r.balance_due) > 0 ? '#dc2626' : '#16a34a'}">${money(r.balance_due)}</td></tr>` : ""}
      </table>` : ""}
      <div class="thanks">Thank you!</div>
      <div class="footer">
        <div class="sig">Received By</div>
        <div class="sig">Authorized Signature</div>
      </div>
    </div>
    <script>setTimeout(()=>window.print(),300)</script>
    </body></html>`);
  w.document.close();
}

type Product = { id: string; name: string; sku: string | null; barcode: string | null; selling_price: number; purchase_price: number; stock_quantity: number };
type Supplier = { id: string; name: string; phone: string | null; balance_due: number };
type Invoice = {
  id: string; invoice_no: string; supplier_invoice_no: string | null; supplier_id: string | null;
  invoice_date: string; subtotal: number; discount: number; vat: number; freight: number;
  total: number; paid: number; due: number; status: string; notes: string | null; created_at: string;
  suppliers?: { name: string } | null;
};

function PurchasesPage() {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [returnFor, setReturnFor] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [labelFor, setLabelFor] = useState<{ id: string; invoice_no: string } | null>(null);
  const [search, setSearch] = useState("");

  const { data: invoices = [] } = useQuery({
    queryKey: ["purchase_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("*, suppliers(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id,name,phone,balance_due").order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-purchase"],
    queryFn: async () => {
      const data = await fetchAll<any>(() => supabase
        .from("products")
        .select("id,name,sku,barcode,selling_price,purchase_price,stock_quantity")
        .order("name")
        .order("id"));
      return (data ?? []) as Product[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(i =>
      i.invoice_no.toLowerCase().includes(q) ||
      (i.supplier_invoice_no ?? "").toLowerCase().includes(q) ||
      (i.suppliers?.name ?? "").toLowerCase().includes(q)
    );
  }, [invoices, search]);

  const totals = useMemo(() => {
    const t = invoices.reduce(
      (a, i) => ({ total: a.total + Number(i.total), paid: a.paid + Number(i.paid), due: a.due + Number(i.due) }),
      { total: 0, paid: 0, due: 0 }
    );
    return t;
  }, [invoices]);

  const supplierDues = useMemo(() =>
    suppliers.filter(s => Number(s.balance_due) > 0).sort((a, b) => Number(b.balance_due) - Number(a.balance_due)),
    [suppliers]
  );

  return (
    <div className="p-0 sm:p-2">
      <PageHeader
        title="Purchases"
        description="Supplier invoices, stock receipts & payables"
        icon={Truck}
        actions={
          <Button onClick={() => setOpenCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Purchase Invoice
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Purchases</div><div className="text-xl sm:text-2xl font-semibold">{fmt(totals.total)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Paid</div><div className="text-xl sm:text-2xl font-semibold text-emerald-600">{fmt(totals.paid)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Outstanding Due</div><div className="text-xl sm:text-2xl font-semibold text-destructive">{fmt(totals.due)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Invoices</div><div className="text-xl sm:text-2xl font-semibold">{invoices.length}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="invoices">
        <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="dues">Supplier Dues</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Purchase History</CardTitle>
              <Input
                placeholder="Search invoice / supplier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Ref #</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">No purchase invoices yet</TableCell></TableRow>
                  )}
                  {filtered.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs">{inv.invoice_no}</TableCell>
                      <TableCell>{inv.invoice_date}</TableCell>
                      <TableCell>{inv.suppliers?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{inv.supplier_invoice_no ?? "—"}</TableCell>
                      <TableCell className="text-right">{fmt(Number(inv.total))}</TableCell>
                      <TableCell className="text-right text-emerald-600">{fmt(Number(inv.paid))}</TableCell>
                      <TableCell className={`text-right ${Number(inv.due) > 0 ? "text-destructive font-medium" : ""}`}>{fmt(Number(inv.due))}</TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" title="View" onClick={() => setViewId(inv.id)}><Eye className="h-4 w-4" /></Button>
                          {Number(inv.due) > 0 && (
                            <Button size="icon" variant="ghost" title="Pay" onClick={() => setPayFor(inv)}><Wallet className="h-4 w-4" /></Button>
                          )}
                          <PurchaseLabelsButton invoiceId={inv.id} invoiceNo={inv.invoice_no} />
                          {inv.status !== "returned" && (
                            <Button size="icon" variant="ghost" title="Return" onClick={() => setReturnFor(inv.id)}><RotateCcw className="h-4 w-4" /></Button>
                          )}
                          <DeleteInvoiceButton
                            invoiceId={inv.id}
                            onDone={() => qc.invalidateQueries({ queryKey: ["purchase_invoices"] })}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dues">
          <Card>
            <CardHeader><CardTitle>Suppliers with Outstanding Balance</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Balance Due</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {supplierDues.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">All clear — no dues</TableCell></TableRow>
                  )}
                  {supplierDues.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-muted-foreground">{s.phone ?? "—"}</TableCell>
                      <TableCell className="text-right text-destructive font-medium">{fmt(Number(s.balance_due))}</TableCell>
                      <TableCell className="text-right">
                        <SupplierPayDialog supplier={s} onDone={() => {
                          qc.invalidateQueries({ queryKey: ["suppliers"] });
                          qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
                        }} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {openCreate && (
        <CreateInvoiceDialog
          open={openCreate}
          onOpenChange={setOpenCreate}
          suppliers={suppliers}
          products={products}
          onCreated={(created) => {
            if (created?.id) setLabelFor({ id: created.id, invoice_no: created.invoice_no ?? "" });
            qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
            qc.invalidateQueries({ queryKey: ["suppliers"] });
            qc.invalidateQueries({ queryKey: ["products-purchase"] });
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["batches"] });
          }}
        />
      )}

      {labelFor && (
        <PurchaseLabelsDialog
          invoiceId={labelFor.id}
          invoiceNo={labelFor.invoice_no}
          onClose={() => setLabelFor(null)}
        />
      )}

      {viewId && <ViewInvoiceDialog invoiceId={viewId} onClose={() => setViewId(null)} />}
      {returnFor && (
        <ReturnDialog
          invoiceId={returnFor}
          onClose={() => setReturnFor(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
            qc.invalidateQueries({ queryKey: ["suppliers"] });
            qc.invalidateQueries({ queryKey: ["products-purchase"] });
          }}
        />
      )}
      {payFor && (
        <PayInvoiceDialog
          invoice={payFor}
          onClose={() => setPayFor(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
            qc.invalidateQueries({ queryKey: ["suppliers"] });
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    posted: { label: "Due", cls: "bg-amber-100 text-amber-800" },
    paid: { label: "Paid", cls: "bg-emerald-100 text-emerald-800" },
    partially_returned: { label: "Part. Returned", cls: "bg-orange-100 text-orange-800" },
    returned: { label: "Returned", cls: "bg-rose-100 text-rose-800" },
    draft: { label: "Draft", cls: "bg-slate-100 text-slate-800" },
  };
  const s = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-800" };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

/* ---------------- Create Invoice ---------------- */

type Row = {
  product_id: string;
  quantity: string;
  purchase_price: string;
  discount: string;
  new_selling_price: string;
  batch_no: string;
  expiry_date: string;
};

const emptyRow = (): Row => ({
  product_id: "", quantity: "1", purchase_price: "", discount: "0",
  new_selling_price: "", batch_no: "", expiry_date: "",
});

function CreateInvoiceDialog({
  open, onOpenChange, suppliers, products, onCreated,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  suppliers: Supplier[]; products: Product[]; onCreated: (created?: { id: string; invoice_no?: string }) => void;
}) {
  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [discount, setDiscount] = useState("0");
  const [vat, setVat] = useState("0");
  const [freight, setFreight] = useState("0");
  const [paid, setPaid] = useState("0");
  const [method, setMethod] = useState<string>("cash");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);

  const subtotal = useMemo(() =>
    rows.reduce((a, r) => {
      const q = Number(r.quantity) || 0;
      const p = Number(r.purchase_price) || 0;
      const d = Number(r.discount) || 0;
      return a + (q * p - d);
    }, 0), [rows]);

  const total = subtotal - (Number(discount) || 0) + (Number(vat) || 0) + (Number(freight) || 0);
  const due = Math.max(total - (Number(paid) || 0), 0);
  const validRows = rows.filter(r => r.product_id && Number(r.quantity) > 0 && Number(r.purchase_price) >= 0);

  const create = useMutation({
    mutationFn: async () => {
      if (validRows.length === 0) throw new Error("Add at least one item");
      const paidNum = Number(paid) || 0;
      if ([discount, vat, freight, paid].some((v) => (Number(v) || 0) < 0)) {
        throw new Error("Discount, VAT, freight and paid cannot be negative");
      }
      if (total < 0) throw new Error("Discount is larger than the invoice amount");
      // Paying more than the bill made the supplier balance go negative and
      // took the extra money out of the drawer.
      if (paidNum > total + 0.009) throw new Error(`Paid cannot exceed the invoice total (৳${total.toFixed(2)})`);
      const { data, error } = await supabase.rpc("create_purchase_invoice" as any, {
        _supplier_id: supplierId || null,
        _supplier_invoice_no: supplierInvoiceNo || null,
        _invoice_date: invoiceDate,
        _items: validRows.map(r => ({
          product_id: r.product_id,
          quantity: Number(r.quantity),
          purchase_price: Number(r.purchase_price),
          discount: Number(r.discount) || 0,
          new_selling_price: r.new_selling_price ? Number(r.new_selling_price) : null,
          batch_no: r.batch_no || null,
          expiry_date: r.expiry_date || null,
        })),
        _discount: Number(discount) || 0,
        _vat: Number(vat) || 0,
        _freight: Number(freight) || 0,
        _paid: Number(paid) || 0,
        _payment_method: method as any,
        _notes: notes || null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data) => {
      toast.success(`Invoice ${data?.invoice_no} created`);
      onCreated(data ? { id: data.id, invoice_no: data.invoice_no } : undefined);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const pickProduct = (i: number, pid: string) => {
    const p = products.find(x => x.id === pid);
    updateRow(i, {
      product_id: pid,
      purchase_price: p ? String(p.purchase_price ?? 0) : "",
      new_selling_price: p ? String(p.selling_price ?? "") : "",
    });
  };

  // quick add: search a product and it lands as a new row (or bumps qty if already added)
  const quickAdd = (p: { id: string; name: string; purchase_price?: number | null; selling_price?: number | null }) => {
    const existing = rows.findIndex(r => r.product_id === p.id);
    if (existing >= 0) {
      updateRow(existing, { quantity: String((Number(rows[existing].quantity) || 0) + 1) });
      toast.success(`${p.name} qty +1`);
      return;
    }
    const newRow: Row = {
      ...emptyRow(),
      product_id: p.id,
      purchase_price: String(p.purchase_price ?? 0),
      new_selling_price: String(p.selling_price ?? ""),
    };
    // replace a leading empty row instead of leaving a blank line behind
    setRows(prev => {
      const blank = prev.findIndex(r => !r.product_id);
      if (blank >= 0) return prev.map((r, i) => (i === blank ? newRow : r));
      return [...prev, newRow];
    });
    toast.success(`${p.name} added`);
  };

  const [scan, setScan] = useState("");
  const handleScan = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const key = code.toLowerCase();
    const p = products.find(
      x => (x.barcode ?? "").toLowerCase() === key || (x.sku ?? "").toLowerCase() === key,
    );
    setScan("");
    if (!p) {
      toast.error(`No product for barcode ${code}`);
      return;
    }
    quickAdd(p);
  };




  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Purchase Invoice</DialogTitle></DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Choose supplier" /></SelectTrigger>
              <SelectContent>
                {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Supplier Invoice #</Label>
            <Input value={supplierInvoiceNo} onChange={e => setSupplierInvoiceNo(e.target.value)} placeholder="e.g. INV-1023" />
          </div>
          <div>
            <Label>Invoice Date</Label>
            <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 rounded-lg border bg-muted/40 p-3 space-y-3">
          <div>
            <Label className="mb-1 block text-xs">Barcode scan (scanning adds the product)</Label>
            <Input
              autoFocus
              value={scan}
              onChange={e => setScan(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScan(scan);
                }
              }}
              placeholder="Scan / type barcode then Enter…"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Quick add product (search by name / SKU / barcode)</Label>
            <ProductPicker
              products={products}
              quickAdd
              placeholder="Search product to add…"
              onSelect={quickAdd}
            />
          </div>
        </div>


        <div className="mt-4 border rounded-lg overflow-x-auto">

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Product</TableHead>
                <TableHead className="w-24">Qty</TableHead>
                <TableHead className="w-28">Cost ৳</TableHead>
                <TableHead className="w-24">Line Disc</TableHead>
                <TableHead className="w-28">New Sell ৳</TableHead>
                <TableHead className="w-28">Batch</TableHead>
                <TableHead className="w-36">Expiry</TableHead>
                <TableHead className="w-24 text-right">Line Total</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const lineTotal = (Number(r.quantity) || 0) * (Number(r.purchase_price) || 0) - (Number(r.discount) || 0);
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <ProductPicker
                        products={products}
                        value={r.product_id}
                        onSelect={(p) => pickProduct(i, p.id)}
                        placeholder="Search product…"
                      />

                    </TableCell>
                    <TableCell><Input value={r.quantity} onChange={e => updateRow(i, { quantity: e.target.value })} /></TableCell>
                    <TableCell><Input value={r.purchase_price} onChange={e => updateRow(i, { purchase_price: e.target.value })} /></TableCell>
                    <TableCell><Input value={r.discount} onChange={e => updateRow(i, { discount: e.target.value })} /></TableCell>
                    <TableCell><Input value={r.new_selling_price} onChange={e => updateRow(i, { new_selling_price: e.target.value })} /></TableCell>
                    <TableCell><Input value={r.batch_no} onChange={e => updateRow(i, { batch_no: e.target.value })} /></TableCell>
                    <TableCell><Input type="date" value={r.expiry_date} onChange={e => updateRow(i, { expiry_date: e.target.value })} /></TableCell>
                    <TableCell className="text-right">{fmt(lineTotal)}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="mt-2">
          <Button variant="outline" size="sm" onClick={() => setRows([...rows, emptyRow()])}>
            <Plus className="h-4 w-4 mr-1" /> Add Row
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} />
          </div>
          <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
            <Row2 label="Subtotal" value={fmt(subtotal)} />
            <div className="grid grid-cols-3 gap-2 items-center">
              <Label>Overall Disc</Label>
              <Input value={discount} onChange={e => setDiscount(e.target.value)} className="col-span-2" />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <Label>VAT</Label>
              <Input value={vat} onChange={e => setVat(e.target.value)} className="col-span-2" />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <Label>Freight</Label>
              <Input value={freight} onChange={e => setFreight(e.target.value)} className="col-span-2" />
            </div>
            <Row2 label="Grand Total" value={fmt(total)} strong />
            <div className="grid grid-cols-3 gap-2 items-center">
              <Label>Paid Now</Label>
              <Input value={paid} onChange={e => setPaid(e.target.value)} className="col-span-2" />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="mobile_banking">Mobile Banking</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="due">Due (no payment)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Row2 label="Due" value={fmt(due)} danger />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || validRows.length === 0}>
            {create.isPending ? "Saving..." : "Save Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row2({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`${strong ? "text-lg font-semibold" : "text-sm"} ${danger ? "text-destructive" : ""}`}>{value}</span>
    </div>
  );
}

/* ---------------- View Invoice ---------------- */

function ViewInvoiceDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["purchase_invoice", invoiceId],
    queryFn: async () => {
      const [{ data: inv }, { data: items }, { data: pays }, { data: rets }] = await Promise.all([
        supabase.from("purchase_invoices").select("*, suppliers(name, phone, address)").eq("id", invoiceId).maybeSingle(),
        supabase.from("purchase_invoice_items").select("*").eq("invoice_id", invoiceId),
        supabase.from("supplier_payments").select("*").eq("invoice_id", invoiceId).order("created_at"),
        supabase.from("purchase_returns").select("*, purchase_return_items(*)").eq("invoice_id", invoiceId).order("created_at"),
      ]);
      return { inv, items: items ?? [], pays: pays ?? [], rets: rets ?? [] };
    },
  });

  const inv: any = data?.inv;
  const items: any[] = data?.items ?? [];
  const pays: any[] = data?.pays ?? [];
  const rets: any[] = data?.rets ?? [];

  const printInvoice = () => {
    const w = window.open("", "", "width=900,height=1000");
    if (!w || !inv) return;
    const itemRows = items.map((it: any) => `
      <tr>
        <td>${it.name}</td>
        <td class="r">${it.quantity}</td>
        <td class="r">${Number(it.purchase_price).toFixed(2)}</td>
        <td class="r">${Number(it.discount).toFixed(2)}</td>
        <td class="r">${Number(it.line_total).toFixed(2)}</td>
        <td>${it.batch_no ?? ""}</td>
        <td>${it.expiry_date ?? ""}</td>
      </tr>`).join("");

    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${inv.invoice_no}</title>
      <style>
        @page{size:A4;margin:14mm}
        body{font-family:Inter,Arial,sans-serif;font-size:12px;color:#111}
        h1{margin:0;font-size:20px}
        .muted{color:#666}
        table{width:100%;border-collapse:collapse;margin-top:10px}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
        th{background:#f5f5f5}
        .r{text-align:right}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}
        .totals{margin-top:12px;width:280px;margin-left:auto}
        .totals td{border:none;padding:3px 0}
        .totals .grand{font-weight:700;font-size:14px;border-top:1px solid #333;padding-top:6px}
      </style></head><body>
      <div style="display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:8px">
        <div><h1>Pet Care Vet Clinic</h1><div class="muted">Purchase Invoice</div></div>
        <div style="text-align:right">
          <div><b>${inv.invoice_no}</b></div>
          <div class="muted">Date: ${inv.invoice_date}</div>
          ${inv.supplier_invoice_no ? `<div class="muted">Supplier Ref: ${inv.supplier_invoice_no}</div>` : ""}
        </div>
      </div>
      <div class="grid">
        <div><b>Supplier:</b><br>${inv.suppliers?.name ?? "—"}<br>${inv.suppliers?.phone ?? ""}<br>${inv.suppliers?.address ?? ""}</div>
        <div><b>Status:</b> ${inv.status}<br><b>Created:</b> ${new Date(inv.created_at).toLocaleString()}</div>
      </div>
      <table><thead><tr>
        <th>Item</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">Disc</th><th class="r">Total</th><th>Batch</th><th>Expiry</th>
      </tr></thead><tbody>${itemRows}</tbody></table>
      <table class="totals">
        <tr><td>Subtotal</td><td class="r">${Number(inv.subtotal).toFixed(2)}</td></tr>
        <tr><td>Discount</td><td class="r">-${Number(inv.discount).toFixed(2)}</td></tr>
        <tr><td>VAT</td><td class="r">${Number(inv.vat).toFixed(2)}</td></tr>
        <tr><td>Freight</td><td class="r">${Number(inv.freight).toFixed(2)}</td></tr>
        <tr class="grand"><td>Grand Total</td><td class="r">৳${Number(inv.total).toFixed(2)}</td></tr>
        <tr><td>Paid</td><td class="r">${Number(inv.paid).toFixed(2)}</td></tr>
        <tr><td>Due</td><td class="r">৳${Number(inv.due).toFixed(2)}</td></tr>
      </table>
      ${inv.notes ? `<p class="muted"><b>Notes:</b> ${inv.notes}</p>` : ""}
      <script>setTimeout(()=>window.print(),200)</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Invoice {inv?.invoice_no}</span>
            <Button size="sm" variant="outline" onClick={printInvoice}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          </DialogTitle>
        </DialogHeader>
        {!inv ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Info label="Supplier" value={inv.suppliers?.name ?? "—"} />
              <Info label="Date" value={inv.invoice_date} />
              <Info label="Supplier Ref" value={inv.supplier_invoice_no ?? "—"} />
              <Info label="Status" value={<StatusBadge status={inv.status} />} />
            </div>
            <div className="border rounded-lg">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Disc</TableHead>
                  <TableHead className="text-right">Total</TableHead><TableHead>Batch</TableHead>
                  <TableHead>Expiry</TableHead><TableHead className="text-right">Returned</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {items.map(it => (
                    <TableRow key={it.id}>
                      <TableCell>{it.name}</TableCell>
                      <TableCell className="text-right">{it.quantity}</TableCell>
                      <TableCell className="text-right">{fmt(Number(it.purchase_price))}</TableCell>
                      <TableCell className="text-right">{fmt(Number(it.discount))}</TableCell>
                      <TableCell className="text-right">{fmt(Number(it.line_total))}</TableCell>
                      <TableCell className="text-xs">{it.batch_no ?? "—"}</TableCell>
                      <TableCell className="text-xs">{it.expiry_date ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{Number(it.returned_quantity) || 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <h4 className="font-medium mb-2">Payments</h4>
                {pays.length === 0 ? <div className="text-sm text-muted-foreground">No payments</div> : (
                  <ul className="space-y-1 text-sm">
                    {pays.map(p => (
                      <li key={p.id} className="flex justify-between items-center border-b pb-1 gap-2">
                        <span className="flex-1">{p.paid_at} • {p.method}{p.reference ? <span className="text-xs text-muted-foreground ml-1">({p.reference})</span> : null}</span>
                        <span className="text-emerald-600">{fmt(Number(p.amount))}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          title="Print receipt"
                          onClick={() => printPaymentReceipt({
                            receipt_no: `RCPT-${String(p.id).slice(0, 8).toUpperCase()}`,
                            date: p.paid_at,
                            amount: Number(p.amount),
                            method: p.method,
                            reference: p.reference,
                            supplier_name: inv.suppliers?.name ?? null,
                            invoice_no: inv.invoice_no,
                            invoice_total: Number(inv.total),
                            paid_to_date: Number(inv.paid),
                            balance_due: Number(inv.due),
                          })}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-lg bg-muted/30 p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{fmt(Number(inv.subtotal))}</span></div>
                <div className="flex justify-between"><span>Discount</span><span>-{fmt(Number(inv.discount))}</span></div>
                <div className="flex justify-between"><span>VAT</span><span>{fmt(Number(inv.vat))}</span></div>
                <div className="flex justify-between"><span>Freight</span><span>{fmt(Number(inv.freight))}</span></div>
                <div className="flex justify-between font-semibold text-base border-t pt-1"><span>Total</span><span>{fmt(Number(inv.total))}</span></div>
                <div className="flex justify-between text-emerald-600"><span>Paid</span><span>{fmt(Number(inv.paid))}</span></div>
                <div className="flex justify-between text-destructive font-medium"><span>Due</span><span>{fmt(Number(inv.due))}</span></div>
              </div>
            </div>
            {rets.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Returns</h4>
                {rets.map((r: any) => (
                  <div key={r.id} className="border rounded p-2 mb-2 text-sm">
                    <div className="flex justify-between">
                      <span className="font-mono">{r.return_no}</span>
                      <span className="text-destructive">-{fmt(Number(r.refund_amount))}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{r.reason ?? ""}</div>
                    <ul className="text-xs mt-1 list-disc list-inside">
                      {(r.purchase_return_items ?? []).map((ri: any) => (
                        <li key={ri.id}>{ri.name} × {ri.quantity} = {fmt(Number(ri.line_total))}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

/* ---------------- Return ---------------- */

function ReturnDialog({ invoiceId, onClose, onDone }: { invoiceId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<string>("adjust_due");
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});

  const { data: items = [] } = useQuery({
    queryKey: ["purchase_invoice_items", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_invoice_items").select("*").eq("invoice_id", invoiceId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const doReturn = useMutation({
    mutationFn: async () => {
      const items_payload = (items as any[])
        .map(it => {
          const q = Number(qtyMap[it.id] || 0);
          if (q <= 0) return null;
          return { invoice_item_id: it.id, quantity: q };
        })
        .filter(Boolean);
      if (items_payload.length === 0) throw new Error("Enter quantity to return");
      const { data, error } = await supabase.rpc("create_purchase_return" as any, {
        _invoice_id: invoiceId,
        _items: items_payload as any,
        _reason: reason || null,
        _refund_method: refundMethod === "adjust_due" ? null : (refundMethod as any),
        _restock: true,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (d) => {
      toast.success(`Return ${d?.return_no} • refund ${fmt(Number(d?.refund_amount))}`);
      onDone();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Purchase Return</DialogTitle></DialogHeader>
        <div className="border rounded">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Item</TableHead><TableHead className="text-right">Purchased</TableHead>
              <TableHead className="text-right">Returned</TableHead><TableHead className="text-right">Remaining</TableHead>
              <TableHead className="w-28">Return Qty</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(items as any[]).map(it => {
                const remaining = Number(it.quantity) - Number(it.returned_quantity);
                return (
                  <TableRow key={it.id}>
                    <TableCell>{it.name}</TableCell>
                    <TableCell className="text-right">{it.quantity}</TableCell>
                    <TableCell className="text-right">{it.returned_quantity}</TableCell>
                    <TableCell className="text-right">{remaining}</TableCell>
                    <TableCell>
                      <Input
                        value={qtyMap[it.id] ?? ""}
                        disabled={remaining <= 0}
                        onChange={e => setQtyMap({ ...qtyMap, [it.id]: e.target.value })}
                        placeholder="0"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Reason</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Damaged / expired / wrong item..." />
          </div>
          <div>
            <Label>Refund Method</Label>
            <Select value={refundMethod} onValueChange={setRefundMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="adjust_due">Adjust Supplier Due</SelectItem>
                <SelectItem value="cash">Cash Refund</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="mobile_banking">Mobile Banking</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => doReturn.mutate()} disabled={doReturn.isPending}>
            {doReturn.isPending ? "Processing..." : "Process Return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Pay Invoice ---------------- */

function PayInvoiceDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(Number(invoice.due)));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);

  const pay = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter amount");
      if (amt > Number(invoice.due) + 0.009) throw new Error(`Amount cannot exceed the invoice due (৳${Number(invoice.due).toFixed(2)})`);
      const ref = reference || `Against ${invoice.invoice_no}`;
      const { data, error } = await supabase.rpc("record_supplier_payment" as any, {
        _supplier_id: invoice.supplier_id,
        _invoice_id: invoice.id,
        _amount: amt,
        _method: method as any,
        _reference: ref,
        _notes: null,
        _paid_at: today(),
      });
      if (error) throw error;
      return { amt, ref, payId: data as string };
    },
    onSuccess: ({ amt, ref, payId }) => {
      toast.success("Payment recorded");
      const newPaid = Number(invoice.paid) + amt;
      const newDue = Math.max(Number(invoice.total) - newPaid, 0);
      setReceipt({
        receipt_no: `RCPT-${String(payId).slice(0, 8).toUpperCase()}`,
        date: today(),
        amount: amt,
        method,
        reference: ref,
        supplier_name: invoice.suppliers?.name ?? null,
        invoice_no: invoice.invoice_no,
        invoice_total: Number(invoice.total),
        paid_to_date: newPaid,
        balance_due: newDue,
      });
      onDone();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pay Invoice {invoice.invoice_no}</DialogTitle></DialogHeader>
        {receipt ? (
          <div className="space-y-3">
            <div className="rounded-lg border-2 border-emerald-500 bg-emerald-50 p-4 text-center">
              <div className="text-xs text-emerald-800">Payment Recorded</div>
              <div className="text-3xl font-bold text-emerald-700 mt-1">{fmt(receipt.amount)}</div>
              <div className="text-xs text-muted-foreground mt-1">{receipt.receipt_no} • {receipt.date}</div>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Invoice Total</span><span>{fmt(receipt.invoice_total ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid To Date</span><span className="text-emerald-600">{fmt(receipt.paid_to_date ?? 0)}</span></div>
              <div className="flex justify-between font-medium"><span>Balance Due</span><span className={Number(receipt.balance_due) > 0 ? "text-destructive" : "text-emerald-600"}>{fmt(receipt.balance_due ?? 0)}</span></div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Outstanding: <span className="text-destructive font-medium">{fmt(Number(invoice.due))}</span></div>
            <div><Label>Amount</Label><Input value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div><Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="mobile_banking">Mobile Banking</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Cheque no / txn id" /></div>
          </div>
        )}
        <DialogFooter>
          {receipt ? (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={() => printPaymentReceipt(receipt)}>
                <Printer className="h-4 w-4 mr-1" /> Print Receipt
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => pay.mutate()} disabled={pay.isPending}>{pay.isPending ? "Saving..." : "Record Payment"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SupplierPayDialog({ supplier, onDone }: { supplier: Supplier; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Number(supplier.balance_due)));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);

  const pay = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter amount");
      if (amt > Number(supplier.balance_due) + 0.009) throw new Error(`Amount cannot exceed the supplier balance (৳${Number(supplier.balance_due).toFixed(2)})`);
      const ref = reference || `Payment to ${supplier.name}`;
      const { data, error } = await supabase.rpc("record_supplier_payment" as any, {
        _supplier_id: supplier.id,
        _invoice_id: null,
        _amount: amt,
        _method: method as any,
        _reference: ref,
        _notes: null,
        _paid_at: today(),
      });
      if (error) throw error;
      return { amt, ref, payId: data as string };
    },
    onSuccess: ({ amt, ref, payId }) => {
      toast.success("Payment recorded");
      const newBalance = Math.max(Number(supplier.balance_due) - amt, 0);
      setReceipt({
        receipt_no: `RCPT-${String(payId).slice(0, 8).toUpperCase()}`,
        date: today(),
        amount: amt,
        method,
        reference: ref,
        supplier_name: supplier.name,
        balance_due: newBalance,
      });
      onDone();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) setReceipt(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Wallet className="h-4 w-4 mr-1" /> Pay</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Pay {supplier.name}</DialogTitle></DialogHeader>
        {receipt ? (
          <div className="space-y-3">
            <div className="rounded-lg border-2 border-emerald-500 bg-emerald-50 p-4 text-center">
              <div className="text-xs text-emerald-800">Payment Recorded</div>
              <div className="text-3xl font-bold text-emerald-700 mt-1">{fmt(receipt.amount)}</div>
              <div className="text-xs text-muted-foreground mt-1">{receipt.receipt_no} • {receipt.date}</div>
            </div>
            <div className="text-sm">
              <div className="flex justify-between font-medium"><span>Remaining Balance</span><span className={Number(receipt.balance_due) > 0 ? "text-destructive" : "text-emerald-600"}>{fmt(receipt.balance_due ?? 0)}</span></div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Balance due: <span className="text-destructive font-medium">{fmt(Number(supplier.balance_due))}</span></div>
            <div><Label>Amount</Label><Input value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div><Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="mobile_banking">Mobile Banking</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div>
          </div>
        )}
        <DialogFooter>
          {receipt ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Close</Button>
              <Button onClick={() => printPaymentReceipt(receipt)}>
                <Printer className="h-4 w-4 mr-1" /> Print Receipt
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button onClick={() => pay.mutate()} disabled={pay.isPending}>{pay.isPending ? "Saving..." : "Record Payment"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Delete ---------------- */

function DeleteInvoiceButton({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_purchase_invoice" as any, { _invoice_id: invoiceId });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Invoice deleted"); onDone(); },
    onError: (e: any) => toast.error(e.message ?? "Failed (admin only)"),
  });

  return (
    <Button
      size="icon"
      variant="ghost"
      title="Delete (admin)"
      onClick={() => {
        if (confirm("Delete this invoice and reverse stock? This cannot be undone.")) del.mutate();
      }}
    >
      <X className="h-4 w-4 text-destructive" />
    </Button>
  );
}

function PurchaseLabelsButton({ invoiceId, invoiceNo }: { invoiceId: string; invoiceNo: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="icon" variant="ghost" title="Print barcode labels for purchased items" onClick={() => setOpen(true)}>
        <Barcode className="h-4 w-4" />
      </Button>
      {open && (
        <PurchaseLabelsDialog invoiceId={invoiceId} invoiceNo={invoiceNo} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function PurchaseLabelsDialog({ invoiceId, invoiceNo, onClose }: { invoiceId: string; invoiceNo: string; onClose: () => void }) {
  const { data: items, isLoading } = useQuery({
    queryKey: ["purchase-label-items", invoiceId],
    queryFn: async (): Promise<LabelProduct[]> => {
      const { data, error } = await supabase
        .from("purchase_invoice_items")
        .select("id, name, quantity, product_id, products(id, name, barcode, selling_price)")
        .eq("invoice_id", invoiceId);
      if (error) throw error;
      const map = new Map<string, LabelProduct>();
      (data ?? []).forEach((row: any) => {
        const prod = row.products;
        if (!prod?.barcode) return;
        const qty = Math.max(0, Math.floor(Number(row.quantity) || 0));
        const existing = map.get(prod.id);
        if (existing) {
          const nextQty = (existing.defaultCopies ?? 0) + qty;
          existing.defaultCopies = nextQty;
          existing.badge = { label: `Purchased ${nextQty}`, tone: "secondary" };
          return;
        }
        map.set(prod.id, {
          id: prod.id,
          name: prod.name ?? row.name,
          selling_price: Number(prod.selling_price) || 0,
          barcode: prod.barcode,
          defaultCopies: qty,
          badge: { label: `Purchased ${qty}`, tone: "secondary" },
        });
      });
      return [...map.values()];
    },
  });

  if (isLoading || !items) return null;

  return (
    <BarcodeLabelDialog
      open
      onOpenChange={(v) => { if (!v) onClose(); }}
      products={items}
      title={`Barcode Labels — ${invoiceNo}`}
      hint={
        items.length
          ? "Copies default to the purchased quantity — adjust with +/− before printing."
          : "No purchased item has a barcode yet. Set barcodes in Inventory first."
      }
      onDone={onClose}
    />
  );
}
