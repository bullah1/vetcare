ALTER TABLE public.sale_returns ADD COLUMN IF NOT EXISTS refund_paid numeric NOT NULL DEFAULT 0;

UPDATE public.sale_returns r
SET refund_paid = COALESCE((
  SELECT LEAST(r.refund_amount, ABS(SUM(p.amount)))
  FROM public.payments p
  WHERE p.sale_id = r.sale_id AND p.amount < 0
    AND (p.reference = 'Refund ' || r.return_no OR p.reference LIKE 'Cancelled %')
), 0)
WHERE r.refund_paid = 0;

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

  _total := GREATEST(_sub + _tax - _disc - _refunds, 0);

  SELECT COALESCE(SUM(amount), 0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;
  _due := GREATEST(_total - _paid, 0);

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

CREATE OR REPLACE FUNCTION public.create_return(
  _sale_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL::text,
  _refund_method payment_method DEFAULT NULL::payment_method,
  _restock boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _return_id uuid;
  _return_no text;
  _item jsonb;
  _sale_item record;
  _qty numeric;
  _line_total numeric;
  _refund_total numeric := 0;
  _gross numeric;
  _bill_discount numeric;
  _factor numeric := 1;
  _net_paid numeric := 0;
  _net_total numeric := 0;
  _cash_back numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'no items to return'; END IF;

  SELECT COALESCE(SUM(line_total),0) INTO _gross FROM public.sale_items WHERE sale_id = _sale_id;
  SELECT COALESCE(discount,0) INTO _bill_discount FROM public.sales WHERE id = _sale_id;
  IF _gross > 0 AND _bill_discount > 0 THEN
    _factor := GREATEST(0, 1 - (_bill_discount / _gross));
  END IF;

  _return_no := public.next_return_no();

  INSERT INTO public.sale_returns(sale_id, return_no, reason, refund_method, refund_amount, refund_paid, restock, processed_by)
  VALUES (_sale_id, _return_no, _reason, _refund_method, 0, 0, COALESCE(_restock, true), auth.uid())
  RETURNING id INTO _return_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    IF _qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO _sale_item
    FROM public.sale_items
    WHERE id = (_item->>'sale_item_id')::uuid AND sale_id = _sale_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'sale item not found'; END IF;
    IF _qty > (_sale_item.quantity - _sale_item.returned_quantity) THEN
      RAISE EXCEPTION 'return quantity exceeds remaining for %', _sale_item.name;
    END IF;

    _line_total := round(_qty * (_sale_item.line_total / NULLIF(_sale_item.quantity,0))::numeric * _factor, 2);
    _refund_total := _refund_total + _line_total;

    INSERT INTO public.sale_return_items(return_id, sale_item_id, product_id, name, quantity, unit_price, line_total)
    VALUES (_return_id, _sale_item.id, _sale_item.product_id, _sale_item.name, _qty,
            round((_sale_item.line_total / NULLIF(_sale_item.quantity,0))::numeric * _factor, 2), _line_total);

    UPDATE public.sale_items
      SET returned_quantity = returned_quantity + _qty
      WHERE id = _sale_item.id;

    IF COALESCE(_restock, true) AND _sale_item.product_id IS NOT NULL THEN
      UPDATE public.products
        SET stock_quantity = stock_quantity + _qty
        WHERE id = _sale_item.product_id;
    END IF;
  END LOOP;

  UPDATE public.sale_returns SET refund_amount = _refund_total WHERE id = _return_id;

  SELECT COALESCE(SUM(amount), 0) INTO _net_paid FROM public.payments WHERE sale_id = _sale_id;
  SELECT GREATEST(COALESCE(SUM(quantity * unit_price - discount), 0) + COALESCE(SUM(tax), 0) - _bill_discount
                  - COALESCE((SELECT SUM(refund_amount) FROM public.sale_returns WHERE sale_id = _sale_id), 0), 0)
    INTO _net_total FROM public.sale_items WHERE sale_id = _sale_id;

  _cash_back := LEAST(_refund_total, GREATEST(_net_paid - _net_total, 0));

  IF _refund_method IS NOT NULL AND _cash_back > 0.004 THEN
    INSERT INTO public.payments(sale_id, method, amount, reference)
    VALUES (_sale_id, _refund_method, -_cash_back, 'Refund ' || _return_no);
    UPDATE public.sale_returns SET refund_paid = _cash_back WHERE id = _return_id;
  ELSE
    _cash_back := 0;
  END IF;

  PERFORM public.recalc_sale_totals(_sale_id);

  RETURN jsonb_build_object('return_id', _return_id, 'return_no', _return_no,
    'refund_amount', _refund_total, 'refund_paid', _cash_back);
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

  SELECT COALESCE(SUM(amount), 0) INTO _refund
  FROM public.payments WHERE sale_id = _sale_id;

  SELECT method INTO _refund_method
  FROM public.payments
  WHERE sale_id = _sale_id AND amount > 0
  ORDER BY received_at DESC
  LIMIT 1;

  IF _refund > 0.004 THEN
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

DO $do$
DECLARE _id uuid;
BEGIN
  FOR _id IN SELECT id FROM public.sales WHERE status <> 'void' LOOP
    PERFORM public.recalc_sale_totals(_id);
  END LOOP;
END
$do$;

REVOKE ALL ON FUNCTION public.recalc_sale_totals(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_return(uuid, jsonb, text, payment_method, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_sale_totals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_return(uuid, jsonb, text, payment_method, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text) TO authenticated;