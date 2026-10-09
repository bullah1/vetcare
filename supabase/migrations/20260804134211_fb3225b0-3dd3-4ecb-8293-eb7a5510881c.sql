CREATE OR REPLACE FUNCTION public.create_return(_sale_id uuid, _items jsonb, _reason text DEFAULT NULL::text, _refund_method payment_method DEFAULT NULL::payment_method, _restock boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.sale_returns(sale_id, return_no, reason, refund_method, refund_amount, restock, processed_by)
  VALUES (_sale_id, _return_no, _reason, _refund_method, 0, COALESCE(_restock, true), auth.uid())
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

  IF _refund_method IS NOT NULL AND _refund_total > 0 THEN
    INSERT INTO public.payments(sale_id, method, amount, reference)
    VALUES (_sale_id, _refund_method, -_refund_total, 'Refund ' || _return_no);
  END IF;

  UPDATE public.sales
    SET total = GREATEST(total - _refund_total, 0),
        paid = CASE WHEN _refund_method IS NOT NULL THEN GREATEST(paid - _refund_total, 0) ELSE paid END,
        due  = GREATEST(GREATEST(total - _refund_total, 0) -
                        CASE WHEN _refund_method IS NOT NULL THEN GREATEST(paid - _refund_total, 0) ELSE paid END, 0),
        status = CASE
          WHEN (SELECT SUM(quantity - returned_quantity) FROM public.sale_items WHERE sale_id = _sale_id) <= 0
          THEN 'refunded'::sale_status ELSE 'partial_refund'::sale_status END
    WHERE id = _sale_id;

  RETURN jsonb_build_object('return_id', _return_id, 'return_no', _return_no, 'refund_amount', _refund_total);
END;
$$;

REVOKE ALL ON FUNCTION public.create_return(uuid, jsonb, text, payment_method, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_return(uuid, jsonb, text, payment_method, boolean) TO authenticated;