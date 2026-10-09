CREATE OR REPLACE FUNCTION public.recalc_sale_totals(_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _sub numeric; _tax numeric; _disc numeric; _total numeric; _paid numeric; _due numeric; _status sale_status;
BEGIN
  SELECT COALESCE(discount, 0), status INTO _disc, _status FROM public.sales WHERE id = _sale_id;
  IF _disc IS NULL THEN RETURN NULL; END IF;

  -- Voided / refunded invoices keep their recorded amounts untouched
  IF _status IN ('void', 'refunded', 'partial_refund') THEN
    RETURN jsonb_build_object('sale_id', _sale_id, 'skipped', true, 'status', _status);
  END IF;

  SELECT COALESCE(SUM(quantity * unit_price - discount), 0), COALESCE(SUM(tax), 0)
    INTO _sub, _tax
  FROM public.sale_items WHERE sale_id = _sale_id;

  _total := GREATEST(_sub + _tax - _disc, 0);

  SELECT COALESCE(SUM(amount), 0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;
  _due := GREATEST(_total - _paid, 0);

  UPDATE public.sales
     SET subtotal = _sub, tax = _tax, total = _total, paid = _paid, due = _due
   WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'subtotal', _sub, 'tax', _tax,
    'discount', _disc, 'total', _total, 'paid', _paid, 'due', _due);
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_sale_totals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_sale_totals(uuid) TO authenticated, service_role;