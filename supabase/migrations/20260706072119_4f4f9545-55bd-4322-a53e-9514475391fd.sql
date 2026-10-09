
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  _supplier_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _method public.payment_method DEFAULT 'cash',
  _reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _paid_at date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pay_id uuid; _sup uuid; _sup_name text; _new_due numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  _sup := _supplier_id;
  IF _invoice_id IS NOT NULL AND _sup IS NULL THEN
    SELECT supplier_id INTO _sup FROM public.purchase_invoices WHERE id = _invoice_id;
  END IF;

  INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
  VALUES (_sup, _invoice_id, _amount, COALESCE(_method,'cash'), _reference, _notes,
          COALESCE(_paid_at, CURRENT_DATE), auth.uid())
  RETURNING id INTO _pay_id;

  IF _invoice_id IS NOT NULL THEN
    UPDATE public.purchase_invoices
      SET paid = paid + _amount,
          due = GREATEST(total - (paid + _amount), 0),
          status = CASE
            WHEN status IN ('returned','partially_returned') THEN status
            WHEN GREATEST(total - (paid + _amount), 0) <= 0 THEN 'paid'
            ELSE 'posted'
          END
      WHERE id = _invoice_id
      RETURNING due INTO _new_due;
  END IF;

  IF _sup IS NOT NULL THEN
    UPDATE public.suppliers SET balance_due = GREATEST(COALESCE(balance_due,0) - _amount, 0)
      WHERE id = _sup RETURNING name INTO _sup_name;
  END IF;

  INSERT INTO public.expenses(category, amount, paid_to, method, notes, expense_date)
  VALUES ('Supplier Payment', _amount, _sup_name, COALESCE(_method,'cash'),
          COALESCE(_reference,'') || CASE WHEN _notes IS NOT NULL THEN ' — ' || _notes ELSE '' END,
          COALESCE(_paid_at, CURRENT_DATE));

  RETURN _pay_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_purchase_invoice(
  _supplier_id uuid,
  _supplier_invoice_no text,
  _invoice_date date,
  _items jsonb,
  _discount numeric DEFAULT 0,
  _vat numeric DEFAULT 0,
  _freight numeric DEFAULT 0,
  _paid numeric DEFAULT 0,
  _payment_method public.payment_method DEFAULT 'cash',
  _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _invoice_id uuid;
  _invoice_no text;
  _item jsonb;
  _subtotal numeric := 0;
  _line_total numeric;
  _qty numeric;
  _price numeric;
  _line_disc numeric;
  _total numeric;
  _due numeric;
  _status text;
  _batch_id uuid;
  _product_name text;
  _supplier_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  _invoice_no := public.next_purchase_invoice_no();

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    _price := (_item->>'purchase_price')::numeric;
    _line_disc := COALESCE((_item->>'discount')::numeric, 0);
    _subtotal := _subtotal + (_qty * _price - _line_disc);
  END LOOP;

  _total := _subtotal - COALESCE(_discount,0) + COALESCE(_vat,0) + COALESCE(_freight,0);
  _due := GREATEST(_total - COALESCE(_paid,0), 0);
  _status := CASE WHEN _due <= 0 AND _total > 0 THEN 'paid' ELSE 'posted' END;

  INSERT INTO public.purchase_invoices(
    invoice_no, supplier_invoice_no, supplier_id, invoice_date,
    subtotal, discount, vat, freight, total, paid, due, notes, created_by, status
  ) VALUES (
    _invoice_no, _supplier_invoice_no, _supplier_id, COALESCE(_invoice_date, CURRENT_DATE),
    _subtotal, COALESCE(_discount,0), COALESCE(_vat,0), COALESCE(_freight,0),
    _total, COALESCE(_paid,0), _due, _notes, auth.uid(), _status
  ) RETURNING id INTO _invoice_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    _price := (_item->>'purchase_price')::numeric;
    _line_disc := COALESCE((_item->>'discount')::numeric, 0);
    _line_total := _qty * _price - _line_disc;

    INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, purchase_price, expiry_date, notes)
    VALUES (
      (_item->>'product_id')::uuid, _supplier_id, NULLIF(_item->>'batch_no',''),
      _qty, _price, NULLIF(_item->>'expiry_date','')::date,
      'Invoice ' || _invoice_no
    ) RETURNING id INTO _batch_id;

    UPDATE public.products
      SET stock_quantity = stock_quantity + _qty,
          purchase_price = _price,
          selling_price = CASE
            WHEN NULLIF(_item->>'new_selling_price','') IS NOT NULL
              THEN (_item->>'new_selling_price')::numeric
            ELSE selling_price
          END
      WHERE id = (_item->>'product_id')::uuid
      RETURNING name INTO _product_name;

    INSERT INTO public.purchase_invoice_items(
      invoice_id, product_id, name, quantity, purchase_price, discount,
      line_total, batch_no, expiry_date, batch_id
    ) VALUES (
      _invoice_id, (_item->>'product_id')::uuid, COALESCE(_product_name, _item->>'name'),
      _qty, _price, _line_disc, _line_total,
      NULLIF(_item->>'batch_no',''), NULLIF(_item->>'expiry_date','')::date, _batch_id
    );
  END LOOP;

  IF _supplier_id IS NOT NULL THEN
    SELECT name INTO _supplier_name FROM public.suppliers WHERE id = _supplier_id;
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) + _due WHERE id = _supplier_id;
  END IF;

  IF _total > 0 THEN
    INSERT INTO public.expenses(category, amount, paid_to, method, notes, purchase_invoice_id, expense_date)
    VALUES (
      'Purchase', _total, _supplier_name, COALESCE(_payment_method,'cash'),
      'Purchase Invoice ' || _invoice_no ||
        CASE WHEN _supplier_invoice_no IS NOT NULL AND _supplier_invoice_no <> ''
          THEN ' (Supplier ref: ' || _supplier_invoice_no || ')' ELSE '' END,
      _invoice_id, COALESCE(_invoice_date, CURRENT_DATE)
    );
  END IF;

  IF COALESCE(_paid,0) > 0 THEN
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, paid_at, created_by)
    VALUES (_supplier_id, _invoice_id, _paid, COALESCE(_payment_method,'cash'),
            'Against ' || _invoice_no, COALESCE(_invoice_date, CURRENT_DATE), auth.uid());
  END IF;

  RETURN jsonb_build_object('invoice_id', _invoice_id, 'invoice_no', _invoice_no,
                            'total', _total, 'paid', _paid, 'due', _due, 'status', _status);
END;
$$;
