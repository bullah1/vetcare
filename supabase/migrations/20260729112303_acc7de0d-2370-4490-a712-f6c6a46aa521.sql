CREATE OR REPLACE FUNCTION public.trg_expenses_cash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.method <> 'cash' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;
  -- Supplier payments and purchase invoices move cash through supplier_payments,
  -- so the accounting expense row must not double-deduct the drawer.
  IF NEW.category IN ('Supplier Payment', 'Purchase') THEN RETURN NEW; END IF;
  IF NEW.purchase_invoice_id IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM public.record_cash_movement(
    CASE WHEN NEW.amount >= 0 THEN 'out' ELSE 'in' END,
    NEW.amount, 'expense', NEW.id, NEW.paid_to,
    COALESCE(NEW.category,'') || CASE WHEN NEW.notes IS NOT NULL THEN ' — '||NEW.notes ELSE '' END,
    auth.uid()
  );
  RETURN NEW;
END;
$$;

DELETE FROM public.cash_movements cm
USING public.expenses e
WHERE cm.source = 'expense'
  AND cm.source_id = e.id
  AND (e.category = 'Purchase' OR e.purchase_invoice_id IS NOT NULL);