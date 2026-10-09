import { createFileRoute } from "@tanstack/react-router";
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Search, Plus, Minus, Trash2, Receipt as ReceiptIcon, CheckCircle2, AlertTriangle, Clock, UserPlus, Check, ChevronsUpDown, PauseCircle, ClipboardList, X, Bike } from "lucide-react";
import { Switch } from "@/components/ui/switch";

import { supabase } from "@/integrations/supabase/client";
import { fuzzyMatch, codeMatch, type MatchRange } from "@/lib/fuzzy-search";
import { customerKey } from "@/lib/customer-insights";
import { fetchAll } from "@/lib/fetch-all";
import { dhakaDayKey } from "@/lib/sales-summary";
import { HighlightText } from "@/components/HighlightText";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { ReturnFlow } from "@/components/ReturnFlow";
import { SalesHistory } from "@/components/SalesHistory";
import { toast } from "sonner";
import { printInvoice, printThermal, receiptExtras, type Receipt } from "@/lib/invoice-print";
import { useEffect } from "react";
import { resolveProductImageUrl } from "@/components/ProductImageUpload";
import ThermalPrinterSettings from "@/components/ThermalPrinterSettings";
import { Link } from "@tanstack/react-router";
import { useWhatsAppInvoice } from "@/lib/use-whatsapp-invoice";
import { DeliveryDialog } from "@/components/DeliveryDialog";
import { createDelivery, deliveryForReceipt, fetchActiveDelivery, fetchDeliveryMen, saveDeliveryMan } from "@/lib/deliveries";
import {
  HELD_CHANNEL_LABELS,
  cancelHeldBill,
  fetchHeldBills,
  markHeldBillConverted,
  saveHeldBill,
  takeQueuedResume,
  updateHeldBill,
  type HeldBill,
} from "@/lib/held-bills";

function CustomerCombobox({
  owners,
  value,
  onChange,
  openSignal = 0,
  onPicked,
}: {
  owners: { id: string; full_name: string; phone?: string | null; visitCount?: number }[];
  value: string;
  onChange: (id: string) => void;
  /** Bump to open the search from the keyboard (desktop flow). */
  openSignal?: number;
  /** Called after a customer is chosen, so the next step can take focus. */
  onPicked?: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  const picked = useRef(false);
  const pick = (id: string) => {
    onChange(id);
    picked.current = true;
    setOpen(false);
  };
  const selected = owners.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="flex-1 min-w-0 justify-between font-normal">
          <span className="truncate">
            {selected ? `${selected.full_name}${selected.phone ? ` · ${selected.phone}` : ""}` : "Walk-in"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        align="start"
        onCloseAutoFocus={(e) => {
          // After a pick, focus goes to the next step (Paid) instead of
          // jumping back to this button.
          if (picked.current && onPicked) {
            e.preventDefault();
            picked.current = false;
            onPicked();
          }
          picked.current = false;
        }}
      >
        <Command>
          <CommandInput placeholder="Name or phone, then Enter…" />
          <CommandList>
            <CommandEmpty>No customer found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="walk-in" onSelect={() => pick("")}>
                <Check className={`h-4 w-4 ${value ? "opacity-0" : "opacity-100"}`} />
                Walk-in
              </CommandItem>
              {owners.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`${o.full_name} ${o.phone ?? ""}`}
                  onSelect={() => pick(o.id)}
                >
                  <Check className={`h-4 w-4 ${value === o.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate flex-1">{o.full_name}</span>
                  <div className="ml-auto flex items-center gap-2">
                    {typeof o.visitCount === "number" && o.visitCount > 0 && (
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 tabular-nums ${o.visitCount > 1 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                        {o.visitCount} visit{o.visitCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {o.phone && <span className="text-xs text-muted-foreground">{o.phone}</span>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const PosThumb = memo(function PosThumb({ path, name }: { path: string | null; name: string }) {

  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Only resolve the signed URL once the thumb scrolls near the viewport.
  useEffect(() => {
    if (!path || !boxRef.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } },
      { rootMargin: "200px" },
    );
    io.observe(boxRef.current);
    return () => io.disconnect();
  }, [path]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    resolveProductImageUrl(path).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [visible, path]);

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const preload = () => { if (url) { const i = new Image(); i.src = url; } };

  const trigger = url ? (
    <img
      src={url}
      alt={name}
      loading="lazy"
      decoding="async"
      onClick={(e) => { stop(e); setOpen(true); }}
      onMouseEnter={preload}
      className="h-11 w-11 shrink-0 cursor-zoom-in rounded-md border object-cover hover:ring-2 hover:ring-primary"
    />
  ) : path ? (
    // Placeholder while the image loads — products without an image show none.
    <div ref={boxRef} className="h-11 w-11 shrink-0 rounded-md bg-muted" />
  ) : null;

  return (
    <>
      {trigger}
      {url && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className="max-w-3xl p-2 bg-background/95"
            onClick={stop}
          >
            <DialogHeader className="px-2 pt-1">
              <DialogTitle className="text-sm">{name}</DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center max-h-[80vh] overflow-auto">
              <img
                src={url}
                alt={name}
                loading="eager"
                decoding="async"
                className="max-h-[78vh] w-auto object-contain rounded"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
});

const ProductCard = memo(function ProductCard({ p, ranges, onAdd, active = false }: { p: Product; ranges?: MatchRange[]; onAdd: (p: Product) => void; active?: boolean }) {
  const qty = Number(p.stock_quantity);
  const out = qty <= 0;
  const threshold = Number(p.low_stock_threshold ?? 0);
  const low = !out && threshold > 0 && qty <= threshold;
  const stockTone = out ? "text-destructive" : low ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
  const dot = out ? "bg-destructive" : low ? "bg-amber-500" : "bg-emerald-500";
  return (
    <button
      type="button"
      onClick={() => onAdd(p)}
      data-active={active || undefined}
      className={`group flex h-full min-w-0 touch-manipulation flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:scale-[0.98] data-[active]:border-primary data-[active]:bg-primary/5 data-[active]:ring-2 data-[active]:ring-primary/30 ${out ? "opacity-70" : ""}`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <PosThumb path={p.image_url} name={p.name} />
        <div className="min-w-0 flex-1">
          <HighlightText className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground" text={p.name} ranges={ranges} />
          {p.category && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.category}</p>}
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
        <span className="text-[15px] font-semibold tabular-nums">৳{Number(p.selling_price).toLocaleString("en-BD", { maximumFractionDigits: 2 })}</span>
        <span className={`flex min-w-0 items-center gap-1 truncate text-[11px] font-medium tabular-nums ${stockTone}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          {out ? "Out of stock" : `${qty}${p.unit ? ` ${p.unit}` : ""}`}
        </span>
      </div>
    </button>
  );
});

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({ meta: [
    { title: "Mobile POS Counter | Pet Care Vet" },
    { name: "description", content: "Fast mobile veterinary POS with live product stock, barcode sales, customer selection, and checkout." },
    { property: "og:title", content: "Mobile POS Counter | Pet Care Vet" },
    { property: "og:description", content: "Fast mobile veterinary POS with live stock and barcode checkout." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: POSPage,
});

type Product = {
  id: string; name: string; sku: string | null; barcode: string | null;
  category: string; selling_price: number; tax_percent: number; stock_quantity: number; unit: string | null;
  low_stock_threshold: number | null; image_url: string | null;
};
type CartLine = { product_id: string; name: string; unit_price: number; quantity: number; discount: number; tax_percent: number; stock_quantity: number; low_stock_threshold: number | null; nearest_expiry: string | null };

type Owner = { id: string; full_name: string; phone: string | null; address?: string | null; visitCount?: number };


const METHODS = ["cash", "bkash", "nagad", "rocket", "card", "bank", "due"] as const;

/** Labels shown in the payment method picker. `due` = COD / online delivery bill kept unpaid. */
const METHOD_LABELS: Record<(typeof METHODS)[number], string> = {
  cash: "Cash",
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  card: "Card",
  bank: "Bank",
  due: "Pending / Unpaid (COD)",
};

const CART_STORAGE_KEY = "pos-cart-draft-v1";




function POSPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [qtyFocused, setQtyFocused] = useState<Record<string, boolean>>({});
  const [ownerId, setOwnerId] = useState<string>("");
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("cash");
  const [paidAmount, setPaidAmount] = useState<number | "">("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [sheetQ, setSheetQ] = useState("");

  // Pending Bill = bill not finalised yet (hold / online order). Resumed bills
  // become a real sale once checked out here.
  const [resumedBill, setResumedBill] = useState<HeldBill | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [deliveryFor, setDeliveryFor] = useState<string | null>(null);
  // Delivery inside the cart: saved together with the bill. Tracking only —
  // the charge is shown on the bill but never added to the sale.
  const [delOn, setDelOn] = useState(false);
  const [delManId, setDelManId] = useState("");
  const [delCharge, setDelCharge] = useState("");
  const [delAddress, setDelAddress] = useState("");
  const [delNote, setDelNote] = useState("");
  const [delAdding, setDelAdding] = useState(false);
  const [delNewName, setDelNewName] = useState("");
  const [delNewPhone, setDelNewPhone] = useState("");

  const [newCustOpen, setNewCustOpen] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustGender, setNewCustGender] = useState<"male" | "female" | "">("");
  const searchRef = useRef<HTMLInputElement>(null);
  const cartCardRef = useRef<HTMLDivElement>(null);
  const cartHydrated = useRef(false);

  // Keep the cart alive when navigating to other pages and back.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          cart?: CartLine[]; discount?: number; ownerId?: string; method?: string; resumedBill?: HeldBill | null;
        };
        if (Array.isArray(saved.cart) && saved.cart.length > 0) setCart(saved.cart);
        if (typeof saved.discount === "number") setDiscount(saved.discount);
        if (typeof saved.ownerId === "string") setOwnerId(saved.ownerId);
        // Remember which held bill is in the cart, so holding it again after a
        // page refresh updates that bill instead of creating a duplicate.
        if (saved.resumedBill && Array.isArray(saved.cart) && saved.cart.length > 0) setResumedBill(saved.resumedBill);
        if (saved.method && (METHODS as readonly string[]).includes(saved.method)) {
          setMethod(saved.method as (typeof METHODS)[number]);
        }
      }
    } catch { /* ignore corrupt cache */ }
    cartHydrated.current = true;
  }, []);

  // The first run happens before the restored cart reaches state (cart is still
  // []), and used to delete the saved cart for a moment — a reload or hot
  // update at that instant lost it. Skip that first empty write.
  const persistReady = useRef(false);
  useEffect(() => {
    if (!cartHydrated.current) return;
    if (!persistReady.current) {
      persistReady.current = true;
      if (cart.length === 0) return;
    }
    try {
      if (cart.length === 0) localStorage.removeItem(CART_STORAGE_KEY);
      else localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ cart, discount, ownerId, method, resumedBill }));
    } catch { /* storage full or unavailable */ }
  }, [cart, discount, ownerId, method, resumedBill]);

  // Emptying the cart by hand ends the link to a held bill — new items added
  // afterwards are a new bill, not an edit of the old one.
  useEffect(() => {
    if (cartHydrated.current && cart.length === 0 && resumedBill) setResumedBill(null);
  }, [cart.length, resumedBill]);



  // After the receipt dialog closes (esp. after opening a print popup), Radix
  // may leave `pointer-events: none` on <body>, making the POS un-clickable.
  // Restore it and refocus the search input for the next scan.
  const closeReceipt = () => {
    setReceipt(null);
    setTimeout(() => {
      document.body.style.pointerEvents = "";
      searchRef.current?.focus();
    }, 50);
  };

  const { data: products = [] } = useQuery({
    queryKey: ["pos-products"],
    queryFn: async () => {
      // Paged: the API returns at most 1000 rows per request, so products past
      // the first 1000 were missing from POS search and barcode scan.
      return fetchAll<Product>(() => supabase.from("products")
        .select("id,name,sku,barcode,category,selling_price,tax_percent,stock_quantity,unit,low_stock_threshold,image_url")
        .eq("is_active", true).order("name").order("id"));
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: openShift } = useQuery({
    queryKey: ["pos-open-shift"],
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
    // Always re-check on entering POS: a shift opened/closed on the Cash Drawer
    // page (or another device) must not leave POS blocked on a cached status.
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const shiftOpen = !!openShift;

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["held-bills-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("held_bills")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  // Put a held bill into the cart (from the Held popup or the Pending Bills page).
  const loadHeldBill = useCallback((bill: HeldBill) => {
    const lines: CartLine[] = (bill.items ?? []).map((it) => {
      const p = products.find((pr) => pr.id === it.product_id);
      return {
        product_id: it.product_id,
        name: it.name,
        unit_price: Number(it.unit_price),
        quantity: Number(it.quantity),
        discount: Number(it.discount) || 0,
        tax_percent: Number(it.tax_percent) || 0,
        stock_quantity: Number(p?.stock_quantity ?? 0),
        low_stock_threshold: p?.low_stock_threshold ?? null,
        nearest_expiry: null,
      };
    });
    if (lines.length === 0) return false;
    setCart(lines);
    setDiscount(Number(bill.discount) || 0);
    setOwnerId(bill.owner_id ?? "");
    setPaidAmount("");
    setResumedBill(bill);
    setMethod("cash");
    return true;
  }, [products]);

  // Load a pending bill queued from the Pending Bills screen into the cart.
  const resumeTried = useRef(false);
  useEffect(() => {
    if (resumeTried.current || products.length === 0) return;
    resumeTried.current = true;
    const bill = takeQueuedResume();
    if (!bill) return;
    if (loadHeldBill(bill)) toast.success(`Held bill ${bill.bill_no} loaded — complete the payment to finalise it.`);
  }, [products, loadHeldBill]);

  // Held bills list for the in-POS popup.
  const { data: heldBills = [], isFetching: heldLoading } = useQuery({
    queryKey: ["held-bills", "pending"],
    enabled: heldOpen,
    staleTime: 0,
    queryFn: () => fetchHeldBills("pending"),
  });

  const { data: expiryMap = {} } = useQuery({
    queryKey: ["pos-product-expiries"],
    queryFn: async () => {
      const today = dhakaDayKey(new Date());
      const data = await fetchAll(() => supabase.from("stock_batches")
        .select("product_id,expiry_date,quantity")
        .gt("quantity", 0)
        .not("expiry_date", "is", null)
        .gte("expiry_date", today)
        .order("expiry_date", { ascending: true })
        .order("id"));
      const map: Record<string, string> = {};
      for (const b of (data ?? []) as { product_id: string; expiry_date: string }[]) {
        if (!map[b.product_id]) map[b.product_id] = b.expiry_date;
      }
      return map;
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: owners = [] } = useQuery({
    queryKey: ["owners"],
    queryFn: () => fetchAll<Owner>(() => supabase.from("pet_owners").select("id,full_name,phone,address").order("full_name").order("id")),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: visitCountMap } = useQuery({
    queryKey: ["owner-visit-counts"],
    queryFn: async () => {
      const data = await fetchAll<{ owner_id: string; status: string }>(() => supabase
        .from("sales")
        .select("owner_id,status")
        .not("owner_id", "is", null)
        .not("status", "in", '("void","refunded")')
        .order("id"), 200000);
      const ownerById = new Map(owners.map((o) => [o.id, o]));
      const map = new Map<string, number>();
      (data ?? []).forEach((s) => {
        const owner = ownerById.get(s.owner_id);
        const key = customerKey(owner);
        if (!key) return;
        map.set(key, (map.get(key) || 0) + 1);
      });
      return map;
    },
    enabled: owners.length > 0,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const ownersWithCount = useMemo(() => {
    if (!visitCountMap) return owners;
    return owners.map((o) => ({ ...o, visitCount: visitCountMap.get(customerKey(o)) || 0 }));
  }, [owners, visitCountMap]);


  // Pre-normalized search index so keystrokes don't re-lowercase the whole catalog.
  const index = useMemo(
    () => products.map((p) => ({
      p,
      name: p.name.toLowerCase(),
      sku: (p.sku ?? "").replace(/\s+/g, "").toLowerCase(),
      bc: (p.barcode ?? "").replace(/\s+/g, "").toLowerCase(),
    })),
    [products],
  );

  // O(1) scan lookup: barcode/SKU maps built once per catalog load instead of
  // scanning the whole product array on every Enter from the scanner.
  const scanMaps = useMemo(() => {
    const byBarcode = new Map<string, Product>();
    const bySku = new Map<string, Product>();
    for (const it of index) {
      if (it.bc && !byBarcode.has(it.bc)) byBarcode.set(it.bc, it.p);
      if (it.sku && !bySku.has(it.sku)) bySku.set(it.sku, it.p);
    }
    return { byBarcode, bySku };
  }, [index]);

  // Deferred query keeps typing/scanning responsive while the grid catches up.
  const deferredQ = useDeferredValue(q);

  // Units sold per product over the last 90 days — best sellers are shown
  // first, and among equally good matches the best seller wins.
  const { data: soldMap } = useQuery({
    queryKey: ["pos-best-sellers"],
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      const rows = await fetchAll<{ product_id: string | null; quantity: number }>(() =>
        supabase
          .from("sale_items")
          .select("product_id,quantity,sales!inner(created_at,status)")
          .gte("sales.created_at", since)
          .neq("sales.status", "void")
          .not("product_id", "is", null)
          .order("id") as any,
      200000);
      const m = new Map<string, number>();
      for (const r of rows) if (r.product_id) m.set(r.product_id, (m.get(r.product_id) ?? 0) + Number(r.quantity || 0));
      return m;
    },
  });

  // Typo-tolerant search ranked for a cashier: a match at the start of a word
  // beats one in the middle, which beats a near-miss spelling; inside each of
  // those, the best-selling product comes first.
  const searchProducts = useCallback(
    (text: string, limit: number) => {
      const s = text.replace(/\s+/g, " ").trim();
      const sold = (id: string) => soldMap?.get(id) ?? 0;
      if (!s) {
        return [...products]
          .sort((a, b) => sold(b.id) - sold(a.id))
          .slice(0, limit)
          .map((p) => ({ p, ranges: [] as MatchRange[] }));
      }
      const scored: { p: Product; ranges: MatchRange[]; tier: number; score: number }[] = [];
      for (const it of index) {
        const m = fuzzyMatch(it.p.name, s);
        if (m) {
          const tier = m.score >= 1100 ? 3 : m.score >= 900 ? 2 : 1;
          scored.push({ p: it.p, ranges: m.ranges, tier, score: m.score });
        } else if (codeMatch(it.p.sku, s) || codeMatch(it.p.barcode, s)) {
          scored.push({ p: it.p, ranges: [], tier: 4, score: 900 });
        }
      }
      scored.sort((a, b) => b.tier - a.tier || sold(b.p.id) - sold(a.p.id) || b.score - a.score);
      return scored.slice(0, limit);
    },
    [index, products, soldMap],
  );

  const filtered = useMemo(() => searchProducts(deferredQ, 40), [searchProducts, deferredQ]);

  // Search inside the mobile cart sheet so more products can be added without
  // closing the cart.
  const sheetResults = useMemo(
    () => (sheetQ.trim() ? searchProducts(sheetQ, 12) : ([] as { p: Product; ranges: MatchRange[] }[])),
    [searchProducts, sheetQ],
  );

  // ---- Keyboard-first desktop flow -------------------------------------------
  // Search → Enter → Qty → Enter → (repeat) → empty Enter → Customer → Enter →
  // Paid → Enter (bill saved) → Enter (print) → Enter (new sale).
  // -1 = nothing highlighted. A card is only highlighted after the arrow keys
  // are used; Enter without arrows still adds the best match.
  const [hi, setHi] = useState(-1);
  useEffect(() => setHi(-1), [deferredQ]);
  const [qtyFor, setQtyFor] = useState<Product | null>(null);
  const [qtyText, setQtyText] = useState("1");
  const qtyRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);
  const [customerSignal, setCustomerSignal] = useState(0);
  const isDesktop = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
  const focusSearch = useCallback(() => {
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);






  // Ref keeps addToCart identity stable so memoized product cards never re-render.
  const expiryRef = useRef(expiryMap);
  expiryRef.current = expiryMap;

  const warnStock = useCallback((p: Product) => {
    const threshold = Number(p.low_stock_threshold ?? 0);
    if (threshold > 0 && Number(p.stock_quantity) <= threshold) {
      toast.warning(`${p.name}: only ${p.stock_quantity} ${p.unit ?? ""} left (reorder at ${threshold})`);
    }
    const exp = expiryRef.current[p.id];
    if (exp) {
      const days = Math.ceil((new Date(exp).getTime() - Date.now()) / 86400000);
      if (days <= 30) toast.warning(`${p.name}: nearest batch expires in ${days} day${days === 1 ? "" : "s"} (${exp})`);
    }
  }, []);

  // Same product again → its existing cart line grows (no duplicate lines).
  const addToCart = useCallback((p: Product, qty = 1) => {
    warnStock(p);
    const stock = Number(p.stock_quantity);
    if (stock <= 0) toast.warning(`${p.name}: stock 0 — selling anyway`);
    setCart((c) => {
      const found = c.find((l) => l.product_id === p.id);
      if (found) {
        return c.map((l) => l.product_id === p.id ? { ...l, quantity: l.quantity + qty } : l);
      }
      return [...c, {
        product_id: p.id, name: p.name, unit_price: Number(p.selling_price),
        quantity: qty, discount: 0, tax_percent: Number(p.tax_percent),
        stock_quantity: stock,
        low_stock_threshold: p.low_stock_threshold,
        nearest_expiry: expiryRef.current[p.id] ?? null,
      }];
    });
  }, [warnStock]);

  // Scanner debounce: hardware scanners often fire the same code twice (double
  // trigger / repeated Enter). Ignore an identical code within 600ms; a repeat
  // of the same product on purpose still works after that window or via +.
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const hiRef = useRef(hi);
  hiRef.current = hi;

  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Keep the highlighted card on screen while moving with the arrow keys.
  useEffect(() => {
    if (!desktop) return;
    document.querySelector<HTMLElement>('[data-pos-grid] [data-active]')?.scrollIntoView({ block: "nearest" });
  }, [hi, desktop]);

  const openQty = (p: Product) => {
    setQtyFor(p);
    setQtyText("1");
    setTimeout(() => { qtyRef.current?.focus(); qtyRef.current?.select(); }, 0);
  };

  const confirmQty = () => {
    if (!qtyFor) return;
    const n = Math.min(99999, Math.floor(Number(qtyText)));
    if (!(n > 0)) { toast.error("Enter a quantity of 1 or more"); return; }
    addToCart(qtyFor, n);
    setQtyFor(null);
    setQ("");
    focusSearch();
  };

  const handleScanKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const list = filteredRef.current;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!list.length) return;
      e.preventDefault();
      setHi((h) => (e.key === "ArrowDown" ? Math.min(list.length - 1, h + 1) : Math.max(0, h - 1)));
      return;
    }
    if (e.key === "Escape") {
      if (e.currentTarget.value) { e.preventDefault(); setQ(""); }
      return;
    }
    if (e.key !== "Enter") return;
    // Read straight from the input element, NOT from React state: a hardware
    // scanner types the whole code + Enter faster than state can flush, so `q`
    // can still hold the *previous* code (which added the wrong product).
    const typed = e.currentTarget.value;
    const raw = typed.replace(/\s+/g, "");
    if (!raw) {
      // Empty search + Enter = products done → go to the customer step.
      if (isDesktop() && cart.length > 0) {
        e.preventDefault();
        setCustomerSignal((n) => n + 1);
      }
      return;
    }
    e.preventDefault();
    const norm = raw.toLowerCase();

    const now = Date.now();
    const last = lastScanRef.current;
    if (last.code === norm && now - last.at < 250) {
      setQ("");
      return; // duplicate scan burst — swallow it
    }
    lastScanRef.current = { code: norm, at: now };

    // 1) Exact barcode, 2) exact SKU — both O(1) map hits. Scanned codes are
    // added straight away (qty 1): a scanner cannot type a quantity.
    let target: Product | null =
      scanMaps.byBarcode.get(norm) ?? scanMaps.bySku.get(norm) ?? null;
    // 3) Unique SKU prefix (short internal codes typed by staff).
    if (!target) {
      let hit: Product | null = null;
      let count = 0;
      for (const [sku, p] of scanMaps.bySku) {
        if (sku.startsWith(norm)) { hit = p; if (++count > 1) break; }
      }
      if (count === 1) target = hit;
    }
    if (target) {
      addToCart(target);
      setQ("");
      if (window.matchMedia("(max-width: 1023px)").matches) setCartOpen(true);
      return;
    }

    // 4) Typed name: take the highlighted result (results are computed from
    // exactly what is in the box, so a lagging grid can't pick a wrong item).
    const visibleForThis = deferredQ === typed;
    const results = visibleForThis ? list : searchProducts(typed, 40);
    const pick = results[visibleForThis && hiRef.current >= 0 ? Math.min(hiRef.current, results.length - 1) : 0]?.p ?? null;
    if (!pick) {
      lastScanRef.current = { code: "", at: 0 };
      toast.error(`No product for "${typed.trim()}"`);
      return;
    }
    if (isDesktop()) {
      openQty(pick); // Product → Enter → Quantity → Enter
    } else {
      addToCart(pick);
      setQ("");
      setCartOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanMaps, addToCart, deferredQ, cart.length, searchProducts]);




  function updateQty(id: string, delta: number) {
    setCart((c) => c.map((l) => {
      if (l.product_id !== id) return l;
      const next = l.quantity + delta;
      return { ...l, quantity: Math.max(0, next) };
    }).filter((l) => l.quantity > 0));
  }

  function setQty(id: string, raw: string) {
    const digits = raw.replace(/[^0-9]/g, "");
    const value = digits === "" ? 0 : Math.min(99999, parseInt(digits, 10));
    // Keep the line while the box is being edited: clearing the field to type a
    // new number used to delete the item from the cart instantly.
    setCart((c) => c.map((l) => (l.product_id === id ? { ...l, quantity: value } : l)));
  }

  function dropEmptyLine(id: string) {
    setCart((c) => c.filter((l) => l.product_id !== id || l.quantity > 0));
  }

  function remove(id: string) { setCart((c) => c.filter((l) => l.product_id !== id)); }

  const totals = useMemo(() => {
    let sub = 0, tax = 0;
    for (const l of cart) {
      const lineSub = l.unit_price * l.quantity - l.discount;
      const lineTax = lineSub * (l.tax_percent / 100);
      sub += lineSub; tax += lineTax;
    }
    // Invoice discount can never be negative or larger than the bill; the
    // server stores exactly what we send, so an over-discount used to fail
    // (negative total) or a negative one silently increased the bill.
    const appliedDiscount = Math.min(Math.max(0, discount), Math.max(0, sub + tax));
    const total = Math.max(0, sub + tax - appliedDiscount);
    return { sub, tax, total, discount: appliedDiscount };
  }, [cart, discount]);

  const itemCount = cart.reduce((n, l) => n + l.quantity, 0);
  const hasZeroQty = cart.some((l) => !(l.quantity > 0));

  const { data: deliveryMen = [], refetch: refetchDeliveryMen, error: deliveryMenError, isLoading: deliveryMenLoading } = useQuery({
    queryKey: ["delivery-men", "active"],
    enabled: delOn,
    queryFn: () => fetchDeliveryMen(false),
  });
  // Address comes from the chosen customer; the cashier can still edit it.
  useEffect(() => {
    if (!delOn) return;
    const o = ownerId ? owners.find((x) => x.id === ownerId) : null;
    setDelAddress(o?.address ?? "");
  }, [delOn, ownerId, owners]);
  useEffect(() => {
    if (delOn && !delManId && deliveryMen.length === 1) setDelManId(deliveryMen[0].id);
  }, [delOn, delManId, deliveryMen]);
  const delChargeNum = delOn ? Math.max(0, Number(delCharge) || 0) : 0;
  const resetDelivery = () => {
    setDelOn(false); setDelManId(""); setDelCharge(""); setDelAddress(""); setDelNote("");
    setDelAdding(false); setDelNewName(""); setDelNewPhone("");
  };
  const addDeliveryMan = useMutation({
    mutationFn: () => saveDeliveryMan({ name: delNewName, phone: delNewPhone || null }),
    onSuccess: async (m) => {
      await refetchDeliveryMen();
      setDelManId(m.id); setDelAdding(false); setDelNewName(""); setDelNewPhone("");
      toast.success(`Delivery man ${m.name} added`);
    },
    onError: (e: any) => toast.error(e.message ?? "Could not add delivery man"),
  });

  const sendWhatsApp = useWhatsAppInvoice();
  const checkout = useMutation({
    mutationFn: async () => {
      if (!shiftOpen) throw new Error("Cash drawer is not open. Please open a shift from Cash Drawer before making sales.");
      if (cart.length === 0) throw new Error("Cart is empty");
      const zeroLine = cart.find((l) => !(l.quantity > 0));
      if (zeroLine) throw new Error(`Set a quantity for ${zeroLine.name} or remove it`);
      if (delOn) {
        if (!delManId) throw new Error("Choose a delivery man (or turn Delivery off)");
        if (!(Number(delCharge || 0) >= 0)) throw new Error("Delivery charge must be 0 or more");
      }
      const tendered = paidAmount === "" ? totals.total : Number(paidAmount);
      // Money kept in the drawer never exceeds the invoice total — extra cash is change returned to the customer
      const paid = method === "due" ? 0 : Math.max(0, Math.min(tendered, totals.total));
      if (totals.total - paid > 0.009 && !ownerId) {
        throw new Error("Select a customer for a due sale — the due must be assigned to someone.");
      }
      const items = cart.map((l) => {
        const lineSub = l.unit_price * l.quantity - l.discount;
        const lineTax = lineSub * (l.tax_percent / 100);
        return { product_id: l.product_id, name: l.name, quantity: l.quantity, unit_price: l.unit_price, discount: l.discount, tax: lineTax };
      });
      const payments = method === "due" ? [] : [{ method, amount: paid, reference: null }];

      const { data, error } = await (supabase.rpc as any)("create_sale", {
        _owner_id: ownerId || null, _items: items, _payments: payments,
        _discount: totals.discount, _notes: null,
      });
      if (error) throw error;
      const rpc = data as { sale_id: string; invoice_no: string; total: number; paid: number; due: number };
      const ownerObj = ownerId ? owners.find((o) => o.id === ownerId) ?? null : null;
      const snapshot: Receipt = {
        sale_id: rpc.sale_id,
        invoice_no: rpc.invoice_no,
        total: Number(rpc.total),
        paid: Number(rpc.paid),
        due: Number(rpc.due),
        subtotal: totals.sub,
        tax: totals.tax,
        discount: totals.discount,
        method,
        issued_at: new Date().toISOString(),
        owner: ownerObj ? { full_name: ownerObj.full_name, phone: ownerObj.phone } : null,
        items: items.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          unit_price: it.unit_price,
          discount: it.discount,
          tax: it.tax,
          line_total: it.unit_price * it.quantity - it.discount + it.tax,
        })),
      };
      if (resumedBill) {
        const { data: saleRow } = await supabase
          .from("sales")
          .select("id")
          .eq("invoice_no", rpc.invoice_no)
          .maybeSingle();
        await markHeldBillConverted(resumedBill.id, saleRow?.id ?? null);
      }
      if (delOn) {
        // Separate record; the sale above is already final and is not touched.
        try {
          await createDelivery({ saleId: rpc.sale_id, deliveryManId: delManId, charge: delChargeNum, address: delAddress, note: delNote });
          const man = deliveryMen.find((m) => m.id === delManId);
          snapshot.delivery =
            deliveryForReceipt(await fetchActiveDelivery(rpc.sale_id)) ??
            { kind: "local", charge: delChargeNum, man: man?.name ?? null, manPhone: man?.phone ?? null, address: delAddress || null, status: "Pending" };
        } catch (e: any) {
          toast.error(`Bill saved, but the delivery was not created: ${e?.message ?? e}. Use "Send for delivery".`);
        }
      }
      return snapshot;
    },
    onSuccess: (r) => {
      toast.success(
        Number(r.due) > 0.009
          ? `Bill ${r.invoice_no} saved as pending — ৳ ${Number(r.due).toFixed(2)} unpaid`
          : `Sale ${r.invoice_no} recorded`,
      );

      setReceipt(r);
      // Send the invoice to the customer's WhatsApp automatically (Cloud API).
      void sendWhatsApp(r, r.sale_id, { auto: true });
      setCart([]); setDiscount(0); setPaidAmount(""); setOwnerId(""); setResumedBill(null); setCartOpen(false);
      resetDelivery();
      qc.invalidateQueries({ queryKey: ["held-bills"] });
      qc.invalidateQueries({ queryKey: ["held-bills-count"] });
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["pos-product-expiries"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["owner-visit-counts"] });
      qc.invalidateQueries({ queryKey: ["customers-ledger"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // One click: the current cart goes on hold and the counter is free for the
  // next customer. A bill that was taken back from hold keeps its number.
  const holdCurrentCart = async () => {
    if (cart.length === 0) throw new Error("Cart is empty");
    const ownerObj = ownerId ? owners.find((o) => o.id === ownerId) ?? null : null;
    const input = {
        owner_id: ownerId || null,
        customer_name: ownerObj?.full_name ?? null,
        customer_phone: ownerObj?.phone ?? null,
        items: cart.map((l) => ({
          product_id: l.product_id,
          name: l.name,
          unit_price: l.unit_price,
          quantity: l.quantity,
          discount: l.discount,
          tax_percent: l.tax_percent,
        })),
        discount,
        note: resumedBill?.note ?? null,
        channel: resumedBill?.channel ?? "counter",
    };
    return resumedBill ? updateHeldBill(resumedBill.id, input) : saveHeldBill(input);
  };

  const clearCart = () => {
    setCart([]); setDiscount(0); setPaidAmount(""); setOwnerId(""); setResumedBill(null);
  };

  const holdBill = useMutation({
    mutationFn: holdCurrentCart,
    onSuccess: (b) => {
      toast.success(`Bill ${b.bill_no} on hold — tap Held to bring it back.`);
      clearCart();
      setCartOpen(false);
      setTimeout(() => searchRef.current?.focus(), 50);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Bring a held bill back. Whatever is in the cart now is put on hold first,
  // so nothing is lost when switching between customers.
  const resumeHeld = useMutation({
    mutationFn: async (bill: HeldBill) => {
      let parked: HeldBill | null = null;
      if (cart.length > 0 && resumedBill?.id !== bill.id) parked = await holdCurrentCart();
      return { bill, parked };
    },
    onSuccess: ({ bill, parked }) => {
      if (resumedBill?.id === bill.id) {
        setHeldOpen(false);
        return;
      }
      if (!loadHeldBill(bill)) {
        toast.error(`Bill ${bill.bill_no} has no items`);
        return;
      }
      setHeldOpen(false);
      toast.success(
        parked
          ? `Bill ${parked.bill_no} put on hold · ${bill.bill_no} is back in the cart`
          : `Bill ${bill.bill_no} is back in the cart`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const discardHeld = useMutation({
    mutationFn: (bill: HeldBill) => cancelHeldBill(bill.id),
    onSuccess: (_d, bill) => {
      if (resumedBill?.id === bill.id) setResumedBill(null);
      toast.success(`Held bill ${bill.bill_no} removed`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createCustomer = useMutation({
    mutationFn: async () => {
      const name = newCustName.trim();
      const phone = newCustPhone.trim();
      if (!name) throw new Error("Customer name is required");
      if (phone) {
        const dup = owners.find((o) => (o.phone ?? "").replace(/\s+/g, "") === phone.replace(/\s+/g, ""));
        if (dup) return dup;
      }
      const { data, error } = await supabase.from("pet_owners")
        .insert({ full_name: name, phone: phone || null, gender: newCustGender || null })
        .select("id,full_name,phone").single();
      if (error) throw error;
      return data as Owner;
    },
    onSuccess: (o) => {
      toast.success(`Customer "${o.full_name}" saved`);
      qc.invalidateQueries({ queryKey: ["owners"] });
      qc.invalidateQueries({ queryKey: ["pet_owners"] });
      setOwnerId(o.id);
      setNewCustOpen(false);
      setNewCustName(""); setNewCustPhone(""); setNewCustGender("");
    },
    onError: (e: Error) => toast.error(e.message),
  });




  // Which print the Enter key triggers on the "Sale complete" screen.
  const [enterPrint, setEnterPrintState] = useState<"thermal" | "a4">(() => {
    try { return localStorage.getItem("pos.enterPrint") === "a4" ? "a4" : "thermal"; } catch { return "thermal"; }
  });
  const setEnterPrint = (v: "thermal" | "a4") => {
    setEnterPrintState(v);
    try { localStorage.setItem("pos.enterPrint", v); } catch { /* ignore */ }
  };
  const newSaleRef = useRef<HTMLButtonElement>(null);
  const thermalRef = useRef<HTMLButtonElement>(null);
  const a4Ref = useRef<HTMLButtonElement>(null);
  const afterPrint = () => setTimeout(() => newSaleRef.current?.focus(), 300);

  // Desktop shortcuts: F2 search, F4 customer, F9 pay.
  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); setQtyFor(null); searchRef.current?.focus(); }
      else if (e.key === "F4") { e.preventDefault(); setCustomerSignal((n) => n + 1); }
      else if (e.key === "F9") { e.preventDefault(); paidRef.current?.focus(); paidRef.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop]);

  const renderCartBody = (isDesk: boolean) => {
    const paidNow = method === "due" ? 0 : Math.max(0, Math.min(paidAmount === "" ? totals.total : Number(paidAmount), totals.total));
    const dueNow = Math.max(0, totals.total - paidNow);
    const change = method !== "due" && paidAmount !== "" ? Math.max(0, Number(paidAmount) - totals.total) : 0;
    const billTotal = totals.total + delChargeNum;
    const delId = `del-on-${isDesk ? "d" : "m"}`;
    return (
    <div className="min-w-0 space-y-4">
      {/* Customer */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
        <CustomerCombobox
          owners={ownersWithCount}
          value={ownerId}
          onChange={setOwnerId}
          openSignal={isDesk ? customerSignal : 0}
          onPicked={isDesk ? () => { paidRef.current?.focus(); paidRef.current?.select(); } : undefined}
        />
        <Button type="button" variant="outline" size="icon" onClick={() => setNewCustOpen(true)} title="Add new customer">
          <UserPlus className="h-4 w-4" />
        </Button>
      </div>

      {resumedBill && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Held bill <span className="font-semibold">{resumedBill.bill_no}</span> — payment makes it a final invoice.
        </p>
      )}

      {/* Items */}
      <div className="-mx-1 max-h-[38dvh] overflow-y-auto overscroll-contain px-1 lg:max-h-[32vh]">
        {cart.length === 0 && (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            Scan or search a product to start the bill
          </div>
        )}
        <ul className="divide-y">
          {cart.map((l) => {
            const threshold = Number(l.low_stock_threshold ?? 0);
            const remaining = l.stock_quantity - l.quantity;
            const over = remaining < 0;
            const low = !over && threshold > 0 && remaining <= threshold;
            const expDays = l.nearest_expiry ? Math.ceil((new Date(l.nearest_expiry).getTime() - Date.now()) / 86400000) : null;
            const nearExpiry = expDays !== null && expDays <= 30;
            return (
              <li key={l.product_id} className="py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">{l.name.trim()}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">৳ {l.unit_price.toFixed(2)} each</p>
                  </div>
                  <span className="pt-0.5 text-sm font-semibold tabular-nums">৳ {(l.unit_price * l.quantity - l.discount).toFixed(2)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex items-center rounded-md border">
                    <Button size="icon" variant="ghost" className="h-7 w-7 rounded-r-none" onClick={() => updateQty(l.product_id, -1)} aria-label="Less">
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="text"
                      inputMode="numeric"
                      aria-label={`Quantity of ${l.name.trim()}`}
                      value={l.quantity === 0 && (qtyFocused[l.product_id] ?? false) ? "" : String(l.quantity)}
                      onFocus={(e) => { setQtyFocused((f) => ({ ...f, [l.product_id]: true })); e.currentTarget.select(); }}
                      onBlur={() => { setQtyFocused((f) => ({ ...f, [l.product_id]: false })); dropEmptyLine(l.product_id); }}
                      onChange={(e) => setQty(l.product_id, e.target.value)}
                      className="h-7 w-10 rounded-none border-0 bg-transparent p-0 text-center text-sm font-semibold tabular-nums shadow-none focus-visible:ring-0"
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7 rounded-l-none" onClick={() => updateQty(l.product_id, 1)} aria-label="More">
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <span
                    className={`min-w-0 flex-1 truncate text-[11px] ${over ? "font-medium text-destructive" : low ? "text-amber-700" : nearExpiry ? "text-orange-700" : "text-muted-foreground"}`}
                  >
                    {over
                      ? `Only ${Math.max(0, l.stock_quantity)} in stock`
                      : low
                        ? `${remaining} left after this`
                        : nearExpiry
                          ? (expDays! <= 0 ? "Expires today" : `Expires in ${expDays} days`)
                          : `${remaining} left`}
                  </span>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(l.product_id)} aria-label={`Remove ${l.name.trim()}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Totals */}
      <div className="space-y-1.5 border-t pt-3 text-sm">
        <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">৳ {totals.sub.toFixed(2)}</span></div>
        {totals.tax > 0 && (
          <div className="flex justify-between text-muted-foreground"><span>Tax</span><span className="tabular-nums">৳ {totals.tax.toFixed(2)}</span></div>
        )}
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span>Discount</span>
          <Input
            type="number"
            min={0}
            className="h-7 w-24 text-right text-sm tabular-nums"
            value={discount || ""}
            placeholder="0"
            onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        {delOn && (
          <>
            <div className="flex justify-between text-muted-foreground"><span>Products</span><span className="tabular-nums">৳ {totals.total.toFixed(2)}</span></div>
            <div className="flex justify-between text-sky-700"><span>Delivery</span><span className="tabular-nums">৳ {delChargeNum.toFixed(2)}</span></div>
          </>
        )}
        <div className="flex items-baseline justify-between pt-1">
          <span className="font-medium">{delOn ? "Total bill" : "Total"}</span>
          <span className="text-2xl font-bold tabular-nums tracking-tight">৳ {billTotal.toFixed(2)}</span>
        </div>
      </div>

      {/* Delivery */}
      <div className={`rounded-lg border ${delOn ? "border-sky-200 bg-sky-50/60" : ""}`}>
        <label htmlFor={delId} className="flex cursor-pointer items-center justify-between px-3 py-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Bike className="h-4 w-4 text-sky-700" /> Delivery
            {delOn && delManId && (
              <span className="font-normal text-muted-foreground">· {deliveryMen.find((m) => m.id === delManId)?.name}</span>
            )}
          </span>
          <Switch id={delId} checked={delOn} onCheckedChange={setDelOn} />
        </label>
        {delOn && (
          <div className="space-y-2 border-t border-sky-200 p-3">
            {delAdding ? (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-2">
                <Input placeholder="Name" value={delNewName} onChange={(e) => setDelNewName(e.target.value)} autoFocus />
                <Input placeholder="Phone" inputMode="tel" value={delNewPhone} onChange={(e) => setDelNewPhone(e.target.value)} />
                <Button type="button" size="sm" className="h-10" disabled={!delNewName.trim() || addDeliveryMan.isPending} onClick={() => addDeliveryMan.mutate()}>Save</Button>
                <Button type="button" size="sm" variant="ghost" className="h-10 px-2" onClick={() => setDelAdding(false)}>Cancel</Button>
              </div>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Select value={delManId} onValueChange={setDelManId}>
                  <SelectTrigger className="min-w-0 bg-background"><SelectValue placeholder={deliveryMen.length ? "Delivery man" : "Add a delivery man"} /></SelectTrigger>
                  <SelectContent>
                    {deliveryMen.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}{m.phone ? ` · ${m.phone}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" className="bg-background" title="Add delivery man" onClick={() => setDelAdding(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
            {deliveryMenError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                Could not load delivery men: {(deliveryMenError as any)?.message ?? "unknown error"}
              </p>
            ) : !deliveryMenLoading && deliveryMen.length === 0 && !delAdding ? (
              <p className="text-xs text-muted-foreground">No delivery man yet — press + to add one.</p>
            ) : null}
            <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2">
              <Input className="bg-background" inputMode="decimal" placeholder="Charge ৳" value={delCharge} onChange={(e) => setDelCharge(e.target.value.replace(/[^0-9.]/g, ""))} />
              <Input className="bg-background" placeholder="Address" value={delAddress} onChange={(e) => setDelAddress(e.target.value)} />
            </div>
            <Input className="bg-background" placeholder="Note for delivery man (optional)" value={delNote} onChange={(e) => setDelNote(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Delivery charge is printed on the bill only — not counted in sales, cash or profit.</p>
          </div>
        )}
      </div>

      {/* Payment */}
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Payment method">
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
              className={`h-8 rounded-md border px-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                method === m ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              }`}
            >
              {m === "due" ? "Due" : METHOD_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Received</span>
          <Input
            ref={isDesk ? paidRef : undefined}
            className="h-11 pl-20 text-right text-base font-semibold tabular-nums"
            type="number"
            step="0.01"
            value={paidAmount}
            onChange={(e) => setPaidAmount(e.target.value === "" ? "" : Number(e.target.value))}
            onKeyDown={(e) => {
              // Bill step: Enter saves the bill (empty = paid in full).
              if (e.key === "Enter" && !checkout.isPending && cart.length > 0 && shiftOpen) {
                e.preventDefault();
                checkout.mutate();
              }
              if (e.key === "Escape") { e.preventDefault(); focusSearch(); }
            }}
            placeholder={method === "due" ? "Not paid now" : totals.total.toFixed(2)}
            disabled={method === "due"}
          />
        </div>
        {change > 0 && (
          <p className="flex justify-between text-sm"><span className="text-muted-foreground">Change to return</span><span className="font-semibold tabular-nums">৳ {change.toFixed(2)}</span></p>
        )}
        {dueNow > 0.009 && (
          <p className="flex justify-between text-sm text-destructive">
            <span>{ownerId ? (paidNow <= 0.009 ? "Unpaid — kept as due" : "Due on this bill") : "Choose a customer to keep a due"}</span>
            <span className="font-semibold tabular-nums">৳ {dueNow.toFixed(2)}</span>
          </p>
        )}
      </div>

      {!shiftOpen && (
        <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Cash drawer is closed — open a shift to sell.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Button className="h-12 text-base" disabled={cart.length === 0 || hasZeroQty || checkout.isPending || !shiftOpen} onClick={() => checkout.mutate()}>
          <ReceiptIcon className="h-4 w-4" />
          {!shiftOpen
            ? "Shift not open"
            : checkout.isPending
              ? "Saving…"
              : method === "due"
                ? `Save due bill ৳ ${totals.total.toFixed(2)}`
                : `Charge ৳ ${totals.total.toFixed(2)}`}
        </Button>
        <Button
          className="h-12"
          variant="outline"
          disabled={cart.length === 0 || holdBill.isPending}
          onClick={() => holdBill.mutate()}
          title={resumedBill ? `Hold again (${resumedBill.bill_no})` : "Put this bill on hold"}
        >
          <PauseCircle className="h-4 w-4" /> {holdBill.isPending ? "…" : "Hold"}
        </Button>
      </div>
      {isDesk && cart.length > 0 && (
        <p className="text-center text-[11px] text-muted-foreground">Enter in Received saves the bill</p>
      )}
    </div>
    );
  };

  return (
    <div className="-m-3 min-w-0 overflow-x-clip pb-20 sm:m-0 lg:pb-0">
      <div className="border-b bg-card px-3 pb-3 pt-3 sm:border-0 sm:bg-transparent sm:p-0">
        <PageHeader
          title="POS Counter"
          description="Ring up sales, take payment, print invoice."
          icon={ShoppingCart}
          actions={
            <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto [&_button]:h-9 [&_button]:px-2 [&_button]:text-xs sm:[&_button]:h-10 sm:[&_button]:px-4 sm:[&_button]:text-sm">
              <Button asChild variant="outline">
                <button type="button" onClick={() => setHeldOpen(true)}>
                  <ClipboardList className="h-4 w-4" /> Held
                  {pendingCount > 0 && <Badge variant="secondary" className="ml-1">{pendingCount}</Badge>}
                </button>
              </Button>
              <SalesHistory />
              <ReturnFlow />
            </div>
          }
        />
      </div>

      <div className="grid min-w-0 gap-4 px-3 pt-3 sm:px-0 sm:pt-0 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Product grid */}
        <div className="min-w-0 space-y-3">
          <div className="sticky top-14 z-20 -mx-3 border-b bg-background/95 px-3 py-2 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              autoFocus
              placeholder="Scan barcode or search product…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={handleScanKey}
              className="h-12 w-full min-w-0 rounded-xl bg-card pl-10 pr-16 text-base shadow-sm sm:h-11 sm:text-sm"
            />
            {desktop && !q && (
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">F2</kbd>
            )}
            {q && (
              <button
                type="button"
                onClick={() => { setQ(""); focusSearch(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Clear
              </button>
            )}
            </div>
            {desktop && qtyFor && (
              <div className="mt-2 flex items-center gap-3 rounded-lg border-2 border-primary bg-primary/5 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{qtyFor.name.trim()}</p>
                  <p className="text-xs text-muted-foreground">
                    ৳ {Number(qtyFor.selling_price).toFixed(2)} · Stock {Number(qtyFor.stock_quantity)}{qtyFor.unit ? ` ${qtyFor.unit}` : ""}
                    {cart.find((l) => l.product_id === qtyFor.id) ? ` · already ${cart.find((l) => l.product_id === qtyFor.id)!.quantity} in cart (will add)` : ""}
                  </p>
                </div>
                <Label htmlFor="pos-qty" className="text-xs">Qty</Label>
                <Input
                  id="pos-qty"
                  ref={qtyRef}
                  inputMode="numeric"
                  value={qtyText}
                  onChange={(e) => setQtyText(e.target.value.replace(/[^0-9]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); confirmQty(); }
                    if (e.key === "Escape") { e.preventDefault(); setQtyFor(null); focusSearch(); }
                  }}
                  className="h-10 w-20 text-center text-base font-semibold tabular-nums"
                />
                <Button size="sm" onClick={confirmQty}>Add</Button>
              </div>
            )}
            {desktop && !qtyFor && (
              <p className="mt-1.5 px-1 text-[11px] text-muted-foreground/80">
                Enter adds the best match · ↑ ↓ to choose · empty Enter or F4 for customer · F9 to pay
              </p>
            )}
          </div>
          {!q.trim() && filtered.length > 0 && (
            <p className="px-1 text-xs font-medium text-muted-foreground">Best sellers</p>
          )}
          <div data-pos-grid className="grid min-w-0 auto-rows-fr grid-cols-2 gap-2.5 md:grid-cols-3 2xl:grid-cols-4">
            {filtered.map(({ p, ranges }, i) => (
              <ProductCard key={p.id} p={p} ranges={ranges} onAdd={addToCart} active={desktop && i === hi} />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                No product matches “{q.trim()}”. Check the spelling or scan the barcode.
              </div>
            )}
          </div>

        </div>

        {/* Desktop cart */}
        <Card ref={cartCardRef} className="hidden lg:block lg:sticky lg:top-20 h-fit">
          <CardContent className="p-4">{renderCartBody(true)}</CardContent>
        </Card>
      </div>

      {/* Mobile floating cart bar */}
      {cart.length > 0 && (
        // On phones the bottom menu (56px) is also fixed at the bottom, so the
        // cart bar sits right above it instead of being hidden behind it.
        <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 p-2 shadow-[var(--shadow-soft)] backdrop-blur md:bottom-0 md:pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:hidden">
          <Button className="h-12 w-full rounded-lg" size="lg" onClick={() => setCartOpen(true)}>
            <ShoppingCart className="h-4 w-4" />
            <span className="flex-1 text-left">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
            <span className="tabular-nums font-semibold">৳ {totals.total.toFixed(2)}</span>
          </Button>
        </div>
      )}

      {/* Mobile cart sheet */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="h-[100dvh] w-screen max-w-none overflow-x-hidden overflow-y-auto overscroll-contain rounded-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:h-auto sm:max-h-[92vh] sm:rounded-t-xl">
          {/* The sheet's own X sat under this sticky header and scrolled away,
              so there was no way to close the cart on a phone. */}
          <SheetHeader className="sticky top-0 z-20 -mx-4 -mt-4 mb-3 flex-row items-center justify-between space-y-0 border-b bg-background px-4 py-3 text-left">
            <SheetTitle>Cart · {itemCount} item{itemCount !== 1 ? "s" : ""}</SheetTitle>
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setCartOpen(false)}>
              <X className="h-4 w-4" /> Close
            </Button>
          </SheetHeader>

          {/* Add more products without leaving the cart */}
          <div className="mb-4 space-y-2">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={sheetQ}
                onChange={(e) => setSheetQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const raw = e.currentTarget.value.replace(/\s+/g, "").toLowerCase();
                  const target =
                    scanMaps.byBarcode.get(raw) ?? scanMaps.bySku.get(raw) ?? sheetResults[0]?.p ?? null;
                  if (target) { addToCart(target); setSheetQ(""); }
                  else toast.error(`No product for "${e.currentTarget.value.trim()}"`);
                }}
                placeholder="Add product — scan barcode or search…"
                className="h-11 w-full min-w-0 rounded-lg pl-10 pr-3 text-base"
              />
            </div>
            {sheetQ.trim() !== "" && (
              <div className="max-h-56 divide-y overflow-y-auto overscroll-contain rounded-md border">
                {sheetResults.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">No matching products.</p>
                )}
                {sheetResults.map(({ p, ranges }) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center gap-2 p-3 text-left active:bg-muted"
                    onClick={() => { addToCart(p); setSheetQ(""); }}
                  >
                    <div className="min-w-0 flex-1">
                      <HighlightText className="block truncate text-sm font-medium" text={p.name} ranges={ranges} />
                      <span className="text-xs text-muted-foreground">
                        ৳ {Number(p.selling_price).toFixed(2)} · Stock {Number(p.stock_quantity)}
                      </span>
                    </div>
                    <Plus className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {renderCartBody(false)}

        </SheetContent>
      </Sheet>

      <Dialog open={!!receipt} onOpenChange={(v) => { if (!v) closeReceipt(); }}>
        <DialogContent
          className="sm:max-w-lg max-h-[92vh] overflow-y-auto p-0"
          onOpenAutoFocus={(e) => {
            // Land on the print button the cashier chose, so Enter prints.
            e.preventDefault();
            setTimeout(() => (enterPrint === "a4" ? a4Ref : thermalRef).current?.focus(), 0);
          }}
        >
          <div className="bg-primary/5 border-b px-5 py-5 text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-center text-lg">Sale complete</DialogTitle>
              {receipt && (
                <p className="text-center text-xs text-muted-foreground">
                  {receipt.invoice_no} · {new Date(receipt.issued_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              )}
            </DialogHeader>
          </div>

          {receipt && (
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{receipt.delivery ? "Total bill" : "Total"}</p>
                  <p className="text-lg font-bold tabular-nums">৳ {(receipt.delivery ? receiptExtras(receipt).total : Number(receipt.total)).toFixed(2)}</p>
                </div>
                <div className={`rounded-lg border p-3 ${Number(receipt.due) > 0 ? "border-destructive/30 bg-destructive/5" : "bg-muted/30"}`}>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{Number(receipt.due) > 0 ? "Due" : "Paid"}</p>
                  <p className={`text-lg font-bold tabular-nums ${Number(receipt.due) > 0 ? "text-destructive" : ""}`}>
                    ৳ {Number(Number(receipt.due) > 0 ? receipt.due : receipt.paid).toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                  <span className="truncate">{receipt.owner?.full_name || "Walk-in customer"}{receipt.owner?.phone ? ` · ${receipt.owner.phone}` : ""}</span>
                  <span className="shrink-0">{receipt.items.length} item{receipt.items.length === 1 ? "" : "s"}</span>
                </div>
                <div className="max-h-44 overflow-y-auto divide-y">
                  {receipt.items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{it.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{it.quantity} × ৳ {Number(it.unit_price).toFixed(2)}</p>
                      </div>
                      <span className="shrink-0 tabular-nums">৳ {Number(it.line_total).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1 border-t px-3 py-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">৳ {Number(receipt.subtotal).toFixed(2)}</span></div>
                  {Number(receipt.discount) > 0 && (
                    <div className="flex justify-between text-success"><span>Discount</span><span className="tabular-nums">− ৳ {Number(receipt.discount).toFixed(2)}</span></div>
                  )}
                  {Number(receipt.tax) > 0 && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">৳ {Number(receipt.tax).toFixed(2)}</span></div>
                  )}
                  <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span className="tabular-nums">৳ {Number(receipt.total).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Paid ({(receipt.payments?.length ? receipt.payments.map((p) => p.method).join(", ") : receipt.method) || "—"})</span><span className="tabular-nums">৳ {Number(receipt.paid).toFixed(2)}</span></div>
                  {Number(receipt.due) > 0 && (
                    <div className="flex justify-between font-medium text-destructive"><span>Remaining due</span><span className="tabular-nums">৳ {Number(receipt.due).toFixed(2)}</span></div>
                  )}
                  {receipt.delivery && (() => {
                    const x = receiptExtras(receipt);
                    const d = receipt.delivery!;
                    return (
                      <div className="mt-2 space-y-1 rounded-md border border-sky-200 bg-sky-50/70 p-2">
                        <div className="flex items-center justify-between font-medium text-sky-900">
                          <span className="flex items-center gap-1.5"><Bike className="h-3.5 w-3.5" /> {d.kind === "courier" ? "Courier delivery" : "Local delivery"}</span>
                          {d.status && <span className="text-xs font-normal">{d.status}</span>}
                        </div>
                        {d.man && <div className="flex justify-between"><span className="text-muted-foreground">Rider</span><span>{d.man}{d.manPhone ? ` · ${d.manPhone}` : ""}</span></div>}
                        {d.trackingCode && <div className="flex justify-between"><span className="text-muted-foreground">Tracking</span><span>{d.trackingCode}</span></div>}
                        {x.delivery > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Delivery charge</span><span className="tabular-nums">৳ {x.delivery.toFixed(2)}</span></div>}
                        {x.cod > 0 && <div className="flex justify-between"><span className="text-muted-foreground">COD charge</span><span className="tabular-nums">৳ {x.cod.toFixed(2)}</span></div>}
                        <div className="flex justify-between font-semibold"><span>Total bill</span><span className="tabular-nums">৳ {x.total.toFixed(2)}</span></div>
                        {x.collect > 0 && <div className="flex justify-between font-semibold text-destructive"><span>Rider collects</span><span className="tabular-nums">৳ {x.collect.toFixed(2)}</span></div>}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          <div className="sticky bottom-0 space-y-2 border-t bg-background px-5 py-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                ref={thermalRef}
                variant={enterPrint === "thermal" ? "default" : "outline"}
                className="w-full"
                onClick={() => { if (receipt) { printThermal(receipt); afterPrint(); } }}
              >
                Thermal 80mm
              </Button>
              <Button
                ref={a4Ref}
                variant={enterPrint === "a4" ? "default" : "outline"}
                className="w-full"
                onClick={() => { if (receipt) { printInvoice(receipt); afterPrint(); } }}
              >
                A4 Print
              </Button>
              <Button variant="outline" className="w-full border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" onClick={() => receipt && sendWhatsApp(receipt, receipt.sale_id)}>WhatsApp</Button>
              <ThermalPrinterSettings />
              {receipt?.sale_id && (
                <Button variant="outline" className="col-span-2 w-full" onClick={() => setDeliveryFor(receipt.sale_id!)}>
                  <Bike className="h-4 w-4" />
                  {receipt.delivery ? `Delivery: ${receipt.delivery.man ?? ""} · ৳ ${receipt.delivery.charge.toFixed(2)}` : "Send for delivery"}
                </Button>
              )}
            </div>
            <Button ref={newSaleRef} variant="secondary" className="w-full" onClick={closeReceipt}>New sale</Button>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span><b>Enter</b> = print, then <b>Enter</b> = new sale</span>
              <button
                type="button"
                className="underline"
                onClick={() => setEnterPrint(enterPrint === "thermal" ? "a4" : "thermal")}
              >
                Enter prints: {enterPrint === "thermal" ? "Thermal" : "A4"} (change)
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DeliveryDialog
        saleId={deliveryFor}
        open={!!deliveryFor}
        onOpenChange={(o) => !o && setDeliveryFor(null)}
        onCreated={(d) => {
          // Show the delivery charge on this invoice's print (not added to the sale).
          setReceipt((r) => (r ? { ...r, delivery: deliveryForReceipt(d) } : r));
          setTimeout(() => (enterPrint === "a4" ? a4Ref : thermalRef).current?.focus(), 100);
        }}
      />

      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PauseCircle className="h-4 w-4" /> Held bills</DialogTitle>
          </DialogHeader>
          {cart.length > 0 && !resumedBill && (
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              The bill in your cart now will be put on hold automatically when you bring one back.
            </p>
          )}
          <div className="divide-y rounded-md border">
            {heldLoading && heldBills.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
            )}
            {!heldLoading && heldBills.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">No bills on hold.</p>
            )}
            {heldBills.map((b) => {
              const items = b.items ?? [];
              const qty = items.reduce((n, it) => n + Number(it.quantity || 0), 0);
              const inCart = resumedBill?.id === b.id;
              return (
                <div key={b.id} className={`flex items-center gap-3 p-3 ${inCart ? "bg-primary/5" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">{b.bill_no}</span>
                      {inCart && <Badge variant="outline" className="text-[10px]">In cart</Badge>}
                      {b.channel && b.channel !== "counter" && (
                        <Badge variant="secondary" className="text-[10px]">{HELD_CHANNEL_LABELS[b.channel] ?? b.channel}</Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.customer_name || "Walk-in"}{b.customer_phone ? ` · ${b.customer_phone}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {qty} item{qty === 1 ? "" : "s"} · {new Date(b.updated_at || b.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      {b.note ? ` · ${b.note}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">৳ {Number(b.total).toFixed(2)}</div>
                    <div className="mt-1 flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        title="Remove from hold"
                        disabled={discardHeld.isPending || inCart}
                        onClick={() => discardHeld.mutate(b)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button size="sm" disabled={resumeHeld.isPending} onClick={() => resumeHeld.mutate(b)}>
                        {inCart ? "Open" : "Resume"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button variant="link" asChild className="px-0 text-xs">
              <Link to="/pending-bills">Full pending bills page</Link>
            </Button>
            <Button variant="outline" onClick={() => setHeldOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newCustOpen} onOpenChange={setNewCustOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input autoFocus value={newCustName} onChange={(e) => setNewCustName(e.target.value)} placeholder="Customer full name" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["male", "female"] as const).map((g) => (
                  <Button
                    key={g}
                    type="button"
                    variant={newCustGender === g ? "default" : "outline"}
                    onClick={() => setNewCustGender(newCustGender === g ? "" : g)}
                    className="capitalize"
                  >
                    {g}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCustOpen(false)}>Cancel</Button>
            <Button disabled={createCustomer.isPending || !newCustName.trim()} onClick={() => createCustomer.mutate()}>
              {createCustomer.isPending ? "Saving..." : "Save customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
