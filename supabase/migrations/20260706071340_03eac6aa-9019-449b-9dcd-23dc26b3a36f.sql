
-- Sequences
CREATE SEQUENCE IF NOT EXISTS public.purchase_invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.purchase_return_seq START 1;

-- Purchase invoices
CREATE TABLE public.purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text NOT NULL UNIQUE,
  supplier_invoice_no text,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  vat numeric(12,2) NOT NULL DEFAULT 0,
  freight numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  paid numeric(12,2) NOT NULL DEFAULT 0,
  due numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'posted',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_invoices TO authenticated;
GRANT ALL ON public.purchase_invoices TO service_role;
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff purchase invoices" ON public.purchase_invoices
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_pi_updated BEFORE UPDATE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Purchase invoice items
CREATE TABLE public.purchase_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  name text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  purchase_price numeric(12,2) NOT NULL,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL,
  batch_no text,
  expiry_date date,
  batch_id uuid REFERENCES public.stock_batches(id) ON DELETE SET NULL,
  returned_quantity numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_invoice_items TO authenticated;
GRANT ALL ON public.purchase_invoice_items TO service_role;
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff purchase items" ON public.purchase_invoice_items
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX ON public.purchase_invoice_items(invoice_id);

-- Supplier payments
CREATE TABLE public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  method public.payment_method NOT NULL DEFAULT 'cash',
  reference text,
  notes text,
  paid_at date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_payments TO authenticated;
GRANT ALL ON public.supplier_payments TO service_role;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff supplier payments" ON public.supplier_payments
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX ON public.supplier_payments(supplier_id);
CREATE INDEX ON public.supplier_payments(invoice_id);

-- Purchase returns
CREATE TABLE public.purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  reason text,
  refund_method public.payment_method,
  refund_amount numeric(12,2) NOT NULL DEFAULT 0,
  restock boolean NOT NULL DEFAULT false,
  processed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_returns TO authenticated;
GRANT ALL ON public.purchase_returns TO service_role;
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff purchase returns" ON public.purchase_returns
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.purchase_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  invoice_item_id uuid NOT NULL REFERENCES public.purchase_invoice_items(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  name text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  line_total numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_return_items TO authenticated;
GRANT ALL ON public.purchase_return_items TO service_role;
ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff purchase return items" ON public.purchase_return_items
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Link expense back to purchase invoice (single row per invoice)
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS purchase_invoice_id uuid REFERENCES public.purchase_invoices(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_purchase_invoice_uniq ON public.expenses(purchase_invoice_id) WHERE purchase_invoice_id IS NOT NULL;

-- Next invoice/return numbers
CREATE OR REPLACE FUNCTION public.next_purchase_invoice_no()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 'PI-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.purchase_invoice_seq')::text, 5, '0');
$$;

CREATE OR REPLACE FUNCTION public.next_purchase_return_no()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 'PR-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.purchase_return_seq')::text, 5, '0');
$$;

-- Create purchase invoice (multi-item)
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
  _batch_id uuid;
  _product_name text;
  _supplier_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  _invoice_no := public.next_purchase_invoice_no();

  -- compute subtotal
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    _price := (_item->>'purchase_price')::numeric;
    _line_disc := COALESCE((_item->>'discount')::numeric, 0);
    _subtotal := _subtotal + (_qty * _price - _line_disc);
  END LOOP;

  _total := _subtotal - COALESCE(_discount,0) + COALESCE(_vat,0) + COALESCE(_freight,0);
  _due := GREATEST(_total - COALESCE(_paid,0), 0);

  INSERT INTO public.purchase_invoices(
    invoice_no, supplier_invoice_no, supplier_id, invoice_date,
    subtotal, discount, vat, freight, total, paid, due, notes, created_by, status
  ) VALUES (
    _invoice_no, _supplier_invoice_no, _supplier_id, COALESCE(_invoice_date, CURRENT_DATE),
    _subtotal, COALESCE(_discount,0), COALESCE(_vat,0), COALESCE(_freight,0),
    _total, COALESCE(_paid,0), _due, _notes, auth.uid(), 'posted'
  ) RETURNING id INTO _invoice_id;

  -- items + batches + stock update
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    _price := (_item->>'purchase_price')::numeric;
    _line_disc := COALESCE((_item->>'discount')::numeric, 0);
    _line_total := _qty * _price - _line_disc;

    -- create batch
    INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, purchase_price, expiry_date, notes)
    VALUES (
      (_item->>'product_id')::uuid, _supplier_id, NULLIF(_item->>'batch_no',''),
      _qty, _price, NULLIF(_item->>'expiry_date','')::date,
      'Invoice ' || _invoice_no
    ) RETURNING id INTO _batch_id;

    -- update product stock & cost, optional selling price
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

  -- supplier name for expense
  IF _supplier_id IS NOT NULL THEN
    SELECT name INTO _supplier_name FROM public.suppliers WHERE id = _supplier_id;
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) + _due WHERE id = _supplier_id;
  END IF;

  -- single expense per invoice
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

  -- payment record
  IF COALESCE(_paid,0) > 0 THEN
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, paid_at, created_by)
    VALUES (_supplier_id, _invoice_id, _paid, COALESCE(_payment_method,'cash'),
            'Against ' || _invoice_no, COALESCE(_invoice_date, CURRENT_DATE), auth.uid());
  END IF;

  RETURN jsonb_build_object('invoice_id', _invoice_id, 'invoice_no', _invoice_no,
                            'total', _total, 'paid', _paid, 'due', _due);
END;
$$;

-- Record supplier payment
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  _supplier_id uuid,
  _invoice_id uuid,
  _amount numeric,
  _method public.payment_method DEFAULT 'cash',
  _reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _paid_at date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pay_id uuid; _sup uuid; _new_paid numeric; _total numeric; _sup_name text;
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
          due = GREATEST(total - (paid + _amount), 0)
      WHERE id = _invoice_id
      RETURNING total INTO _total;
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

-- Create purchase return
CREATE OR REPLACE FUNCTION public.create_purchase_return(
  _invoice_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL,
  _refund_method public.payment_method DEFAULT NULL,
  _restock boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _return_id uuid; _return_no text;
  _item jsonb; _inv_item record;
  _qty numeric; _line_total numeric; _refund_total numeric := 0;
  _sup uuid; _sup_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  _return_no := public.next_purchase_return_no();

  INSERT INTO public.purchase_returns(return_no, invoice_id, reason, refund_method, refund_amount, restock, processed_by)
  VALUES (_return_no, _invoice_id, _reason, _refund_method, 0, COALESCE(_restock,true), auth.uid())
  RETURNING id INTO _return_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    IF _qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO _inv_item FROM public.purchase_invoice_items
      WHERE id = (_item->>'invoice_item_id')::uuid AND invoice_id = _invoice_id
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice item not found'; END IF;
    IF _qty > (_inv_item.quantity - _inv_item.returned_quantity) THEN
      RAISE EXCEPTION 'return quantity exceeds remaining for %', _inv_item.name;
    END IF;

    _line_total := round(_qty * (_inv_item.line_total / NULLIF(_inv_item.quantity,0))::numeric, 2);
    _refund_total := _refund_total + _line_total;

    INSERT INTO public.purchase_return_items(return_id, invoice_item_id, product_id, name, quantity, unit_price, line_total)
    VALUES (_return_id, _inv_item.id, _inv_item.product_id, _inv_item.name, _qty, _inv_item.purchase_price, _line_total);

    UPDATE public.purchase_invoice_items SET returned_quantity = returned_quantity + _qty
      WHERE id = _inv_item.id;

    -- Reduce stock (goods returned to supplier) -- always reduce since goods leave warehouse
    UPDATE public.products SET stock_quantity = GREATEST(stock_quantity - _qty, 0)
      WHERE id = _inv_item.product_id;
    -- Also reduce the batch quantity if present
    IF _inv_item.batch_id IS NOT NULL THEN
      UPDATE public.stock_batches SET quantity = GREATEST(quantity - _qty, 0)
        WHERE id = _inv_item.batch_id;
    END IF;
  END LOOP;

  UPDATE public.purchase_returns SET refund_amount = _refund_total WHERE id = _return_id;

  -- Adjust invoice totals
  UPDATE public.purchase_invoices
    SET total = GREATEST(total - _refund_total, 0),
        paid = CASE WHEN _refund_method IS NOT NULL THEN GREATEST(paid - _refund_total, 0) ELSE paid END,
        due  = GREATEST(GREATEST(total - _refund_total,0) -
                        CASE WHEN _refund_method IS NOT NULL THEN GREATEST(paid - _refund_total,0) ELSE paid END, 0),
        status = CASE
          WHEN (SELECT SUM(quantity - returned_quantity) FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id) <= 0
          THEN 'returned' ELSE 'partially_returned' END
    WHERE id = _invoice_id
    RETURNING supplier_id INTO _sup;

  -- Adjust supplier balance / cash out
  IF _refund_method IS NOT NULL AND _refund_total > 0 THEN
    IF _sup IS NOT NULL THEN
      SELECT name INTO _sup_name FROM public.suppliers WHERE id = _sup;
    END IF;
    INSERT INTO public.expenses(category, amount, paid_to, method, notes, expense_date)
    VALUES ('Purchase Return', -_refund_total, _sup_name, _refund_method,
            'Refund ' || _return_no, CURRENT_DATE);
  ELSIF _sup IS NOT NULL AND _refund_total > 0 THEN
    -- reduce supplier due instead of cash refund
    UPDATE public.suppliers SET balance_due = GREATEST(COALESCE(balance_due,0) - _refund_total, 0) WHERE id = _sup;
  END IF;

  RETURN jsonb_build_object('return_id', _return_id, 'return_no', _return_no, 'refund_amount', _refund_total);
END;
$$;

-- Delete purchase invoice (admin only) — reverses everything
CREATE OR REPLACE FUNCTION public.delete_purchase_invoice(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _item record; _inv record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;

  -- reverse stock for each item (net of already-returned qty)
  FOR _item IN SELECT * FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id LOOP
    UPDATE public.products
      SET stock_quantity = GREATEST(stock_quantity - (_item.quantity - _item.returned_quantity), 0)
      WHERE id = _item.product_id;
    IF _item.batch_id IS NOT NULL THEN
      DELETE FROM public.stock_batches WHERE id = _item.batch_id;
    END IF;
  END LOOP;

  -- reverse supplier balance
  IF _inv.supplier_id IS NOT NULL AND _inv.due > 0 THEN
    UPDATE public.suppliers SET balance_due = GREATEST(COALESCE(balance_due,0) - _inv.due, 0)
      WHERE id = _inv.supplier_id;
  END IF;

  -- delete linked expense & payments
  DELETE FROM public.expenses WHERE purchase_invoice_id = _invoice_id;
  DELETE FROM public.supplier_payments WHERE invoice_id = _invoice_id;

  -- delete invoice cascades items & returns
  DELETE FROM public.purchase_invoices WHERE id = _invoice_id;
END;
$$;
