-- Purchase costing. Safe to run more than once.
--  1. Bulk / Mixed products: a purchase records the amount only, stock is not
--     added (mini packs are made from them and stocked by hand).
--     Any purchase line can also be marked "no stock".
--  2. Purchase courier / freight is split over the lines by amount %, so each
--     product's cost includes it (landed cost).
--  3. Weighted average cost: stock already on the shelf keeps its cost —
--     new cost = (old stock × old cost + new qty × new cost) ÷ total stock.
--     Edit / return / delete of a purchase takes it back out the same way.
--  4. Every automatic cost change is kept in product_cost_history.
-- Sales keep the cost they were made at, so old profit never changes.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS no_stock boolean NOT NULL DEFAULT false;
-- Stock set by hand for mini packs made from bulk goods.
ALTER TYPE public.stock_adjustment_reason ADD VALUE IF NOT EXISTS 'repack';
ALTER TABLE public.purchase_invoice_items ADD COLUMN IF NOT EXISTS no_stock boolean NOT NULL DEFAULT false;
ALTER TABLE public.purchase_invoice_items ADD COLUMN IF NOT EXISTS freight_share numeric NOT NULL DEFAULT 0;
-- Unit cost with its freight share (what the stock cost us).
ALTER TABLE public.purchase_invoice_items ADD COLUMN IF NOT EXISTS landed_cost numeric;

CREATE TABLE IF NOT EXISTS public.product_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_cost numeric,
  new_cost numeric NOT NULL,
  quantity numeric,
  unit_cost numeric,
  source text NOT NULL,            -- purchase / purchase_edit / purchase_return / purchase_delete / stock_in
  ref_no text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_cost_history_product_idx ON public.product_cost_history (product_id, created_at DESC);
ALTER TABLE public.product_cost_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_cost_history FROM anon;
GRANT SELECT ON public.product_cost_history TO authenticated;
GRANT ALL ON public.product_cost_history TO service_role;
DROP POLICY IF EXISTS "cost history read" ON public.product_cost_history;
CREATE POLICY "cost history read" ON public.product_cost_history FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- ---------- helpers ----------
-- Stock comes in at _unit_cost: average it into the product cost, add the stock.
CREATE OR REPLACE FUNCTION public.cost_stock_in(_product_id uuid, _qty numeric, _unit_cost numeric, _source text, _ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p record; _old_qty numeric; _new numeric;
BEGIN
  SELECT stock_quantity, purchase_price INTO _p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  _old_qty := GREATEST(COALESCE(_p.stock_quantity, 0), 0);
  IF _old_qty <= 0 OR COALESCE(_p.purchase_price, 0) <= 0 OR _qty <= 0 THEN
    _new := _unit_cost;
  ELSE
    _new := (_old_qty * _p.purchase_price + _qty * _unit_cost) / (_old_qty + _qty);
  END IF;
  _new := round(_new, 4);
  UPDATE public.products SET stock_quantity = COALESCE(stock_quantity, 0) + _qty, purchase_price = _new WHERE id = _product_id;
  IF _new IS DISTINCT FROM _p.purchase_price THEN
    INSERT INTO public.product_cost_history(product_id, old_cost, new_cost, quantity, unit_cost, source, ref_no)
    VALUES (_product_id, _p.purchase_price, _new, _qty, _unit_cost, _source, _ref);
  END IF;
END; $$;

-- Stock that came in at _unit_cost goes back out: take it out of the average.
CREATE OR REPLACE FUNCTION public.cost_stock_out(_product_id uuid, _qty numeric, _unit_cost numeric, _source text, _ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p record; _left numeric; _new numeric;
BEGIN
  SELECT stock_quantity, purchase_price INTO _p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  _left := COALESCE(_p.stock_quantity, 0) - _qty;
  _new := _p.purchase_price;
  IF _left > 0 AND COALESCE(_p.stock_quantity, 0) > 0 AND _unit_cost IS NOT NULL THEN
    _new := (_p.stock_quantity * _p.purchase_price - _qty * _unit_cost) / _left;
    IF _new IS NULL OR _new <= 0 THEN _new := _p.purchase_price; END IF;  -- never a silly cost
    _new := round(_new, 4);
  END IF;
  UPDATE public.products SET stock_quantity = GREATEST(_left, 0), purchase_price = _new WHERE id = _product_id;
  IF _new IS DISTINCT FROM _p.purchase_price THEN
    INSERT INTO public.product_cost_history(product_id, old_cost, new_cost, quantity, unit_cost, source, ref_no)
    VALUES (_product_id, _p.purchase_price, _new, -_qty, _unit_cost, _source, _ref);
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.cost_stock_in(uuid, numeric, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cost_stock_out(uuid, numeric, numeric, text, text) FROM PUBLIC, anon, authenticated;

-- Lines of a purchase with their freight share, landed cost and "no stock" flag.
-- Freight is split by line amount (amount %).
CREATE OR REPLACE FUNCTION public.purchase_lines(_items jsonb, _freight numeric)
RETURNS TABLE(idx int, product_id uuid, qty numeric, price numeric, disc numeric, line_total numeric,
              share numeric, landed numeric, no_stock boolean, item jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH l AS (
    SELECT (x.ord)::int AS idx, (x.v->>'product_id')::uuid AS product_id,
           (x.v->>'quantity')::numeric AS qty, (x.v->>'purchase_price')::numeric AS price,
           COALESCE((x.v->>'discount')::numeric, 0) AS disc, x.v AS item
    FROM jsonb_array_elements(_items) WITH ORDINALITY AS x(v, ord)
  ), t AS (
    SELECT l.*, l.qty * l.price - l.disc AS line_total, SUM(l.qty * l.price - l.disc) OVER () AS sub FROM l
  )
  SELECT t.idx, t.product_id, t.qty, t.price, t.disc, t.line_total,
         CASE WHEN t.sub > 0 THEN round(COALESCE(_freight, 0) * t.line_total / t.sub, 2) ELSE 0 END,
         CASE WHEN t.qty > 0 THEN (t.line_total + CASE WHEN t.sub > 0 THEN COALESCE(_freight, 0) * t.line_total / t.sub ELSE 0 END) / t.qty ELSE t.price END,
         COALESCE((t.item->>'no_stock')::boolean, false) OR COALESCE((SELECT p.no_stock FROM public.products p WHERE p.id = t.product_id), false),
         t.item
  FROM t ORDER BY t.idx;
$$;
REVOKE ALL ON FUNCTION public.purchase_lines(jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_lines(jsonb, numeric) TO authenticated;

-- ---------- create ----------
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
      line_total, batch_no, expiry_date, batch_id, no_stock, freight_share, landed_cost
    ) VALUES (
      _invoice_id, _l.product_id, COALESCE(_product_name, _l.item->>'name'),
      _l.qty, _l.price, _l.disc, _l.line_total,
      NULLIF(_l.item->>'batch_no',''), NULLIF(_l.item->>'expiry_date','')::date, _batch_id,
      _l.no_stock, _l.share, round(_l.landed, 4)
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

-- ---------- edit ----------
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
      batch_no, expiry_date, batch_id, no_stock, freight_share, landed_cost)
    VALUES (_invoice_id, _l.product_id, COALESCE(_product_name, _l.item->>'name'), _l.qty, _l.price, _l.disc, _l.line_total,
            NULLIF(_l.item->>'batch_no',''), NULLIF(_l.item->>'expiry_date','')::date, _batch_id,
            _l.no_stock, _l.share, round(_l.landed, 4));
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

-- ---------- return ----------
CREATE OR REPLACE FUNCTION public.create_purchase_return(_invoice_id uuid, _items jsonb, _reason text DEFAULT NULL::text, _refund_method payment_method DEFAULT NULL::payment_method, _restock boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    -- "No stock" lines never added stock, so nothing to take back.
    IF NOT _inv_item.no_stock THEN
      PERFORM public.cost_stock_out(_inv_item.product_id, _qty, COALESCE(_inv_item.landed_cost, _inv_item.purchase_price), 'purchase_return', _return_no);
      IF _inv_item.batch_id IS NOT NULL THEN
        UPDATE public.stock_batches
          SET received_quantity = GREATEST(COALESCE(received_quantity, quantity) - _qty, 0)
          WHERE id = _inv_item.batch_id;
      END IF;
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

-- ---------- delete ----------
CREATE OR REPLACE FUNCTION public.delete_purchase_invoice(_invoice_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _item record; _inv record; _bad text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;

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

-- ---------- quick stock-in from Inventory ----------
CREATE OR REPLACE FUNCTION public.record_purchase(_product_id uuid, _supplier_id uuid, _batch_no text, _quantity numeric, _purchase_price numeric, _expiry_date date DEFAULT NULL::date, _notes text DEFAULT NULL::text, _client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  PERFORM public.cost_stock_in(_product_id, _quantity, _purchase_price, 'stock_in', _batch_no);

  RETURN jsonb_build_object('batch_id', _batch_id, 'duplicate', false);
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO _batch_id FROM public.stock_batches WHERE client_request_id = _client_request_id;
  RETURN jsonb_build_object('batch_id', _batch_id, 'duplicate', true);
END;
$function$;

NOTIFY pgrst, 'reload schema';
