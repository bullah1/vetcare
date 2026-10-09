CREATE OR REPLACE FUNCTION public.change_payment_method(_payment_id uuid, _method payment_method)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _pay record; _old payment_method; _cashier uuid; _inv text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  _old := _pay.method;
  IF _old = _method THEN
    RETURN jsonb_build_object('payment_id', _payment_id, 'method', _method, 'changed', false);
  END IF;

  SELECT cashier_id, invoice_no INTO _cashier, _inv FROM public.sales WHERE id = _pay.sale_id;

  UPDATE public.payments SET method = _method WHERE id = _payment_id;

  IF _old = 'cash' THEN
    DELETE FROM public.cash_movements
      WHERE source_id = _payment_id AND source IN ('sale','refund');
  END IF;

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

  RETURN jsonb_build_object('payment_id', _payment_id, 'from', _old, 'method', _method, 'changed', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.change_payment_method(uuid, payment_method) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_payment_method(uuid, payment_method) TO authenticated;