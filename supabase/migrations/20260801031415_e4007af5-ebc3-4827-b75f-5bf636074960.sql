CREATE OR REPLACE FUNCTION public.reset_transactions(_keep_dues boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _sales_deleted int := 0;
  _purch_deleted int := 0;
  _products int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  CREATE TEMP TABLE _keep_sales(id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE _keep_pi(id uuid) ON COMMIT DROP;

  IF _keep_dues THEN
    INSERT INTO _keep_sales SELECT id FROM public.sales WHERE due > 0.004 AND status <> 'void';
    INSERT INTO _keep_pi SELECT id FROM public.purchase_invoices WHERE due > 0.004;
  END IF;

  -- ---------- sales side ----------
  DELETE FROM public.sale_return_items sri
    USING public.sale_returns sr
    WHERE sri.return_id = sr.id
      AND sr.sale_id NOT IN (SELECT id FROM _keep_sales);
  DELETE FROM public.sale_returns
    WHERE sale_id NOT IN (SELECT id FROM _keep_sales);
  DELETE FROM public.payments
    WHERE sale_id IS NULL OR sale_id NOT IN (SELECT id FROM _keep_sales);
  DELETE FROM public.sale_items
    WHERE sale_id NOT IN (SELECT id FROM _keep_sales);
  DELETE FROM public.sales
    WHERE id NOT IN (SELECT id FROM _keep_sales);
  GET DIAGNOSTICS _sales_deleted = ROW_COUNT;

  -- ---------- purchase side ----------
  DELETE FROM public.purchase_return_items pri
    USING public.purchase_returns pr
    WHERE pri.return_id = pr.id
      AND pr.invoice_id NOT IN (SELECT id FROM _keep_pi);
  DELETE FROM public.purchase_returns
    WHERE invoice_id NOT IN (SELECT id FROM _keep_pi);
  DELETE FROM public.supplier_payments
    WHERE invoice_id IS NULL OR invoice_id NOT IN (SELECT id FROM _keep_pi);
  DELETE FROM public.purchase_invoice_items
    WHERE invoice_id NOT IN (SELECT id FROM _keep_pi);

  -- expenses: keep only rows tied to preserved purchase invoices
  DELETE FROM public.expenses
    WHERE purchase_invoice_id IS NULL
       OR purchase_invoice_id NOT IN (SELECT id FROM _keep_pi);

  DELETE FROM public.purchase_invoices
    WHERE id NOT IN (SELECT id FROM _keep_pi);
  GET DIAGNOSTICS _purch_deleted = ROW_COUNT;

  -- ---------- stock movement + cash ----------
  DELETE FROM public.stock_adjustments;
  DELETE FROM public.stock_batches;
  DELETE FROM public.cash_movements;
  DELETE FROM public.cash_shifts;

  UPDATE public.products SET stock_quantity = 0 WHERE stock_quantity <> 0;
  GET DIAGNOSTICS _products = ROW_COUNT;

  RETURN jsonb_build_object(
    'sales_deleted', _sales_deleted,
    'purchase_invoices_deleted', _purch_deleted,
    'products_zeroed', _products,
    'kept_due_sales', (SELECT count(*) FROM _keep_sales),
    'kept_due_purchases', (SELECT count(*) FROM _keep_pi)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_transactions(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_transactions(boolean) TO authenticated;