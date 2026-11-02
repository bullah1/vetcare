-- Purchases:
--  1. Courier per product: a line can carry its own courier amount (e.g. heavy
--     cat litter). The rest of the courier total is split over the other lines
--     by amount %, as before. Lines' own amounts can't be more than the total.
--  2. A purchase can be edited or deleted only on the day it was entered
--     (Dhaka date). After that, use Return.
-- Needs the purchase costing SQL. Safe to run more than once.

ALTER TABLE public.purchase_invoice_items ADD COLUMN IF NOT EXISTS freight_fixed numeric;

DROP FUNCTION IF EXISTS public.purchase_lines(jsonb, numeric);
CREATE FUNCTION public.purchase_lines(_items jsonb, _freight numeric)
RETURNS TABLE(idx int, product_id uuid, qty numeric, price numeric, disc numeric, line_total numeric,
              share numeric, landed numeric, no_stock boolean, item jsonb, fixed numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE _fixed numeric; _auto_sub numeric; _rest numeric; _neg boolean;
BEGIN
  SELECT COALESCE(SUM(l.fixed), 0), COALESCE(SUM(l.lt) FILTER (WHERE l.fixed IS NULL), 0), COALESCE(bool_or(l.fixed < 0), false)
    INTO _fixed, _auto_sub, _neg
  FROM (
    SELECT (x->>'quantity')::numeric * (x->>'purchase_price')::numeric - COALESCE((x->>'discount')::numeric, 0) AS lt,
           NULLIF(btrim(COALESCE(x->>'freight', '')), '')::numeric AS fixed
    FROM jsonb_array_elements(_items) AS x
  ) l;
  IF _neg THEN RAISE EXCEPTION 'Courier on a line cannot be below 0.'; END IF;
  IF _fixed > COALESCE(_freight, 0) + 0.005 THEN
    RAISE EXCEPTION 'Courier on the lines (%) is more than the courier total (%).', round(_fixed, 2), round(COALESCE(_freight, 0), 2);
  END IF;
  _rest := GREATEST(COALESCE(_freight, 0) - _fixed, 0);

  RETURN QUERY
  WITH t AS (
    SELECT (x.ord)::int AS idx, (x.v->>'product_id')::uuid AS product_id,
           (x.v->>'quantity')::numeric AS qty, (x.v->>'purchase_price')::numeric AS price,
           COALESCE((x.v->>'discount')::numeric, 0) AS disc,
           (x.v->>'quantity')::numeric * (x.v->>'purchase_price')::numeric - COALESCE((x.v->>'discount')::numeric, 0) AS line_total,
           NULLIF(btrim(COALESCE(x.v->>'freight', '')), '')::numeric AS fixed, x.v AS item
    FROM jsonb_array_elements(_items) WITH ORDINALITY AS x(v, ord)
  ), s AS (
    SELECT t.*, CASE WHEN t.fixed IS NOT NULL THEN t.fixed WHEN _auto_sub > 0 THEN _rest * t.line_total / _auto_sub ELSE 0 END AS sh FROM t
  )
  SELECT s.idx, s.product_id, s.qty, s.price, s.disc, s.line_total, round(s.sh, 2),
         CASE WHEN s.qty > 0 THEN (s.line_total + s.sh) / s.qty ELSE s.price END,
         COALESCE((s.item->>'no_stock')::boolean, false) OR COALESCE((SELECT p.no_stock FROM public.products p WHERE p.id = s.product_id), false),
         s.item, s.fixed
  FROM s ORDER BY s.idx;
END; $$;
REVOKE ALL ON FUNCTION public.purchase_lines(jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_lines(jsonb, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_purchase_invoice(_supplier_id uuid, _supplier_invoice_no text, _invoice_date date, _items jsonb, _discount numeric DEFAULT 0, _vat numeric DEFAULT 0, _freight numeric DEFAULT 0, _paid numeric DEFAULT 0, _payment_method payment_method DEFAULT 'cash'::payment_method, _notes text DEFAULT NULL::text, _stock_only boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _invoice_id uuid; _invoice_no text; _l record;
  _subtotal numeric := 0; _total numeric; _due numeric; _status text; _batch_id uuid; _product_name text;
  _bal numeric; _credit numeric := 0; _pay numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  _invoice_no := public.next_purchase_invoice_no();
  SELECT COALESCE(SUM(line_total), 0) INTO _subtotal FROM public.purchase_lines(_items, _freight);
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

  FOR _l IN SELECT * FROM public.purchase_lines(_items, _freight) LOOP
    IF _l.qty IS NULL OR _l.qty <= 0 THEN RAISE EXCEPTION 'quantity must be above 0'; END IF;
    _batch_id := NULL;
    IF _l.no_stock THEN
      -- Amount only. The bulk product's cost shows the latest landed cost.
      UPDATE public.products SET purchase_price = round(_l.landed, 4) WHERE id = _l.product_id;
    ELSE
      INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, received_quantity, purchase_price, expiry_date, notes)
      VALUES (_l.product_id, _supplier_id, NULLIF(_l.item->>'batch_no',''), _l.qty, _l.qty, round(_l.landed, 4),
              NULLIF(_l.item->>'expiry_date','')::date, 'Invoice ' || _invoice_no)
      RETURNING id INTO _batch_id;
      PERFORM public.cost_stock_in(_l.product_id, _l.qty, _l.landed, 'purchase', _invoice_no);
    END IF;
    UPDATE public.products
      SET selling_price = CASE WHEN NULLIF(_l.item->>'new_selling_price','') IS NOT NULL
                               THEN (_l.item->>'new_selling_price')::numeric ELSE selling_price END
      WHERE id = _l.product_id
      RETURNING name INTO _product_name;

    INSERT INTO public.purchase_invoice_items(
      invoice_id, product_id, name, quantity, purchase_price, discount,
      line_total, batch_no, expiry_date, batch_id, no_stock, freight_share, landed_cost, freight_fixed
    ) VALUES (
      _invoice_id, _l.product_id, COALESCE(_product_name, _l.item->>'name'),
      _l.qty, _l.price, _l.disc, _l.line_total,
      NULLIF(_l.item->>'batch_no',''), NULLIF(_l.item->>'expiry_date','')::date, _batch_id,
      _l.no_stock, _l.share, round(_l.landed, 4), _l.fixed
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

CREATE OR REPLACE FUNCTION public.update_purchase_invoice(
  _invoice_id uuid, _supplier_id uuid, _supplier_invoice_no text, _invoice_date date, _items jsonb,
  _discount numeric DEFAULT 0, _vat numeric DEFAULT 0, _freight numeric DEFAULT 0, _notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _inv record; _old record; _l record; _bad text;
  _subtotal numeric := 0; _total numeric; _due numeric; _status text; _batch_id uuid; _product_name text; _stock_only boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only an admin can edit a purchase'; END IF;
  IF jsonb_array_length(COALESCE(_items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  -- Edit / delete only on the day the purchase was entered (Dhaka time); after that use Return.
  IF (_inv.created_at AT TIME ZONE 'Asia/Dhaka')::date <> (now() AT TIME ZONE 'Asia/Dhaka')::date THEN
    RAISE EXCEPTION 'A purchase can be %ed only on the day it was entered (%). Use Return instead.', 'edit',
      to_char(_inv.created_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY');
  END IF;
  _stock_only := COALESCE(_inv.stock_only, false);

  IF EXISTS (SELECT 1 FROM public.purchase_returns WHERE invoice_id = _invoice_id)
     OR EXISTS (SELECT 1 FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id AND returned_quantity > 0) THEN
    RAISE EXCEPTION 'This purchase has a return, so it cannot be edited.';
  END IF;

  -- Stock after the change must not go below zero ("no stock" lines never touch stock).
  SELECT string_agg(p.name, ', ') INTO _bad
  FROM (
    SELECT pid, SUM(q) AS delta FROM (
      SELECT product_id AS pid, -quantity AS q FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id AND NOT no_stock
      UNION ALL
      SELECT product_id, qty FROM public.purchase_lines(_items, _freight) WHERE NOT no_stock
    ) t GROUP BY pid
  ) d JOIN public.products p ON p.id = d.pid
  WHERE COALESCE(p.stock_quantity, 0) + d.delta < 0;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot lower % that much: some of that stock is already sold.', _bad;
  END IF;

  -- Take the old lines out (stock, average cost, batches).
  FOR _old IN SELECT * FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id LOOP
    IF NOT _old.no_stock THEN
      PERFORM public.cost_stock_out(_old.product_id, _old.quantity, COALESCE(_old.landed_cost, _old.purchase_price), 'purchase_edit', _inv.invoice_no);
    END IF;
    IF _old.batch_id IS NOT NULL THEN DELETE FROM public.stock_batches WHERE id = _old.batch_id; END IF;
  END LOOP;
  DELETE FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id;

  IF NOT _stock_only AND _inv.supplier_id IS NOT NULL AND _inv.due > 0 THEN
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) - _inv.due WHERE id = _inv.supplier_id;
  END IF;

  -- New lines, same as a new purchase.
  FOR _l IN SELECT * FROM public.purchase_lines(_items, _freight) LOOP
    IF _l.qty IS NULL OR _l.qty <= 0 THEN RAISE EXCEPTION 'quantity must be above 0'; END IF;
    _subtotal := _subtotal + _l.line_total;
    _batch_id := NULL;
    IF _l.no_stock THEN
      UPDATE public.products SET purchase_price = round(_l.landed, 4) WHERE id = _l.product_id;
    ELSE
      INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, received_quantity, purchase_price, expiry_date, notes)
      VALUES (_l.product_id, _supplier_id, NULLIF(_l.item->>'batch_no',''), _l.qty, _l.qty, round(_l.landed, 4),
              NULLIF(_l.item->>'expiry_date','')::date, 'Invoice ' || _inv.invoice_no)
      RETURNING id INTO _batch_id;
      PERFORM public.cost_stock_in(_l.product_id, _l.qty, _l.landed, 'purchase_edit', _inv.invoice_no);
    END IF;
    UPDATE public.products
      SET selling_price = CASE WHEN NULLIF(_l.item->>'new_selling_price','') IS NOT NULL
                               THEN (_l.item->>'new_selling_price')::numeric ELSE selling_price END
      WHERE id = _l.product_id
      RETURNING name INTO _product_name;
    INSERT INTO public.purchase_invoice_items(invoice_id, product_id, name, quantity, purchase_price, discount, line_total,
      batch_no, expiry_date, batch_id, no_stock, freight_share, landed_cost, freight_fixed)
    VALUES (_invoice_id, _l.product_id, COALESCE(_product_name, _l.item->>'name'), _l.qty, _l.price, _l.disc, _l.line_total,
            NULLIF(_l.item->>'batch_no',''), NULLIF(_l.item->>'expiry_date','')::date, _batch_id,
            _l.no_stock, _l.share, round(_l.landed, 4), _l.fixed);
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

CREATE OR REPLACE FUNCTION public.delete_purchase_invoice(_invoice_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _item record; _inv record; _bad text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  -- Edit / delete only on the day the purchase was entered (Dhaka time); after that use Return.
  IF (_inv.created_at AT TIME ZONE 'Asia/Dhaka')::date <> (now() AT TIME ZONE 'Asia/Dhaka')::date THEN
    RAISE EXCEPTION 'A purchase can be %ed only on the day it was entered (%). Use Return instead.', 'delet',
      to_char(_inv.created_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY');
  END IF;

  -- Stock from this invoice must still be on the shelf ("no stock" lines aside).
  SELECT string_agg(i.name, ', ') INTO _bad
  FROM public.purchase_invoice_items i JOIN public.products p ON p.id = i.product_id
  WHERE i.invoice_id = _invoice_id AND NOT i.no_stock AND (i.quantity - i.returned_quantity) > COALESCE(p.stock_quantity, 0);
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete: stock is lower than this invoice for %. Some of it is already sold — use Return for what is left.', _bad;
  END IF;

  FOR _item IN SELECT * FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id LOOP
    IF NOT _item.no_stock THEN
      PERFORM public.cost_stock_out(_item.product_id, _item.quantity - _item.returned_quantity,
                                    COALESCE(_item.landed_cost, _item.purchase_price), 'purchase_delete', _inv.invoice_no);
    END IF;
    IF _item.batch_id IS NOT NULL THEN
      DELETE FROM public.stock_batches WHERE id = _item.batch_id;
    END IF;
  END LOOP;

  IF _inv.supplier_id IS NOT NULL THEN
    PERFORM 1 FROM public.suppliers WHERE id = _inv.supplier_id FOR UPDATE;
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) - (_inv.due + _inv.paid)
      WHERE id = _inv.supplier_id;
  END IF;

  UPDATE public.supplier_payments
    SET notes = COALESCE(notes || ' — ', '') || 'Invoice ' || _inv.invoice_no || ' deleted; kept as supplier advance',
        invoice_id = NULL
    WHERE invoice_id = _invoice_id;

  DELETE FROM public.expenses WHERE purchase_invoice_id = _invoice_id;
  DELETE FROM public.purchase_invoices WHERE id = _invoice_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
