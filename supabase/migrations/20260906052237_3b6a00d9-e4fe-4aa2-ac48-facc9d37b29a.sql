-- 1. per-user open shift preference
CREATE OR REPLACE FUNCTION public.current_open_shift(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id FROM public.cash_shifts
  WHERE status = 'open'
  ORDER BY (opened_by = _user_id) DESC, opened_at DESC
  LIMIT 1;
$function$;

-- 2. attribute cash movement to the acting user
CREATE OR REPLACE FUNCTION public.trg_payments_cash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _cashier uuid; _inv text;
BEGIN
  IF NEW.method <> 'cash' THEN RETURN NEW; END IF;
  SELECT cashier_id, invoice_no INTO _cashier, _inv FROM public.sales WHERE id = NEW.sale_id;
  PERFORM public.record_cash_movement(
    CASE WHEN NEW.amount >= 0 THEN 'in' ELSE 'out' END,
    NEW.amount, CASE WHEN NEW.amount >= 0 THEN 'sale' ELSE 'refund' END,
    NEW.id, COALESCE(NEW.reference, _inv), NULL, COALESCE(auth.uid(), _cashier)
  );
  RETURN NEW;
END; $function$;

-- 3. cancel_sale: reverse each tender method proportionally to what it collected
CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _sale record;
  _it record;
  _m record;
  _refund numeric := 0;
  _refund_method public.payment_method;
  _existing int;
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
  FROM public.payments WHERE sale_id = _sale_id;

  SELECT method INTO _refund_method
  FROM public.payments
  WHERE sale_id = _sale_id AND amount > 0
  ORDER BY received_at DESC
  LIMIT 1;

  SELECT count(*) INTO _existing
  FROM public.payments
  WHERE sale_id = _sale_id AND amount < 0 AND reference = 'Cancelled ' || _sale.invoice_no;

  IF _refund > 0.004 AND _existing = 0 THEN
    -- one reversal row per method, using that method's own net collected amount
    FOR _m IN
      SELECT method, SUM(amount) AS net
      FROM public.payments
      WHERE sale_id = _sale_id
      GROUP BY method
      HAVING SUM(amount) > 0.004
      ORDER BY method
    LOOP
      INSERT INTO public.payments(sale_id, method, amount, reference)
      VALUES (_sale_id, _m.method, -_m.net, 'Cancelled ' || _sale.invoice_no);
    END LOOP;
  ELSE
    _refund := 0;
  END IF;

  INSERT INTO public.sale_returns(
    sale_id, return_no, reason, refund_method, refund_amount, refund_paid, restock, processed_by)
  VALUES (
    _sale_id, public.next_return_no(),
    COALESCE(NULLIF(_reason, ''), 'Sale cancelled'),
    _refund_method, _sale.total, _refund, false, auth.uid());

  UPDATE public.sales
  SET status = 'void', paid = 0, due = 0,
      notes = COALESCE(notes, '') ||
        CASE WHEN _reason IS NOT NULL AND _reason <> '' THEN ' | Cancelled: ' || _reason ELSE ' | Cancelled' END
  WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'refunded', _refund);
END;
$function$;

-- 4. re-link orphan cash movements to the shift that was open at that moment
UPDATE public.cash_movements cm
SET shift_id = s.id
FROM public.cash_shifts s
WHERE cm.shift_id IS NULL
  AND cm.occurred_at >= s.opened_at
  AND cm.occurred_at <= COALESCE(s.closed_at, now());
