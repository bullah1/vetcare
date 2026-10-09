CREATE OR REPLACE FUNCTION public.change_payment_method(_payment_id uuid, _method payment_method)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _pay record; _old payment_method; _cashier uuid; _inv text; _totals jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  _old := _pay.method;

  SELECT cashier_id, invoice_no INTO _cashier, _inv FROM public.sales WHERE id = _pay.sale_id;

  -- Converting to "due": drop the payment entirely so the invoice becomes unpaid/partial
  IF _method = 'due' THEN
    DELETE FROM public.cash_movements
      WHERE source_id = _payment_id AND source IN ('sale','refund');
    DELETE FROM public.payments WHERE id = _payment_id;
    _totals := public.recalc_sale_totals(_pay.sale_id);
    RETURN jsonb_build_object('payment_id', _payment_id, 'from', _old, 'method', 'due',
      'changed', true, 'removed', true, 'totals', _totals);
  END IF;

  IF _old = _method THEN
    RETURN jsonb_build_object('payment_id', _payment_id, 'method', _method, 'changed', false,
      'totals', public.recalc_sale_totals(_pay.sale_id));
  END IF;

  UPDATE public.payments SET method = _method WHERE id = _payment_id;

  DELETE FROM public.cash_movements
    WHERE source_id = _payment_id AND source IN ('sale','refund');

  IF _method = 'cash' THEN
    PERFORM public.record_cash_movement(
      CASE WHEN _pay.amount >= 0 THEN 'in' ELSE 'out' END,
      _pay.amount,
      CASE WHEN _pay.amount >= 0 THEN 'sale' ELSE 'refund' END,
      _payment_id,
      COALESCE(_pay.reference, _inv),
      'Payment method corrected',
      COALESCE(_cashier, auth.uid())
    );
  END IF;

  _totals := public.recalc_sale_totals(_pay.sale_id);

  RETURN jsonb_build_object('payment_id', _payment_id, 'from', _old, 'method', _method,
    'changed', true, 'totals', _totals);
END;
$function$;