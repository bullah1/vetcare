CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  FROM public.payments
  WHERE sale_id = _sale_id;

  SELECT method INTO _refund_method
  FROM public.payments
  WHERE sale_id = _sale_id AND amount > 0
  ORDER BY received_at DESC
  LIMIT 1;

  IF _refund > 0.004 THEN
    INSERT INTO public.payments(sale_id, method, amount, reference)
    VALUES (_sale_id, COALESCE(_refund_method, 'cash'::public.payment_method), -_refund, 'Cancelled ' || _sale.invoice_no)
    RETURNING id INTO _pid;
  END IF;

  INSERT INTO public.sale_returns(
    sale_id, return_no, reason, refund_method, refund_amount,
    restock, processed_by
  )
  VALUES (
    _sale_id,
    public.next_return_no(),
    COALESCE(NULLIF(_reason, ''), 'Sale cancelled'),
    _refund_method,
    _sale.total,
    false,
    auth.uid()
  );

  UPDATE public.sales
  SET status = 'void',
      paid = 0,
      due = 0,
      notes = COALESCE(notes, '') ||
        CASE
          WHEN _reason IS NOT NULL AND _reason <> '' THEN ' | Cancelled: ' || _reason
          ELSE ' | Cancelled'
        END
  WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'refunded', _refund);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text) TO authenticated, service_role;