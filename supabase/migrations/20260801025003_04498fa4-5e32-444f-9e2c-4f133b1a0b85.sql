ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0;

UPDATE public.sale_items si
SET cost_price = COALESCE(p.purchase_price, 0)
FROM public.products p
WHERE si.product_id = p.id AND si.cost_price = 0;

CREATE OR REPLACE FUNCTION public.create_sale(_owner_id uuid, _items jsonb, _payments jsonb, _discount numeric DEFAULT 0, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sale_id uuid;
  _invoice text;
  _subtotal numeric := 0;
  _tax_total numeric := 0;
  _line_total numeric;
  _total numeric;
  _paid numeric := 0;
  _item jsonb;
  _pay jsonb;
  _cost numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _invoice := public.next_invoice_no();

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _line_total := (_item->>'quantity')::numeric * (_item->>'unit_price')::numeric
                 - COALESCE((_item->>'discount')::numeric, 0)
                 + COALESCE((_item->>'tax')::numeric, 0);
    _subtotal := _subtotal + ((_item->>'quantity')::numeric * (_item->>'unit_price')::numeric)
                           - COALESCE((_item->>'discount')::numeric, 0);
    _tax_total := _tax_total + COALESCE((_item->>'tax')::numeric, 0);
  END LOOP;

  _total := _subtotal + _tax_total - COALESCE(_discount,0);

  FOR _pay IN SELECT * FROM jsonb_array_elements(_payments) LOOP
    _paid := _paid + (_pay->>'amount')::numeric;
  END LOOP;

  INSERT INTO public.sales(invoice_no, owner_id, cashier_id, subtotal, discount, tax, total, paid, due, status, notes)
  VALUES (_invoice, _owner_id, auth.uid(), _subtotal, COALESCE(_discount,0), _tax_total, _total, _paid, GREATEST(_total - _paid, 0), 'completed', _notes)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _line_total := (_item->>'quantity')::numeric * (_item->>'unit_price')::numeric
                 - COALESCE((_item->>'discount')::numeric, 0)
                 + COALESCE((_item->>'tax')::numeric, 0);

    _cost := 0;
    IF NULLIF(_item->>'product_id','') IS NOT NULL THEN
      SELECT COALESCE(purchase_price,0) INTO _cost FROM public.products WHERE id = (_item->>'product_id')::uuid;
    END IF;

    INSERT INTO public.sale_items(sale_id, product_id, name, quantity, unit_price, discount, tax, line_total, cost_price)
    VALUES (_sale_id,
            NULLIF(_item->>'product_id','')::uuid,
            _item->>'name',
            (_item->>'quantity')::numeric,
            (_item->>'unit_price')::numeric,
            COALESCE((_item->>'discount')::numeric, 0),
            COALESCE((_item->>'tax')::numeric, 0),
            _line_total,
            COALESCE(_cost,0));

    IF NULLIF(_item->>'product_id','') IS NOT NULL THEN
      UPDATE public.products
      SET stock_quantity = stock_quantity - (_item->>'quantity')::numeric
      WHERE id = (_item->>'product_id')::uuid;
    END IF;
  END LOOP;

  FOR _pay IN SELECT * FROM jsonb_array_elements(_payments) LOOP
    IF (_pay->>'amount')::numeric > 0 THEN
      INSERT INTO public.payments(sale_id, method, amount, reference)
      VALUES (_sale_id, (_pay->>'method')::payment_method, (_pay->>'amount')::numeric, _pay->>'reference');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sale_id', _sale_id, 'invoice_no', _invoice, 'total', _total, 'paid', _paid, 'due', GREATEST(_total - _paid, 0));
END;
$function$;