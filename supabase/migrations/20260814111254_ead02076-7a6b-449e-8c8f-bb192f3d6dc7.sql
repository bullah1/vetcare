CREATE OR REPLACE FUNCTION public.recalc_sale_totals(_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _sub numeric; _tax numeric; _disc numeric; _total numeric; _paid numeric; _due numeric; _status sale_status;
BEGIN
  SELECT COALESCE(SUM(quantity * unit_price - discount), 0), COALESCE(SUM(tax), 0)
    INTO _sub, _tax
  FROM public.sale_items WHERE sale_id = _sale_id;

  SELECT COALESCE(discount, 0), status INTO _disc, _status FROM public.sales WHERE id = _sale_id;
  IF _disc IS NULL THEN RETURN NULL; END IF;

  _total := GREATEST(_sub + _tax - _disc, 0);

  SELECT COALESCE(SUM(amount), 0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;
  _due := GREATEST(_total - _paid, 0);

  UPDATE public.sales
     SET subtotal = _sub, tax = _tax, total = _total, paid = _paid, due = _due
   WHERE id = _sale_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'subtotal', _sub, 'tax', _tax,
    'discount', _disc, 'total', _total, 'paid', _paid, 'due', _due);
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_sale_totals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_sale_totals(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_payments_recalc_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_sale_totals(OLD.sale_id);
    RETURN OLD;
  END IF;
  PERFORM public.recalc_sale_totals(NEW.sale_id);
  IF TG_OP = 'UPDATE' AND OLD.sale_id IS DISTINCT FROM NEW.sale_id THEN
    PERFORM public.recalc_sale_totals(OLD.sale_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_recalc_sale ON public.payments;
CREATE TRIGGER payments_recalc_sale
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.trg_payments_recalc_sale();

CREATE OR REPLACE FUNCTION public.change_payment_method(_payment_id uuid, _method payment_method)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _pay record; _old payment_method; _cashier uuid; _inv text; _totals jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  _old := _pay.method;
  IF _old = _method THEN
    RETURN jsonb_build_object('payment_id', _payment_id, 'method', _method, 'changed', false,
      'totals', public.recalc_sale_totals(_pay.sale_id));
  END IF;

  SELECT cashier_id, invoice_no INTO _cashier, _inv FROM public.sales WHERE id = _pay.sale_id;

  UPDATE public.payments SET method = _method WHERE id = _payment_id;

  IF _old = 'cash' THEN
    DELETE FROM public.cash_movements
      WHERE source_id = _payment_id AND source IN ('sale','refund');
  END IF;

  IF _method = 'cash' THEN
    PERFORM public.record_cash_movement(
      CASE WHEN _pay.amount >= 0 THEN 'in' ELSE 'out' END,
      _pay.amount,
      CASE WHEN _pay.amount >= 0 THEN 'sale' ELSE 'refund' END,
      _payment_id,
      COALESCE(_pay.reference, _inv),
      'Payment method corrected',
      COALESCE(_cashier, auth.uid())
    );
  END IF;

  _totals := public.recalc_sale_totals(_pay.sale_id);

  RETURN jsonb_build_object('payment_id', _payment_id, 'from', _old, 'method', _method,
    'changed', true, 'totals', _totals);
END;
$function$;