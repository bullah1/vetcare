// Full Audit Logic — cross-checks every money trail against its source rows and
// flags mismatches, duplicates and impossible entries. Pure functions only, so
// the same rules can be reused by any screen or a future scheduled job.

export type AuditSeverity = "error" | "warning";

export type AuditIssue = {
  id: string;
  /** check group key, e.g. "invoice-math" */
  check: string;
  title: string;
  severity: AuditSeverity;
  ref: string;
  detail: string;
  at?: string | null;
  saleId?: string | null;
  diff?: number;
};

export type AuditData = {
  sales: any[];
  saleItems: any[];
  payments: any[];
  returns: any[];
  returnItems: any[];
  products: any[];
  cashMovements: any[];
};

const EPS = 0.05; // paisa-level rounding tolerance
const n = (v: any) => Number(v || 0);
const money = (v: number) => `৳${n(v).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
const near = (a: number, b: number) => Math.abs(a - b) <= EPS;

const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + pick(r), 0);

function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export const CHECK_LABELS: Record<string, string> = {
  "invoice-math": "Invoice total math (subtotal − discount + tax)",
  "line-total": "Line item math vs invoice subtotal",
  "paid-mismatch": "Recorded paid vs actual payment rows",
  "due-mismatch": "Remaining due vs total − paid",
  "duplicate-invoice": "Duplicate invoice numbers",
  "duplicate-payment": "Duplicate / repeated payments",
  "duplicate-return": "Duplicate return numbers",
  "refund-over": "Refund larger than invoice or paid amount",
  "return-qty": "Returned quantity vs sold quantity",
  "orphan-row": "Orphan rows (missing parent invoice)",
  "cash-trail": "Cash movement trail vs payment rows",
  "stock-negative": "Negative or impossible stock",
  "price-sanity": "Selling price below purchase price",
};

export function runAudit(data: AuditData): AuditIssue[] {
  const { sales, saleItems, payments, returns, returnItems, products, cashMovements } = data;
  const issues: AuditIssue[] = [];
  const saleById = new Map<string, any>(sales.map((s) => [s.id, s]));
  const push = (i: AuditIssue) => issues.push(i);
  const refOf = (s: any) => s?.invoice_no || s?.id?.slice(0, 8) || "—";

  // ---- per invoice checks -------------------------------------------------
  const itemsBySale = groupBy(saleItems, (i) => i.sale_id);
  const paysBySale = groupBy(payments.filter((p) => p.sale_id), (p) => p.sale_id as string);
  const retsBySale = groupBy(returns, (r) => r.sale_id);

  for (const s of sales) {
    const expected = n(s.subtotal) - n(s.discount) + n(s.tax);
    if (!near(expected, n(s.total))) {
      push({
        id: `invoice-math-${s.id}`,
        check: "invoice-math",
        title: "Invoice total does not match its own lines",
        severity: "error",
        ref: refOf(s),
        at: s.created_at,
        saleId: s.id,
        diff: n(s.total) - expected,
        detail: `subtotal ${money(s.subtotal)} − discount ${money(s.discount)} + tax ${money(s.tax)} = ${money(expected)}, but stored total is ${money(s.total)}`,
      });
    }

    const items = itemsBySale.get(s.id) ?? [];
    if (items.length) {
      const lineSum = sum(items, (i) => n(i.line_total));
      if (!near(lineSum, n(s.subtotal))) {
        push({
          id: `line-total-${s.id}`,
          check: "line-total",
          title: "Line items do not add up to the invoice subtotal",
          severity: "error",
          ref: refOf(s),
          at: s.created_at,
          saleId: s.id,
          diff: lineSum - n(s.subtotal),
          detail: `${items.length} line(s) total ${money(lineSum)} vs subtotal ${money(s.subtotal)}`,
        });
      }
      for (const i of items) {
        const lineExpected = n(i.quantity) * n(i.unit_price) - n(i.discount) + n(i.tax);
        if (!near(lineExpected, n(i.line_total))) {
          push({
            id: `line-total-item-${i.id}`,
            check: "line-total",
            title: `Line math wrong — ${i.name}`,
            severity: "warning",
            ref: refOf(s),
            at: s.created_at,
            saleId: s.id,
            diff: n(i.line_total) - lineExpected,
            detail: `${i.quantity} × ${money(i.unit_price)} − ${money(i.discount)} + ${money(i.tax)} = ${money(lineExpected)}, stored ${money(i.line_total)}`,
          });
        }
      }
    } else if (s.status !== "void") {
      push({
        id: `orphan-noitems-${s.id}`,
        check: "orphan-row",
        title: "Invoice has no line items",
        severity: "warning",
        ref: refOf(s),
        at: s.created_at,
        saleId: s.id,
        detail: `Invoice of ${money(s.total)} was saved without any product/service row`,
      });
    }

    const pays = paysBySale.get(s.id) ?? [];
    const paidActual = sum(pays, (p) => n(p.amount));
    if (!near(paidActual, n(s.paid))) {
      push({
        id: `paid-${s.id}`,
        check: "paid-mismatch",
        title: "Paid amount does not match payment records",
        severity: "error",
        ref: refOf(s),
        at: s.created_at,
        saleId: s.id,
        diff: n(s.paid) - paidActual,
        detail: `${pays.length} payment row(s) net ${money(paidActual)}, invoice says paid ${money(s.paid)}`,
      });
    }

    // refund never bigger than the invoice, and cash back never bigger than paid
    const rets = retsBySale.get(s.id) ?? [];

    // sales.total is always the ORIGINAL gross invoice value; refunds are held in
    // sale_returns, so the outstanding due is total − refunds − paid.
    const refundsOfSale = sum(rets, (r) => n(r.refund_amount));
    const dueExpected = Math.max(0, n(s.total) - refundsOfSale - n(s.paid));
    if (s.status !== "void" && !near(dueExpected, n(s.due))) {
      push({
        id: `due-${s.id}`,
        check: "due-mismatch",
        title: "Remaining due is out of sync",
        severity: "error",
        ref: refOf(s),
        at: s.created_at,
        saleId: s.id,
        diff: n(s.due) - dueExpected,
        detail: `total ${money(s.total)} − refunds ${money(refundsOfSale)} − paid ${money(s.paid)} = ${money(dueExpected)}, stored due ${money(s.due)}`,
      });
    }

    if (rets.length) {
      const refundTotal = refundsOfSale;
      const grossInvoice = n(s.subtotal) - n(s.discount) + n(s.tax);
      if (refundTotal - grossInvoice > EPS) {

        push({
          id: `refund-over-${s.id}`,
          check: "refund-over",
          title: "Refund exceeds the invoice value",
          severity: "error",
          ref: refOf(s),
          at: rets[0]?.created_at,
          saleId: s.id,
          diff: refundTotal - grossInvoice,
          detail: `refunds ${money(refundTotal)} against invoice value ${money(grossInvoice)}`,
        });
      }
      const cashBack = sum(rets, (r) => n(r.refund_paid));
      const everPaid = sum(pays.filter((p) => n(p.amount) > 0), (p) => n(p.amount));
      if (cashBack - everPaid > EPS) {
        push({
          id: `refund-cash-${s.id}`,
          check: "refund-over",
          title: "Cash refunded is more than the customer ever paid",
          severity: "error",
          ref: refOf(s),
          at: rets[0]?.created_at,
          saleId: s.id,
          diff: cashBack - everPaid,
          detail: `refund paid out ${money(cashBack)} vs received ${money(everPaid)}`,
        });
      }
    }
  }

  // ---- duplicates --------------------------------------------------------
  for (const [inv, rows] of groupBy(sales, (s) => String(s.invoice_no || ""))) {
    if (!inv || rows.length < 2) continue;
    push({
      id: `dup-inv-${inv}`,
      check: "duplicate-invoice",
      title: "Same invoice number used more than once",
      severity: "error",
      ref: inv,
      at: rows[0].created_at,
      saleId: rows[0].id,
      detail: `${rows.length} invoices share this number (${rows.map((r) => money(r.total)).join(", ")})`,
    });
  }

  for (const [no, rows] of groupBy(returns, (r) => String(r.return_no || ""))) {
    if (!no || rows.length < 2) continue;
    push({
      id: `dup-ret-${no}`,
      check: "duplicate-return",
      title: "Same return number used more than once",
      severity: "error",
      ref: no,
      at: rows[0].created_at,
      saleId: rows[0].sale_id,
      detail: `${rows.length} return records share this number`,
    });
  }

  // repeated payment: same invoice, same method, same amount within 2 minutes
  for (const [saleId, rows] of paysBySale) {
    const sorted = [...rows].sort((a, b) => +new Date(a.received_at) - +new Date(b.received_at));
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const gap = Math.abs(+new Date(b.received_at) - +new Date(a.received_at));
      if (near(n(a.amount), n(b.amount)) && a.method === b.method && gap <= 120000 && n(b.amount) !== 0) {
        const s = saleById.get(saleId);
        push({
          id: `dup-pay-${b.id}`,
          check: "duplicate-payment",
          title: "Looks like the same payment was taken twice",
          severity: "warning",
          ref: refOf(s),
          at: b.received_at,
          saleId,
          diff: n(b.amount),
          detail: `two ${b.method} payments of ${money(b.amount)} within ${Math.round(gap / 1000)}s`,
        });
      }
    }
  }

  // ---- return quantities -------------------------------------------------
  const retItemsBySaleItem = groupBy(returnItems.filter((r) => r.sale_item_id), (r) => r.sale_item_id as string);
  const itemById = new Map<string, any>(saleItems.map((i) => [i.id, i]));
  for (const [saleItemId, rows] of retItemsBySaleItem) {
    const item = itemById.get(saleItemId);
    if (!item) {
      push({
        id: `orphan-retitem-${rows[0].id}`,
        check: "orphan-row",
        title: "Return line points to a missing invoice line",
        severity: "warning",
        ref: rows[0].name || "—",
        detail: "return item has no matching sale item row",
      });
      continue;
    }
    const returned = sum(rows, (r) => n(r.quantity));
    const s = saleById.get(item.sale_id);
    if (returned - n(item.quantity) > EPS) {
      push({
        id: `retqty-over-${saleItemId}`,
        check: "return-qty",
        title: `Returned more than sold — ${item.name}`,
        severity: "error",
        ref: refOf(s),
        saleId: item.sale_id,
        diff: returned - n(item.quantity),
        detail: `sold ${item.quantity}, returned ${returned}`,
      });
    }
    if (!near(returned, n(item.returned_quantity))) {
      push({
        id: `retqty-sync-${saleItemId}`,
        check: "return-qty",
        title: `Returned quantity counter out of sync — ${item.name}`,
        severity: "warning",
        ref: refOf(s),
        saleId: item.sale_id,
        diff: n(item.returned_quantity) - returned,
        detail: `return rows total ${returned}, invoice line stores ${n(item.returned_quantity)}`,
      });
    }
  }

  // ---- orphan payments / returns ------------------------------------------
  for (const p of payments) {
    if (p.sale_id && !saleById.has(p.sale_id)) {
      push({
        id: `orphan-pay-${p.id}`,
        check: "orphan-row",
        title: "Payment without an invoice",
        severity: "warning",
        ref: p.reference || p.id.slice(0, 8),
        at: p.received_at,
        diff: n(p.amount),
        detail: `${money(p.amount)} (${p.method}) is linked to an invoice that no longer exists`,
      });
    }
  }
  for (const r of returns) {
    if (!saleById.has(r.sale_id)) {
      push({
        id: `orphan-ret-${r.id}`,
        check: "orphan-row",
        title: "Return without an invoice",
        severity: "warning",
        ref: r.return_no || r.id.slice(0, 8),
        at: r.created_at,
        diff: n(r.refund_amount),
        detail: `refund ${money(r.refund_amount)} has no parent invoice`,
      });
    }
  }

  // ---- cash trail: every sale payment should have a cash movement ---------
  const movBySource = groupBy(cashMovements.filter((m) => m.source_id), (m) => String(m.source_id));
  for (const p of payments) {
    if (n(p.amount) === 0) continue;
    const movs = movBySource.get(p.id) ?? [];
    if (!movs.length) continue; // trail not always written (e.g. due-only rows)
    const movNet = sum(movs, (m) => (m.direction === "out" ? -n(m.amount) : n(m.amount)));
    if (!near(movNet, n(p.amount))) {
      const s = p.sale_id ? saleById.get(p.sale_id) : null;
      push({
        id: `cash-trail-${p.id}`,
        check: "cash-trail",
        title: "Cash trail amount differs from the payment",
        severity: "error",
        ref: s ? refOf(s) : p.reference || p.id.slice(0, 8),
        at: p.received_at,
        saleId: p.sale_id,
        diff: movNet - n(p.amount),
        detail: `payment ${money(p.amount)} vs cash movement ${money(movNet)}`,
      });
    }
    if (movs.length > 1) {
      push({
        id: `cash-dup-${p.id}`,
        check: "duplicate-payment",
        title: "Payment recorded in the cash book more than once",
        severity: "warning",
        ref: p.reference || p.id.slice(0, 8),
        at: p.received_at,
        saleId: p.sale_id,
        detail: `${movs.length} cash movements point to this single payment`,
      });
    }
  }

  // ---- product sanity ----------------------------------------------------
  for (const pr of products) {
    // service items are not stock-tracked, so a 0/negative balance is expected
    if (pr.category !== "service" && n(pr.stock_quantity) < 0) {
      push({
        id: `stock-neg-${pr.id}`,
        check: "stock-negative",
        title: `Negative stock — ${pr.name}`,
        severity: "error",
        ref: pr.sku || pr.barcode || pr.name,
        diff: n(pr.stock_quantity),
        detail: `stock shows ${n(pr.stock_quantity)} — an oversell or a missed purchase entry`,
      });
    }
    if (pr.is_active && n(pr.selling_price) > 0 && n(pr.purchase_price) > n(pr.selling_price) + EPS) {
      push({
        id: `price-${pr.id}`,
        check: "price-sanity",
        title: `Selling below purchase price — ${pr.name}`,
        severity: "warning",
        ref: pr.sku || pr.barcode || pr.name,
        diff: n(pr.selling_price) - n(pr.purchase_price),
        detail: `buy ${money(pr.purchase_price)} > sell ${money(pr.selling_price)}`,
      });
    }
  }

  return issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return +new Date(b.at || 0) - +new Date(a.at || 0);
  });
}

export function summarizeAudit(issues: AuditIssue[]) {
  const byCheck = new Map<string, { errors: number; warnings: number }>();
  for (const i of issues) {
    const cur = byCheck.get(i.check) ?? { errors: 0, warnings: 0 };
    if (i.severity === "error") cur.errors++;
    else cur.warnings++;
    byCheck.set(i.check, cur);
  }
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    byCheck,
  };
}
