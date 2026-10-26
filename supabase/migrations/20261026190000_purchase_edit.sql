-- Edit a purchase invoice (admin). Keeps the same invoice number and replaces its
-- lines in one transaction: stock moves by the difference only, batches are
-- rebuilt, cost / selling price updated like a new purchase. For older invoices
-- that still track supplier due, the due and supplier balance are recalculated
-- (payments already made stay). Safe to run more than once.
-- Not allowed when the invoice has a return, or when lowering a quantity would
-- take stock below zero (that stock is already sold).

CREATE OR REPLACE FUNCTION public.update_purchase_invoice(
  _invoice_id uuid, _supplier_id uuid, _supplier_invoice_no text, _invoice_date date, _items jsonb,
  _discount numeric DEFAULT 0, _vat numeric DEFAULT 0, _freight numeric DEFAULT 0, _notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _inv record; _item jsonb; _old record; _p record; _bad text;
  _subtotal numeric := 0; _qty numeric; _price numeric; _line_disc numeric; _line_total numeric;
  _total numeric; _due numeric; _status text; _batch_id uuid; _product_name text; _stock_only boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only an admin can edit a purchase'; END IF;
  IF jsonb_array_length(COALESCE(_items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  _stock_only := COALESCE(_inv.stock_only, false);

  IF EXISTS (SELECT 1 FROM public.purchase_returns WHERE invoice_id = _invoice_id)
     OR EXISTS (SELECT 1 FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id AND returned_quantity > 0) THEN
    RAISE EXCEPTION 'This purchase has a return, so it cannot be edited.';
  END IF;

  -- Stock after the change must not go below zero.
  SELECT string_agg(p.name, ', ') INTO _bad
  FROM (
    SELECT pid, SUM(q) AS delta FROM (
      SELECT product_id AS pid, -quantity AS q FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id
      UNION ALL
      SELECT (x->>'product_id')::uuid, (x->>'quantity')::numeric FROM jsonb_array_elements(_items) x
    ) t GROUP BY pid
  ) d JOIN public.products p ON p.id = d.pid
  WHERE COALESCE(p.stock_quantity, 0) + d.delta < 0;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot lower % that much: some of that stock is already sold.', _bad;
  END IF;

  -- Take the old lines out (their batches go with them).
  FOR _old IN SELECT * FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id LOOP
    UPDATE public.products SET stock_quantity = stock_quantity - _old.quantity WHERE id = _old.product_id;
    IF _old.batch_id IS NOT NULL THEN DELETE FROM public.stock_batches WHERE id = _old.batch_id; END IF;
  END LOOP;
  DELETE FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id;

  IF NOT _stock_only AND _inv.supplier_id IS NOT NULL AND _inv.due > 0 THEN
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) - _inv.due WHERE id = _inv.supplier_id;
  END IF;

  -- New lines, same as a new purchase.
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    _price := (_item->>'purchase_price')::numeric;
    _line_disc := COALESCE((_item->>'discount')::numeric, 0);
    IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'quantity must be above 0'; END IF;
    _line_total := _qty * _price - _line_disc;
    _subtotal := _subtotal + _line_total;

    INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, received_quantity, purchase_price, expiry_date, notes)
    VALUES ((_item->>'product_id')::uuid, _supplier_id, NULLIF(_item->>'batch_no',''),
            _qty, _qty, _price, NULLIF(_item->>'expiry_date','')::date, 'Invoice ' || _inv.invoice_no)
    RETURNING id INTO _batch_id;

    UPDATE public.products
      SET stock_quantity = stock_quantity + _qty,
          purchase_price = _price,
          selling_price = CASE WHEN NULLIF(_item->>'new_selling_price','') IS NOT NULL
                               THEN (_item->>'new_selling_price')::numeric ELSE selling_price END
      WHERE id = (_item->>'product_id')::uuid
      RETURNING name INTO _product_name;

    INSERT INTO public.purchase_invoice_items(invoice_id, product_id, name, quantity, purchase_price, discount, line_total, batch_no, expiry_date, batch_id)
    VALUES (_invoice_id, (_item->>'product_id')::uuid, COALESCE(_product_name, _item->>'name'), _qty, _price, _line_disc, _line_total,
            NULLIF(_item->>'batch_no',''), NULLIF(_item->>'expiry_date','')::date, _batch_id);
  END LOOP;

  _total := _subtotal - COALESCE(_discount,0) + COALESCE(_vat,0) + COALESCE(_freight,0);
  IF _stock_only THEN
    _due := 0; _status := 'stock';
  ELSE
    _due := GREATEST(_total - _inv.paid, 0);
    _status := CASE WHEN _due <= 0 AND _total > 0 THEN 'paid' ELSE 'posted' END;
    IF _supplier_id IS NOT NULL AND _due > 0 THEN
      UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) + _due WHERE id = _supplier_id;
    END IF;
  END IF;

  UPDATE public.purchase_invoices
    SET supplier_id = _supplier_id, supplier_invoice_no = _supplier_invoice_no,
        invoice_date = COALESCE(_invoice_date, invoice_date),
        subtotal = _subtotal, discount = COALESCE(_discount,0), vat = COALESCE(_vat,0), freight = COALESCE(_freight,0),
        total = _total, due = _due, status = _status, notes = _notes
    WHERE id = _invoice_id;

  RETURN jsonb_build_object('invoice_id', _invoice_id, 'invoice_no', _inv.invoice_no, 'total', _total, 'due', _due, 'status', _status);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_purchase_invoice(uuid, uuid, text, date, jsonb, numeric, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_invoice(uuid, uuid, text, date, jsonb, numeric, numeric, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
