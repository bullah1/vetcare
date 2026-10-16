-- Purchase fixes (safe to run more than once)
-- 1) Paying a supplier "in total" now clears their invoices oldest-first, so
--    invoice dues always match the supplier balance. Money paid beyond all
--    invoices is kept as supplier ADVANCE (balance_due goes below 0).
-- 2) A new invoice for a supplier who holds our advance uses that advance first.
-- 3) A return on an invoice that was already paid keeps the extra as supplier
--    advance instead of losing it.
-- 4) Deleting an invoice keeps its payments (cash drawer history stays right) as
--    supplier advance, and is blocked when some of the stock is already sold.
-- 5) Batch quantities now follow real stock: sold items leave the oldest-expiry
--    batches first, so sold-out batches stop showing as "expiring soon".
-- 6) One-time clean-up: old invoices are marked paid where the supplier was
--    already paid in total.

-- ---------- columns ----------
ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS credit_applied numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.stock_batches ADD COLUMN IF NOT EXISTS received_quantity numeric;
COMMENT ON COLUMN public.suppliers.balance_due IS 'What we owe the supplier. Below 0 = supplier holds our advance / owes us.';
COMMENT ON COLUMN public.purchase_invoices.credit_applied IS 'Part of "paid" that came from supplier advance (no cash moved).';

-- ---------- 5) batch quantities follow stock ----------
CREATE OR REPLACE FUNCTION public.sync_product_batches(_product_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _left numeric; _b record; _q numeric;
BEGIN
  SELECT GREATEST(COALESCE(stock_quantity, 0), 0) INTO _left FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RETURN; END IF;
  -- Items are sold oldest-expiry first, so what is left in stock sits in the
  -- latest-expiry / newest batches. Walk those first.
  FOR _b IN
    SELECT id, quantity, COALESCE(received_quantity, quantity, 0) AS rq
    FROM public.stock_batches
    WHERE product_id = _product_id
    ORDER BY expiry_date DESC NULLS FIRST, received_at DESC, id DESC
  LOOP
    _q := LEAST(GREATEST(_b.rq, 0), _left);
    _left := _left - _q;
    IF _b.quantity IS DISTINCT FROM _q THEN
      UPDATE public.stock_batches SET quantity = _q WHERE id = _b.id;
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_batches_received_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.received_quantity := COALESCE(NEW.received_quantity, NEW.quantity);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_batches_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.sync_product_batches(CASE WHEN TG_OP = 'DELETE' THEN OLD.product_id ELSE NEW.product_id END);
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_products_stock_batches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.sync_product_batches(NEW.id);
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS stock_batches_received_default ON public.stock_batches;
CREATE TRIGGER stock_batches_received_default BEFORE INSERT ON public.stock_batches
  FOR EACH ROW EXECUTE FUNCTION public.trg_batches_received_default();

DROP TRIGGER IF EXISTS stock_batches_sync ON public.stock_batches;
CREATE TRIGGER stock_batches_sync AFTER INSERT OR DELETE OR UPDATE OF received_quantity ON public.stock_batches
  FOR EACH ROW EXECUTE FUNCTION public.trg_batches_sync();

DROP TRIGGER IF EXISTS products_stock_batches_sync ON public.products;
CREATE TRIGGER products_stock_batches_sync AFTER UPDATE OF stock_quantity ON public.products
  FOR EACH ROW WHEN (OLD.stock_quantity IS DISTINCT FROM NEW.stock_quantity)
  EXECUTE FUNCTION public.trg_products_stock_batches();

-- Back-fill: until now a batch was only reduced by purchase returns, so its
-- current quantity is what was received.
UPDATE public.stock_batches SET received_quantity = quantity WHERE received_quantity IS NULL;
DO $$ DECLARE _p uuid; BEGIN
  FOR _p IN SELECT DISTINCT product_id FROM public.stock_batches LOOP
    PERFORM public.sync_product_batches(_p);
  END LOOP;
END $$;

-- ---------- 1) supplier payments ----------
CREATE OR REPLACE FUNCTION public.record_supplier_payment(_supplier_id uuid, _invoice_id uuid, _amount numeric, _method payment_method DEFAULT 'cash'::payment_method, _reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _paid_at date DEFAULT NULL::date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sup uuid; _first uuid; _pay uuid; _left numeric; _a numeric; _inv record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF COALESCE(_amount, 0) <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  _sup := _supplier_id;
  IF _invoice_id IS NOT NULL AND _sup IS NULL THEN
    SELECT supplier_id INTO _sup FROM public.purchase_invoices WHERE id = _invoice_id;
  END IF;

  -- Invoice with no supplier: pay that invoice only.
  IF _sup IS NULL THEN
    IF _invoice_id IS NULL THEN RAISE EXCEPTION 'choose a supplier or an invoice'; END IF;
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
    VALUES (NULL, _invoice_id, _amount, COALESCE(_method,'cash'), _reference, _notes, COALESCE(_paid_at, CURRENT_DATE), auth.uid())
    RETURNING id INTO _first;
    UPDATE public.purchase_invoices
      SET paid = paid + _amount,
          due = GREATEST(due - _amount, 0),
          status = CASE WHEN status IN ('returned','partially_returned') THEN status
                        WHEN due - _amount <= 0 THEN 'paid' ELSE 'posted' END
      WHERE id = _invoice_id;
    RETURN _first;
  END IF;

  PERFORM 1 FROM public.suppliers WHERE id = _sup FOR UPDATE;
  _left := _amount;

  -- The chosen invoice first (if any), then the supplier's other open invoices, oldest first.
  FOR _inv IN
    SELECT id, due FROM public.purchase_invoices
    WHERE supplier_id = _sup AND due > 0
    ORDER BY (id IS NOT DISTINCT FROM _invoice_id) DESC, invoice_date, created_at
    FOR UPDATE
  LOOP
    EXIT WHEN _left <= 0;
    _a := LEAST(_inv.due, _left);
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
    VALUES (_sup, _inv.id, _a, COALESCE(_method,'cash'), _reference, _notes, COALESCE(_paid_at, CURRENT_DATE), auth.uid())
    RETURNING id INTO _pay;
    _first := COALESCE(_first, _pay);
    UPDATE public.purchase_invoices
      SET paid = paid + _a,
          due = GREATEST(due - _a, 0),
          status = CASE WHEN status IN ('returned','partially_returned') THEN status
                        WHEN due - _a <= 0 THEN 'paid' ELSE 'posted' END
      WHERE id = _inv.id;
    _left := _left - _a;
  END LOOP;

  -- Anything beyond the open invoices stays with the supplier as advance.
  IF _left > 0 THEN
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
    VALUES (_sup, NULL, _left, COALESCE(_method,'cash'), _reference,
            COALESCE(_notes || ' — ', '') || 'Advance to supplier', COALESCE(_paid_at, CURRENT_DATE), auth.uid())
    RETURNING id INTO _pay;
    _first := COALESCE(_first, _pay);
  END IF;

  UPDATE public.suppliers SET balance_due = COALESCE(balance_due, 0) - _amount WHERE id = _sup;
  RETURN _first;
END; $$;

-- ---------- 2) new invoice uses supplier advance ----------
CREATE OR REPLACE FUNCTION public.create_purchase_invoice(_supplier_id uuid, _supplier_invoice_no text, _invoice_date date, _items jsonb, _discount numeric DEFAULT 0, _vat numeric DEFAULT 0, _freight numeric DEFAULT 0, _paid numeric DEFAULT 0, _payment_method payment_method DEFAULT 'cash'::payment_method, _notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _invoice_id uuid; _invoice_no text; _item jsonb;
  _subtotal numeric := 0; _line_total numeric; _qty numeric; _price numeric; _line_disc numeric;
  _total numeric; _due numeric; _status text; _batch_id uuid; _product_name text;
  _bal numeric; _credit numeric := 0;
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

  -- Supplier already holds our advance → use it for this invoice (no cash moves).
  IF _supplier_id IS NOT NULL THEN
    SELECT COALESCE(balance_due,0) INTO _bal FROM public.suppliers WHERE id = _supplier_id FOR UPDATE;
    _credit := LEAST(GREATEST(-COALESCE(_bal,0), 0), _due);
  END IF;

  _status := CASE WHEN _due - _credit <= 0 AND _total > 0 THEN 'paid' ELSE 'posted' END;

  INSERT INTO public.purchase_invoices(
    invoice_no, supplier_invoice_no, supplier_id, invoice_date,
    subtotal, discount, vat, freight, total, paid, due, credit_applied, notes, created_by, status
  ) VALUES (
    _invoice_no, _supplier_invoice_no, _supplier_id, COALESCE(_invoice_date, CURRENT_DATE),
    _subtotal, COALESCE(_discount,0), COALESCE(_vat,0), COALESCE(_freight,0),
    _total, COALESCE(_paid,0) + _credit, _due - _credit, _credit, _notes, auth.uid(), _status
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

  IF _supplier_id IS NOT NULL THEN
    -- The full unpaid amount goes on the supplier; any advance used is netted by it.
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) + _due WHERE id = _supplier_id;
  END IF;

  IF COALESCE(_paid,0) > 0 THEN
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, paid_at, created_by)
    VALUES (_supplier_id, _invoice_id, _paid, COALESCE(_payment_method,'cash'),
            'Against ' || _invoice_no, COALESCE(_invoice_date, CURRENT_DATE), auth.uid());
  END IF;

  RETURN jsonb_build_object('invoice_id', _invoice_id, 'invoice_no', _invoice_no,
                            'total', _total, 'paid', COALESCE(_paid,0) + _credit, 'due', _due - _credit,
                            'credit_applied', _credit, 'status', _status);
END;
$function$;

-- ---------- 3) purchase return keeps over-payment as advance ----------
CREATE OR REPLACE FUNCTION public.create_purchase_return(_invoice_id uuid, _items jsonb, _reason text DEFAULT NULL::text, _refund_method payment_method DEFAULT NULL::payment_method, _restock boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _return_id uuid; _return_no text; _item jsonb; _inv_item record; _inv record;
  _qty numeric; _line_total numeric; _refund_total numeric := 0;
  _new_total numeric; _new_paid numeric; _new_due numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF _inv.supplier_id IS NOT NULL THEN
    PERFORM 1 FROM public.suppliers WHERE id = _inv.supplier_id FOR UPDATE;
  END IF;

  _return_no := public.next_purchase_return_no();
  INSERT INTO public.purchase_returns(return_no, invoice_id, reason, refund_method, refund_amount, restock, processed_by)
  VALUES (_return_no, _invoice_id, _reason, _refund_method, 0, COALESCE(_restock,true), auth.uid())
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
  IF _refund_method IS NOT NULL THEN
    -- Supplier gives the money back now.
    _new_paid := GREATEST(_inv.paid - _refund_total, 0);
  ELSE
    _new_paid := _inv.paid;
  END IF;
  _new_due := GREATEST(_new_total - _new_paid, 0);

  UPDATE public.purchase_invoices
    SET total = _new_total, paid = _new_paid, due = _new_due,
        status = CASE
          WHEN (SELECT SUM(quantity - returned_quantity) FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id) <= 0
          THEN 'returned' ELSE 'partially_returned' END
    WHERE id = _invoice_id;

  IF _refund_method IS NOT NULL AND _refund_total > 0 THEN
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
    VALUES (_inv.supplier_id, _invoice_id, -_refund_total, _refund_method,
            'Refund ' || _return_no, _reason, CURRENT_DATE, auth.uid());
  ELSIF _inv.supplier_id IS NOT NULL AND _refund_total > 0 THEN
    -- No cash back: the supplier owes us this. Reduce what we owe; if the
    -- invoice was already paid, the rest stays as advance (balance below 0).
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) - _refund_total WHERE id = _inv.supplier_id;
  END IF;

  RETURN jsonb_build_object('return_id', _return_id, 'return_no', _return_no, 'refund_amount', _refund_total);
END;
$function$;

-- ---------- 4) delete keeps payments as advance ----------
CREATE OR REPLACE FUNCTION public.delete_purchase_invoice(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _item record; _inv record; _stock numeric; _bad text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;

  -- Stock from this invoice must still be on the shelf.
  SELECT string_agg(i.name, ', ') INTO _bad
  FROM public.purchase_invoice_items i JOIN public.products p ON p.id = i.product_id
  WHERE i.invoice_id = _invoice_id AND (i.quantity - i.returned_quantity) > COALESCE(p.stock_quantity, 0);
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete: stock is lower than this invoice for %. Some of it is already sold — use Return for what is left.', _bad;
  END IF;

  FOR _item IN SELECT * FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id LOOP
    UPDATE public.products
      SET stock_quantity = GREATEST(stock_quantity - (_item.quantity - _item.returned_quantity), 0)
      WHERE id = _item.product_id;
    IF _item.batch_id IS NOT NULL THEN
      DELETE FROM public.stock_batches WHERE id = _item.batch_id;
    END IF;
  END LOOP;

  IF _inv.supplier_id IS NOT NULL THEN
    PERFORM 1 FROM public.suppliers WHERE id = _inv.supplier_id FOR UPDATE;
    -- Remove the unpaid part; what was already paid stays with the supplier as advance.
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) - (_inv.due + _inv.paid)
      WHERE id = _inv.supplier_id;
  END IF;

  -- Keep payment records (the cash really moved); just note the invoice is gone.
  UPDATE public.supplier_payments
    SET notes = COALESCE(notes || ' — ', '') || 'Invoice ' || _inv.invoice_no || ' deleted; kept as supplier advance',
        invoice_id = NULL
    WHERE invoice_id = _invoice_id;

  DELETE FROM public.expenses WHERE purchase_invoice_id = _invoice_id;
  DELETE FROM public.purchase_invoices WHERE id = _invoice_id;
END;
$$;

-- ---------- 6) one-time clean-up of old data ----------
-- Suppliers paid "in total" before this fix: their invoices still show due.
-- Mark the oldest invoices paid until invoice dues match the supplier balance.
DO $$
DECLARE _s record; _inv record; _excess numeric; _a numeric;
BEGIN
  FOR _s IN
    SELECT s.id, COALESCE(s.balance_due,0) AS bal, SUM(pi.due) AS inv_due
    FROM public.suppliers s JOIN public.purchase_invoices pi ON pi.supplier_id = s.id AND pi.due > 0
    GROUP BY s.id, s.balance_due
    HAVING SUM(pi.due) > GREATEST(COALESCE(s.balance_due,0), 0) + 0.009
  LOOP
    _excess := _s.inv_due - GREATEST(_s.bal, 0);
    FOR _inv IN SELECT id, due FROM public.purchase_invoices
                WHERE supplier_id = _s.id AND due > 0 ORDER BY invoice_date, created_at LOOP
      EXIT WHEN _excess <= 0;
      _a := LEAST(_inv.due, _excess);
      UPDATE public.purchase_invoices
        SET paid = paid + _a, due = due - _a,
            status = CASE WHEN status IN ('returned','partially_returned') THEN status
                          WHEN due - _a <= 0 THEN 'paid' ELSE 'posted' END,
            notes = COALESCE(notes || E'\n', '') || 'Marked paid from earlier supplier payment'
        WHERE id = _inv.id;
      _excess := _excess - _a;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
