-- Closed cash drawer = closed books for those bills.
-- A bill made before the last cash drawer close cannot be edited (customer,
-- note, payment method) or cancelled any more. Only Return works on it — the
-- return and its refund are booked in today's open shift.
-- Also improves Return: cash refunds need an open drawer, and restocked goods
-- come back at the cost they were sold at. Safe to run more than once.

CREATE OR REPLACE FUNCTION public.sale_locked(_sale_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales s JOIN public.cash_shifts c ON c.status = 'closed' AND c.closed_at >= s.created_at
    WHERE s.id = _sale_id
  ) AND COALESCE(current_setting('app.allow_locked_edit', true), '') <> 'on';
$$;
GRANT EXECUTE ON FUNCTION public.sale_locked(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_lock_closed_sales()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _msg text := 'This bill is from a closed cash drawer shift — it cannot be edited or cancelled. Use Return instead.';
BEGIN
  IF TG_TABLE_NAME = 'sale_returns' THEN
    IF NEW.return_type = 'cancel' AND public.sale_locked(NEW.sale_id) THEN RAISE EXCEPTION '%', _msg; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF OLD.sale_id IS NOT NULL AND public.sale_locked(OLD.sale_id) THEN
      IF TG_OP = 'DELETE' OR NEW.method IS DISTINCT FROM OLD.method OR NEW.amount IS DISTINCT FROM OLD.amount THEN
        RAISE EXCEPTION '%', _msg;
      END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
  ELSE -- sales: customer / note changes
    IF (NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.notes IS DISTINCT FROM OLD.notes)
       AND public.sale_locked(OLD.id) THEN
      RAISE EXCEPTION '%', _msg;
    END IF;
    RETURN NEW;
  END IF;
END; $$;

DROP TRIGGER IF EXISTS lock_closed_sale_cancel ON public.sale_returns;
CREATE TRIGGER lock_closed_sale_cancel BEFORE INSERT ON public.sale_returns
  FOR EACH ROW EXECUTE FUNCTION public.trg_lock_closed_sales();
DROP TRIGGER IF EXISTS lock_closed_sale_payments ON public.payments;
CREATE TRIGGER lock_closed_sale_payments BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_lock_closed_sales();
DROP TRIGGER IF EXISTS lock_closed_sale_edit ON public.sales;
CREATE TRIGGER lock_closed_sale_edit BEFORE UPDATE OF owner_id, notes ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_lock_closed_sales();

-- ---------- Return ----------
CREATE OR REPLACE FUNCTION public.create_return(_sale_id uuid, _items jsonb, _reason text DEFAULT NULL::text, _refund_method payment_method DEFAULT NULL::payment_method, _restock boolean DEFAULT true, _client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sale public.sales%ROWTYPE;
  _return_id uuid;
  _return_no text;
  _item jsonb;
  _sale_item public.sale_items%ROWTYPE;
  _qty numeric;
  _line_total numeric;
  _refund_total numeric := 0;
  _gross numeric;
  _factor numeric := 1;
  _prior_returns numeric;
  _net_paid numeric;
  _net_total_before numeric;
  _due_before numeric;
  _due_reduction numeric;
  _cash_back numeric;
  _result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _client_request_id IS NULL THEN RAISE EXCEPTION 'request id required'; END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'choose at least one item'; END IF;

  SELECT jsonb_build_object('return_id', id, 'return_no', return_no, 'refund_amount', refund_amount,
    'refund_paid', refund_paid, 'due_reduction', due_reduction, 'duplicate', true)
  INTO _result FROM public.sale_returns WHERE client_request_id = _client_request_id;
  IF _result IS NOT NULL THEN RETURN _result; END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF _sale.status IN ('void','refunded') THEN RAISE EXCEPTION 'sale is already closed'; END IF;

  PERFORM 1 FROM public.sale_items WHERE sale_id = _sale_id ORDER BY id FOR UPDATE;
  SELECT COALESCE(SUM(line_total),0) INTO _gross FROM public.sale_items WHERE sale_id = _sale_id;
  IF _gross > 0 AND _sale.discount > 0 THEN _factor := GREATEST(0, 1 - (_sale.discount / _gross)); END IF;

  SELECT COALESCE(SUM(refund_amount),0) INTO _prior_returns FROM public.sale_returns WHERE sale_id = _sale_id;
  SELECT COALESCE(SUM(amount),0) INTO _net_paid FROM public.payments WHERE sale_id = _sale_id;
  _net_total_before := GREATEST(_sale.total - _prior_returns, 0);
  _due_before := GREATEST(_net_total_before - _net_paid, 0);

  _return_no := public.next_return_no();
  INSERT INTO public.sale_returns(sale_id, return_no, reason, refund_method, refund_amount, refund_paid,
    due_reduction, restock, return_type, client_request_id, processed_by)
  VALUES (_sale_id, _return_no, NULLIF(trim(_reason),''), _refund_method, 0, 0, 0,
    COALESCE(_restock,true), 'partial', _client_request_id, auth.uid())
  RETURNING id INTO _return_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_item->>'quantity')::numeric,0);
    IF _qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO _sale_item FROM public.sale_items
      WHERE id = (_item->>'sale_item_id')::uuid AND sale_id = _sale_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sale item not found'; END IF;
    IF _qty > _sale_item.quantity - _sale_item.returned_quantity THEN
      RAISE EXCEPTION 'return quantity exceeds remaining for %', _sale_item.name;
    END IF;
    _line_total := round(_qty * (_sale_item.line_total / NULLIF(_sale_item.quantity,0)) * _factor, 2);
    _refund_total := _refund_total + _line_total;
    INSERT INTO public.sale_return_items(return_id,sale_item_id,product_id,name,quantity,unit_price,line_total)
    VALUES (_return_id,_sale_item.id,_sale_item.product_id,_sale_item.name,_qty,
      round((_sale_item.line_total / NULLIF(_sale_item.quantity,0)) * _factor,2),_line_total);
    UPDATE public.sale_items SET returned_quantity = returned_quantity + _qty WHERE id = _sale_item.id;
    IF COALESCE(_restock,true) AND _sale_item.product_id IS NOT NULL THEN
      -- Goods come back at the cost they were sold at (weighted average, when available).
      IF COALESCE(_sale_item.cost_price, 0) > 0 AND to_regprocedure('public.cost_stock_in(uuid,numeric,numeric,text,text)') IS NOT NULL THEN
        EXECUTE 'SELECT public.cost_stock_in($1,$2,$3,$4,$5)' USING _sale_item.product_id, _qty, _sale_item.cost_price, 'sale_return', _return_no;
      ELSE
        UPDATE public.products SET stock_quantity = stock_quantity + _qty WHERE id = _sale_item.product_id;
      END IF;
    END IF;
  END LOOP;

  IF _refund_total <= 0.004 THEN RAISE EXCEPTION 'choose at least one item'; END IF;
  _due_reduction := LEAST(_refund_total, _due_before);
  _cash_back := _refund_total - _due_reduction;
  IF _cash_back > 0.004 AND (_refund_method IS NULL OR _refund_method = 'due') THEN
    RAISE EXCEPTION 'refund method required for customer payout';
  END IF;
  -- Cash paid back must come out of an open drawer.
  IF _cash_back > 0.004 AND _refund_method = 'cash'
     AND NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE status = 'open') THEN
    RAISE EXCEPTION 'Open the cash drawer shift first — % cash is paid back.', round(_cash_back, 2);
  END IF;

  UPDATE public.sale_returns SET refund_amount=_refund_total, refund_paid=_cash_back,
    due_reduction=_due_reduction WHERE id=_return_id;
  IF _cash_back > 0.004 THEN
    INSERT INTO public.payments(sale_id,method,amount,reference,return_id,client_request_id)
    VALUES (_sale_id,_refund_method,-_cash_back,'Refund '||_return_no,_return_id,_client_request_id);
  END IF;
  PERFORM public.recalc_sale_totals(_sale_id);

  RETURN jsonb_build_object('return_id',_return_id,'return_no',_return_no,'refund_amount',_refund_total,
    'refund_paid',_cash_back,'due_reduction',_due_reduction,'duplicate',false);
END;
$function$;

NOTIFY pgrst, 'reload schema';
