CREATE OR REPLACE FUNCTION public.update_sale(_sale_id uuid, _items jsonb DEFAULT '[]'::jsonb, _discount numeric DEFAULT NULL::numeric, _notes text DEFAULT NULL::text, _extra_payment jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sale record;
  _item jsonb;
  _si record;
  _qty numeric; _price numeric; _disc numeric; _tax numeric;
  _line numeric;
  _subtotal numeric := 0;
  _tax_total numeric := 0;
  _total numeric;
  _paid numeric;
  _inv_disc numeric;
  _pay_amt numeric;
  _pay_method payment_method;
  _pay_id uuid;
  _over numeric;
  _refund_method payment_method;
  _refund_id uuid;
  _inv text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  _inv := _sale.invoice_no;

  FOR _item IN SELECT * FROM jsonb_array_elements(COALESCE(_items,'[]'::jsonb)) LOOP
    SELECT * INTO _si FROM public.sale_items
      WHERE id = (_item->>'sale_item_id')::uuid AND sale_id = _sale_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sale item not found'; END IF;

    _qty   := COALESCE((_item->>'quantity')::numeric, _si.quantity);
    _price := COALESCE((_item->>'unit_price')::numeric, _si.unit_price);
    _disc  := COALESCE((_item->>'discount')::numeric, _si.discount);
    _tax   := _si.tax;

    IF _qty < _si.returned_quantity THEN
      RAISE EXCEPTION 'quantity cannot be less than returned quantity for %', _si.name;
    END IF;
    IF _qty < 0 OR _price < 0 OR _disc < 0 THEN RAISE EXCEPTION 'negative values not allowed'; END IF;

    _line := _qty * _price - _disc + _tax;

    IF _si.product_id IS NOT NULL AND _qty <> _si.quantity THEN
      UPDATE public.products
        SET stock_quantity = stock_quantity - (_qty - _si.quantity)
        WHERE id = _si.product_id;
    END IF;

    UPDATE public.sale_items
      SET quantity = _qty, unit_price = _price, discount = _disc, line_total = _line
      WHERE id = _si.id;
  END LOOP;

  SELECT COALESCE(SUM(quantity * unit_price - discount),0), COALESCE(SUM(tax),0)
    INTO _subtotal, _tax_total
    FROM public.sale_items WHERE sale_id = _sale_id;

  _inv_disc := GREATEST(COALESCE(_discount, _sale.discount), 0);
  _total := GREATEST(_subtotal + _tax_total - _inv_disc, 0);

  -- optional extra payment (attributed to the editing user's open shift)
  IF _extra_payment IS NOT NULL THEN
    _pay_amt := COALESCE((_extra_payment->>'amount')::numeric, 0);
    _pay_method := COALESCE((_extra_payment->>'method')::payment_method, 'cash');
    IF _pay_amt <> 0 THEN
      INSERT INTO public.payments(sale_id, method, amount, reference)
      VALUES (_sale_id, _pay_method, _pay_amt, NULLIF(_extra_payment->>'reference',''))
      RETURNING id INTO _pay_id;

      IF _pay_method = 'cash' THEN
        PERFORM public.record_cash_movement(
          CASE WHEN _pay_amt >= 0 THEN 'in' ELSE 'out' END,
          _pay_amt, CASE WHEN _pay_amt >= 0 THEN 'sale' ELSE 'refund' END,
          _pay_id, COALESCE(NULLIF(_extra_payment->>'reference',''), _inv),
          'Sale edit', auth.uid());
      END IF;
    END IF;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;

  -- if the edit lowered the total below what was paid, return the overpayment
  _over := _paid - _total;
  IF _over > 0.004 THEN
    SELECT method INTO _refund_method FROM public.payments
      WHERE sale_id = _sale_id AND amount > 0
      ORDER BY received_at DESC LIMIT 1;
    _refund_method := COALESCE(_refund_method, 'cash');

    INSERT INTO public.payments(sale_id, method, amount, reference)
    VALUES (_sale_id, _refund_method, -_over, 'Edit adjustment ' || _inv)
    RETURNING id INTO _refund_id;

    IF _refund_method = 'cash' THEN
      PERFORM public.record_cash_movement('out', _over, 'refund', _refund_id,
        _inv, 'Sale edit adjustment', auth.uid());
    END IF;

    _paid := _paid - _over;
  END IF;

  UPDATE public.sales
    SET subtotal = _subtotal,
        tax = _tax_total,
        discount = _inv_disc,
        total = _total,
        paid = _paid,
        due = GREATEST(_total - _paid, 0),
        notes = COALESCE(_notes, notes)
    WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'subtotal', _subtotal, 'discount', _inv_disc,
                            'total', _total, 'paid', _paid, 'due', GREATEST(_total - _paid, 0),
                            'refunded', COALESCE(GREATEST(_over,0),0));
END;
$function$;