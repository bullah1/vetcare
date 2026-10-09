CREATE OR REPLACE FUNCTION public.recalc_sale_totals(_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _sub numeric; _tax numeric; _disc numeric; _total numeric; _paid numeric; _due numeric;
        _status sale_status; _refunds numeric; _all_returned boolean;
BEGIN
  SELECT COALESCE(discount, 0), status INTO _disc, _status FROM public.sales WHERE id = _sale_id;
  IF _disc IS NULL THEN RETURN NULL; END IF;

  IF _status = 'void' THEN
    RETURN jsonb_build_object('sale_id', _sale_id, 'skipped', true, 'status', _status);
  END IF;

  SELECT COALESCE(SUM(quantity * unit_price - discount), 0), COALESCE(SUM(tax), 0)
    INTO _sub, _tax
  FROM public.sale_items WHERE sale_id = _sale_id;

  SELECT COALESCE(SUM(refund_amount), 0) INTO _refunds
  FROM public.sale_returns WHERE sale_id = _sale_id;

  -- total ALWAYS stays the original gross invoice value; refunds are represented
  -- only through sale_returns + payment reversals, never by shrinking the total.
  _total := GREATEST(_sub + _tax - _disc, 0);

  SELECT COALESCE(SUM(amount), 0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;
  _due := GREATEST(_total - _refunds - _paid, 0);

  SELECT COALESCE(SUM(quantity - returned_quantity), 0) <= 0
    INTO _all_returned FROM public.sale_items WHERE sale_id = _sale_id;

  UPDATE public.sales
     SET subtotal = _sub, tax = _tax, total = _total, paid = _paid, due = _due,
         status = CASE
           WHEN _refunds <= 0 THEN 'completed'::sale_status
           WHEN COALESCE(_all_returned, false) THEN 'refunded'::sale_status
           ELSE 'partial_refund'::sale_status END
   WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'subtotal', _sub, 'tax', _tax,
    'discount', _disc, 'refunds', _refunds, 'total', _total, 'paid', _paid, 'due', _due);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _sale record;
  _it record;
  _refund numeric := 0;
  _pid uuid;
  _refund_method public.payment_method;
  _existing int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF _sale.status = 'void' THEN RAISE EXCEPTION 'sale already cancelled'; END IF;

  FOR _it IN SELECT * FROM public.sale_items WHERE sale_id = _sale_id LOOP
    IF _it.product_id IS NOT NULL AND (_it.quantity - _it.returned_quantity) > 0 THEN
      UPDATE public.products
      SET stock_quantity = stock_quantity + (_it.quantity - _it.returned_quantity)
      WHERE id = _it.product_id;
    END IF;
  END LOOP;

  -- net of every payment already recorded (collections minus earlier refunds)
  SELECT COALESCE(SUM(amount), 0) INTO _refund
  FROM public.payments WHERE sale_id = _sale_id;

  SELECT method INTO _refund_method
  FROM public.payments
  WHERE sale_id = _sale_id AND amount > 0
  ORDER BY received_at DESC
  LIMIT 1;

  -- never create a second cancellation reversal for the same invoice
  SELECT count(*) INTO _existing
  FROM public.payments
  WHERE sale_id = _sale_id AND amount < 0 AND reference = 'Cancelled ' || _sale.invoice_no;

  IF _refund > 0.004 AND _existing = 0 THEN
    INSERT INTO public.payments(sale_id, method, amount, reference)
    VALUES (_sale_id, COALESCE(_refund_method, 'cash'::public.payment_method), -_refund, 'Cancelled ' || _sale.invoice_no)
    RETURNING id INTO _pid;
  ELSE
    _refund := 0;
  END IF;

  INSERT INTO public.sale_returns(
    sale_id, return_no, reason, refund_method, refund_amount, refund_paid, restock, processed_by)
  VALUES (
    _sale_id, public.next_return_no(),
    COALESCE(NULLIF(_reason, ''), 'Sale cancelled'),
    _refund_method, _sale.total, _refund, false, auth.uid());

  UPDATE public.sales
  SET status = 'void', paid = 0, due = 0,
      notes = COALESCE(notes, '') ||
        CASE WHEN _reason IS NOT NULL AND _reason <> '' THEN ' | Cancelled: ' || _reason ELSE ' | Cancelled' END
  WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'refunded', _refund);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.collect_sale_due(_sale_id uuid, _amount numeric, _method payment_method DEFAULT 'cash'::payment_method, _reference text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _sale record; _pay_id uuid; _paid numeric; _due numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF _sale.status IN ('void', 'refunded') THEN
    RAISE EXCEPTION 'cannot collect against a cancelled or fully refunded invoice';
  END IF;
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

  PERFORM public.recalc_sale_totals(_sale_id);
  SELECT paid, due INTO _paid, _due FROM public.sales WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'paid', _paid, 'due', _due, 'payment_id', _pay_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.recalc_sale_totals(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_sale(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.collect_sale_due(uuid, numeric, payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_sale_totals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_sale_due(uuid, numeric, payment_method, text) TO authenticated;