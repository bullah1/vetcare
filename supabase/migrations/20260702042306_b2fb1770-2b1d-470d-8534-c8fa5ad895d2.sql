
-- Invoice number sequence
CREATE SEQUENCE IF NOT EXISTS public.invoice_seq START 1000;
GRANT USAGE ON SEQUENCE public.invoice_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.next_invoice_no()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'INV-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.invoice_seq')::text, 5, '0');
$$;
GRANT EXECUTE ON FUNCTION public.next_invoice_no() TO authenticated;

-- Create sale atomically
CREATE OR REPLACE FUNCTION public.create_sale(
  _owner_id uuid,
  _items jsonb,        -- [{product_id, name, quantity, unit_price, discount, tax}]
  _payments jsonb,     -- [{method, amount, reference}]
  _discount numeric DEFAULT 0,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

    INSERT INTO public.sale_items(sale_id, product_id, name, quantity, unit_price, discount, tax, line_total)
    VALUES (_sale_id,
            NULLIF(_item->>'product_id','')::uuid,
            _item->>'name',
            (_item->>'quantity')::numeric,
            (_item->>'unit_price')::numeric,
            COALESCE((_item->>'discount')::numeric, 0),
            COALESCE((_item->>'tax')::numeric, 0),
            _line_total);

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
$$;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, jsonb, jsonb, numeric, text) TO authenticated;

-- Record purchase (adds stock batch + increments product stock)
CREATE OR REPLACE FUNCTION public.record_purchase(
  _product_id uuid,
  _supplier_id uuid,
  _batch_no text,
  _quantity numeric,
  _purchase_price numeric,
  _expiry_date date DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _batch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, purchase_price, expiry_date, notes)
  VALUES (_product_id, _supplier_id, _batch_no, _quantity, _purchase_price, _expiry_date, _notes)
  RETURNING id INTO _batch_id;

  UPDATE public.products SET stock_quantity = stock_quantity + _quantity, purchase_price = _purchase_price
  WHERE id = _product_id;

  RETURN _batch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_purchase(uuid, uuid, text, numeric, numeric, date, text) TO authenticated;
