CREATE OR REPLACE FUNCTION public.collect_sale_due(_sale_id uuid, _amount numeric, _method payment_method DEFAULT 'cash'::payment_method, _reference text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _sale record; _pay_id uuid; _paid numeric; _due numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF _amount > _sale.due + 0.009 THEN
    RAISE EXCEPTION 'amount exceeds due (due: %)', _sale.due;
  END IF;

  INSERT INTO public.payments(sale_id, method, amount, reference)
  VALUES (_sale_id, COALESCE(_method,'cash'), _amount,
          COALESCE(NULLIF(_reference,''), 'Due collection ' || _sale.invoice_no))
  RETURNING id INTO _pay_id;

  IF COALESCE(_method,'cash') = 'cash' THEN
    PERFORM public.record_cash_movement('in', _amount, 'sale', _pay_id,
      _sale.invoice_no, 'Due collection', auth.uid());
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;
  _due := GREATEST(_sale.total - _paid, 0);

  UPDATE public.sales SET paid = _paid, due = _due WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'paid', _paid, 'due', _due, 'payment_id', _pay_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.collect_sale_due(uuid, numeric, payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_sale_due(uuid, numeric, payment_method, text) TO authenticated;