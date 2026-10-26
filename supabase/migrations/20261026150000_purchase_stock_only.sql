-- Purchases only bring goods into stock. Money is managed in separate accounts,
-- so a purchase no longer records a payment, moves the cash drawer, or adds to
-- the supplier's due. Safe to run more than once.
--
-- * create_purchase_invoice(..., _stock_only => true): stock + batches + cost /
--   selling price are updated exactly as before; paid = due = 0, no payment row,
--   supplier balance untouched. Invoices are marked stock_only.
-- * create_purchase_return on a stock-only invoice: stock comes back out, no money.
-- * record_purchase (Inventory → quick stock-in): no longer takes cash out.

ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS stock_only boolean NOT NULL DEFAULT false;
-- Also added by the 2026-10-16 purchase fixes; repeated so this runs on its own.
ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS credit_applied numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.stock_batches ADD COLUMN IF NOT EXISTS received_quantity numeric;
COMMENT ON COLUMN public.purchase_invoices.stock_only IS 'Goods received into stock only; no payment / supplier due recorded (accounts kept separately).';

-- The new optional argument needs a fresh function (an overload would be ambiguous).
DROP FUNCTION IF EXISTS public.create_purchase_invoice(uuid, text, date, jsonb, numeric, numeric, numeric, numeric, payment_method, text);
DROP FUNCTION IF EXISTS public.create_purchase_invoice(uuid, text, date, jsonb, numeric, numeric, numeric, numeric, payment_method, text, boolean);

CREATE FUNCTION public.create_purchase_invoice(_supplier_id uuid, _supplier_invoice_no text, _invoice_date date, _items jsonb, _discount numeric DEFAULT 0, _vat numeric DEFAULT 0, _freight numeric DEFAULT 0, _paid numeric DEFAULT 0, _payment_method payment_method DEFAULT 'cash'::payment_method, _notes text DEFAULT NULL::text, _stock_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _invoice_id uuid; _invoice_no text; _item jsonb;
  _subtotal numeric := 0; _line_total numeric; _qty numeric; _price numeric; _line_disc numeric;
  _total numeric; _due numeric; _status text; _batch_id uuid; _product_name text;
  _bal numeric; _credit numeric := 0; _pay numeric;
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

  IF COALESCE(_stock_only, false) THEN
    _pay := 0; _due := 0; _status := 'stock';
  ELSE
    _pay := COALESCE(_paid,0);
    _due := GREATEST(_total - _pay, 0);
    IF _supplier_id IS NOT NULL THEN
      SELECT COALESCE(balance_due,0) INTO _bal FROM public.suppliers WHERE id = _supplier_id FOR UPDATE;
      _credit := LEAST(GREATEST(-COALESCE(_bal,0), 0), _due);
    END IF;
    _status := CASE WHEN _due - _credit <= 0 AND _total > 0 THEN 'paid' ELSE 'posted' END;
  END IF;

  INSERT INTO public.purchase_invoices(
    invoice_no, supplier_invoice_no, supplier_id, invoice_date,
    subtotal, discount, vat, freight, total, paid, due, credit_applied, notes, created_by, status, stock_only
  ) VALUES (
    _invoice_no, _supplier_invoice_no, _supplier_id, COALESCE(_invoice_date, CURRENT_DATE),
    _subtotal, COALESCE(_discount,0), COALESCE(_vat,0), COALESCE(_freight,0),
    _total, _pay + _credit, _due - _credit, _credit, _notes, auth.uid(), _status, COALESCE(_stock_only, false)
  ) RETURNING id INTO _invoice_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    _price := (_item->>'purchase_price')::numeric;
    _line_disc := COALESCE((_item->>'discount')::numeric, 0);
    _line_total := _qty * _price - _line_disc;

    INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, received_quantity, purchase_price, expiry_date, notes)
    VALUES ((_item->>'product_id')::uuid, _supplier_id, NULLIF(_item->>'batch_no',''),
            _qty, _qty, _price, NULLIF(_item->>'expiry_date','')::date, 'Invoice ' || _invoice_no)
    RETURNING id INTO _batch_id;

    UPDATE public.products
      SET stock_quantity = stock_quantity + _qty,
          purchase_price = _price,
          selling_price = CASE WHEN NULLIF(_item->>'new_selling_price','') IS NOT NULL
                               THEN (_item->>'new_selling_price')::numeric ELSE selling_price END
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

  IF _supplier_id IS NOT NULL AND _due > 0 THEN
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) + _due WHERE id = _supplier_id;
  END IF;

  IF _pay > 0 THEN
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, paid_at, created_by)
    VALUES (_supplier_id, _invoice_id, _pay, COALESCE(_payment_method,'cash'),
            'Against ' || _invoice_no, COALESCE(_invoice_date, CURRENT_DATE), auth.uid());
  END IF;

  RETURN jsonb_build_object('invoice_id', _invoice_id, 'invoice_no', _invoice_no,
                            'total', _total, 'paid', _pay + _credit, 'due', _due - _credit,
                            'credit_applied', _credit, 'status', _status, 'stock_only', COALESCE(_stock_only, false));
END;
$function$;

REVOKE ALL ON FUNCTION public.create_purchase_invoice(uuid, text, date, jsonb, numeric, numeric, numeric, numeric, payment_method, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice(uuid, text, date, jsonb, numeric, numeric, numeric, numeric, payment_method, text, boolean) TO authenticated;

-- Return on a stock-only invoice: goods go back, no money and no supplier balance.
CREATE OR REPLACE FUNCTION public.create_purchase_return(_invoice_id uuid, _items jsonb, _reason text DEFAULT NULL::text, _refund_method payment_method DEFAULT NULL::payment_method, _restock boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _return_id uuid; _return_no text; _item jsonb; _inv_item record; _inv record;
  _qty numeric; _line_total numeric; _refund_total numeric := 0;
  _new_total numeric; _new_paid numeric; _new_due numeric; _method payment_method;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  _method := CASE WHEN _inv.stock_only THEN NULL ELSE _refund_method END;
  IF _inv.supplier_id IS NOT NULL AND NOT _inv.stock_only THEN
    PERFORM 1 FROM public.suppliers WHERE id = _inv.supplier_id FOR UPDATE;
  END IF;

  _return_no := public.next_purchase_return_no();
  INSERT INTO public.purchase_returns(return_no, invoice_id, reason, refund_method, refund_amount, restock, processed_by)
  VALUES (_return_no, _invoice_id, _reason, _method, 0, COALESCE(_restock,true), auth.uid())
  RETURNING id INTO _return_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    IF _qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO _inv_item FROM public.purchase_invoice_items
      WHERE id = (_item->>'invoice_item_id')::uuid AND invoice_id = _invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice item not found'; END IF;
    IF _qty > (_inv_item.quantity - _inv_item.returned_quantity) THEN
      RAISE EXCEPTION 'return quantity exceeds remaining for %', _inv_item.name;
    END IF;

    _line_total := round(_qty * (_inv_item.line_total / NULLIF(_inv_item.quantity,0))::numeric, 2);
    _refund_total := _refund_total + _line_total;

    INSERT INTO public.purchase_return_items(return_id, invoice_item_id, product_id, name, quantity, unit_price, line_total)
    VALUES (_return_id, _inv_item.id, _inv_item.product_id, _inv_item.name, _qty, _inv_item.purchase_price, _line_total);

    UPDATE public.purchase_invoice_items SET returned_quantity = returned_quantity + _qty WHERE id = _inv_item.id;
    UPDATE public.products SET stock_quantity = GREATEST(stock_quantity - _qty, 0) WHERE id = _inv_item.product_id;
    IF _inv_item.batch_id IS NOT NULL THEN
      UPDATE public.stock_batches
        SET received_quantity = GREATEST(COALESCE(received_quantity, quantity) - _qty, 0)
        WHERE id = _inv_item.batch_id;
    END IF;
  END LOOP;

  UPDATE public.purchase_returns SET refund_amount = _refund_total WHERE id = _return_id;

  _new_total := GREATEST(_inv.total - _refund_total, 0);
  IF _inv.stock_only THEN
    _new_paid := 0; _new_due := 0;
  ELSIF _method IS NOT NULL THEN
    _new_paid := GREATEST(_inv.paid - _refund_total, 0);
    _new_due := GREATEST(_new_total - _new_paid, 0);
  ELSE
    _new_paid := _inv.paid;
    _new_due := GREATEST(_new_total - _new_paid, 0);
  END IF;

  UPDATE public.purchase_invoices
    SET total = _new_total, paid = _new_paid, due = _new_due,
        status = CASE
          WHEN (SELECT SUM(quantity - returned_quantity) FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id) <= 0
          THEN 'returned' ELSE 'partially_returned' END
    WHERE id = _invoice_id;

  IF NOT _inv.stock_only THEN
    IF _method IS NOT NULL AND _refund_total > 0 THEN
      INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
      VALUES (_inv.supplier_id, _invoice_id, -_refund_total, _method,
              'Refund ' || _return_no, _reason, CURRENT_DATE, auth.uid());
    ELSIF _inv.supplier_id IS NOT NULL AND _refund_total > 0 THEN
      UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) - _refund_total WHERE id = _inv.supplier_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('return_id', _return_id, 'return_no', _return_no, 'refund_amount', _refund_total);
END;
$function$;

-- Inventory quick stock-in: stock only, no cash out.
CREATE OR REPLACE FUNCTION public.record_purchase(_product_id uuid, _supplier_id uuid, _batch_no text, _quantity numeric, _purchase_price numeric, _expiry_date date DEFAULT NULL::date, _notes text DEFAULT NULL::text, _client_request_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _batch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF _client_request_id IS NOT NULL THEN
    SELECT id INTO _batch_id FROM public.stock_batches WHERE client_request_id = _client_request_id;
    IF _batch_id IS NOT NULL THEN
      RETURN jsonb_build_object('batch_id', _batch_id, 'duplicate', true);
    END IF;
  END IF;

  INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, purchase_price, expiry_date, notes, client_request_id)
  VALUES (_product_id, _supplier_id, _batch_no, _quantity, _purchase_price, _expiry_date, _notes, _client_request_id)
  RETURNING id INTO _batch_id;

  UPDATE public.products
    SET stock_quantity = stock_quantity + _quantity,
        purchase_price = _purchase_price
    WHERE id = _product_id;

  RETURN jsonb_build_object('batch_id', _batch_id, 'duplicate', false);
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO _batch_id FROM public.stock_batches WHERE client_request_id = _client_request_id;
  RETURN jsonb_build_object('batch_id', _batch_id, 'duplicate', true);
END;
$function$;

NOTIFY pgrst, 'reload schema';
