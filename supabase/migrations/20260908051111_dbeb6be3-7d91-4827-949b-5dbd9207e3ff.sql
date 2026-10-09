ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS return_type text NOT NULL DEFAULT 'partial',
  ADD COLUMN IF NOT EXISTS due_reduction numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS return_id uuid,
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sale_returns_client_request
  ON public.sale_returns(client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_client_request
  ON public.payments(client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_payments_return_id ON public.payments(return_id);

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_return_id_fkey') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_return_id_fkey FOREIGN KEY (return_id)
      REFERENCES public.sale_returns(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_returns_type_check') THEN
    ALTER TABLE public.sale_returns
      ADD CONSTRAINT sale_returns_type_check CHECK (return_type IN ('partial','cancel')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_returns_amounts_check') THEN
    ALTER TABLE public.sale_returns
      ADD CONSTRAINT sale_returns_amounts_check CHECK (
        refund_amount >= 0 AND refund_paid >= 0 AND due_reduction >= 0
        AND refund_paid + due_reduction <= refund_amount + 0.01
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_returned_quantity_check') THEN
    ALTER TABLE public.sale_items
      ADD CONSTRAINT sale_items_returned_quantity_check CHECK (
        returned_quantity >= 0 AND returned_quantity <= quantity
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_nonnegative_totals_check') THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_nonnegative_totals_check CHECK (total >= 0 AND paid >= 0 AND due >= 0) NOT VALID;
  END IF;
END
$do$;

UPDATE public.sale_returns r
SET return_type = CASE WHEN s.status = 'void' THEN 'cancel' ELSE 'partial' END,
    due_reduction = GREATEST(r.refund_amount - r.refund_paid, 0)
FROM public.sales s
WHERE s.id = r.sale_id;

UPDATE public.payments p
SET return_id = r.id
FROM public.sale_returns r
WHERE p.sale_id = r.sale_id
  AND p.amount < 0
  AND p.return_id IS NULL
  AND (
    p.reference = 'Refund ' || r.return_no
    OR (r.return_type = 'cancel' AND p.reference = 'Cancelled ' || (SELECT invoice_no FROM public.sales WHERE id = r.sale_id))
  );

INSERT INTO public.sale_return_items(return_id, sale_item_id, product_id, name, quantity, unit_price, line_total)
SELECT r.id, si.id, si.product_id, si.name,
       GREATEST(si.quantity - si.returned_quantity, 0),
       CASE WHEN si.quantity > 0 THEN round(si.line_total / si.quantity, 2) ELSE 0 END,
       CASE WHEN si.quantity > 0 THEN round((si.quantity - si.returned_quantity) * si.line_total / si.quantity, 2) ELSE 0 END
FROM public.sale_returns r
JOIN public.sales s ON s.id = r.sale_id AND s.status = 'void'
JOIN public.sale_items si ON si.sale_id = s.id
WHERE r.return_type = 'cancel'
  AND si.quantity > si.returned_quantity
  AND NOT EXISTS (SELECT 1 FROM public.sale_return_items x WHERE x.return_id = r.id AND x.sale_item_id = si.id);

UPDATE public.sale_items si
SET returned_quantity = quantity
FROM public.sales s
WHERE s.id = si.sale_id AND s.status = 'void' AND si.returned_quantity <> si.quantity;

CREATE OR REPLACE FUNCTION public.recalc_sale_totals(_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _sale public.sales%ROWTYPE;
  _paid numeric;
  _returns numeric;
  _net_total numeric;
  _due numeric;
  _all_returned boolean;
  _status public.sale_status;
BEGIN
  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF _sale.status = 'void' THEN
    RETURN jsonb_build_object('sale_id', _sale_id, 'total', _sale.total, 'paid', 0, 'due', 0, 'status', 'void');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;
  SELECT COALESCE(SUM(refund_amount), 0) INTO _returns FROM public.sale_returns WHERE sale_id = _sale_id;
  _net_total := GREATEST(_sale.total - _returns, 0);
  _paid := LEAST(GREATEST(_paid, 0), _net_total);
  _due := GREATEST(_net_total - _paid, 0);

  SELECT COALESCE(bool_and(returned_quantity >= quantity), false)
    INTO _all_returned FROM public.sale_items WHERE sale_id = _sale_id;
  _status := CASE
    WHEN _returns <= 0.004 THEN 'completed'::public.sale_status
    WHEN _all_returned THEN 'refunded'::public.sale_status
    ELSE 'partial_refund'::public.sale_status
  END;

  UPDATE public.sales SET paid = _paid, due = _due, status = _status WHERE id = _sale_id;
  RETURN jsonb_build_object('sale_id', _sale_id, 'total', _sale.total, 'net_total', _net_total,
    'returns', _returns, 'paid', _paid, 'due', _due, 'status', _status);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.create_return(
  _sale_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL,
  _refund_method public.payment_method DEFAULT NULL,
  _restock boolean DEFAULT true,
  _client_request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
      UPDATE public.products SET stock_quantity = stock_quantity + _qty WHERE id = _sale_item.product_id;
    END IF;
  END LOOP;

  IF _refund_total <= 0.004 THEN RAISE EXCEPTION 'choose at least one item'; END IF;
  _due_reduction := LEAST(_refund_total, _due_before);
  _cash_back := _refund_total - _due_reduction;
  IF _cash_back > 0.004 AND (_refund_method IS NULL OR _refund_method = 'due') THEN
    RAISE EXCEPTION 'refund method required for customer payout';
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
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text, _client_request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _sale public.sales%ROWTYPE;
  _return_id uuid;
  _return_no text;
  _it public.sale_items%ROWTYPE;
  _m record;
  _prior_returns numeric;
  _refund_amount numeric;
  _refund_paid numeric := 0;
  _due_reduction numeric;
  _result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  IF _client_request_id IS NULL THEN RAISE EXCEPTION 'request id required'; END IF;

  SELECT jsonb_build_object('sale_id',sale_id,'return_id',id,'return_no',return_no,
    'refund_amount',refund_amount,'refunded',refund_paid,'due_reduction',due_reduction,'duplicate',true)
  INTO _result FROM public.sale_returns WHERE client_request_id=_client_request_id;
  IF _result IS NOT NULL THEN RETURN _result; END IF;

  SELECT * INTO _sale FROM public.sales WHERE id=_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF _sale.status='void' THEN RAISE EXCEPTION 'sale already cancelled'; END IF;
  IF _sale.status='refunded' THEN RAISE EXCEPTION 'sale already fully returned'; END IF;
  PERFORM 1 FROM public.sale_items WHERE sale_id=_sale_id ORDER BY id FOR UPDATE;

  SELECT COALESCE(SUM(refund_amount),0) INTO _prior_returns FROM public.sale_returns WHERE sale_id=_sale_id;
  _refund_amount := GREATEST(_sale.total - _prior_returns,0);
  SELECT COALESCE(SUM(amount),0) INTO _refund_paid FROM public.payments WHERE sale_id=_sale_id;
  _refund_paid := LEAST(GREATEST(_refund_paid,0),_refund_amount);
  _due_reduction := GREATEST(_refund_amount-_refund_paid,0);
  _return_no := public.next_return_no();

  INSERT INTO public.sale_returns(sale_id,return_no,reason,refund_method,refund_amount,refund_paid,
    due_reduction,restock,return_type,client_request_id,processed_by)
  VALUES (_sale_id,_return_no,COALESCE(NULLIF(trim(_reason),''),'Sale cancelled'),NULL,
    _refund_amount,_refund_paid,_due_reduction,true,'cancel',_client_request_id,auth.uid())
  RETURNING id INTO _return_id;

  FOR _it IN SELECT * FROM public.sale_items WHERE sale_id=_sale_id ORDER BY id LOOP
    IF _it.quantity > _it.returned_quantity THEN
      INSERT INTO public.sale_return_items(return_id,sale_item_id,product_id,name,quantity,unit_price,line_total)
      VALUES (_return_id,_it.id,_it.product_id,_it.name,_it.quantity-_it.returned_quantity,
        CASE WHEN _it.quantity>0 THEN round(_it.line_total/_it.quantity,2) ELSE 0 END,
        CASE WHEN _it.quantity>0 THEN round((_it.quantity-_it.returned_quantity)*_it.line_total/_it.quantity,2) ELSE 0 END);
      IF _it.product_id IS NOT NULL THEN
        UPDATE public.products SET stock_quantity=stock_quantity+(_it.quantity-_it.returned_quantity) WHERE id=_it.product_id;
      END IF;
      UPDATE public.sale_items SET returned_quantity=quantity WHERE id=_it.id;
    END IF;
  END LOOP;

  FOR _m IN SELECT method,SUM(amount) net FROM public.payments WHERE sale_id=_sale_id GROUP BY method HAVING SUM(amount)>0.004 LOOP
    INSERT INTO public.payments(sale_id,method,amount,reference,return_id,
      client_request_id)
    VALUES (_sale_id,_m.method,-_m.net,'Cancelled '||_sale.invoice_no,_return_id,
      CASE WHEN _m.method=(SELECT min(method) FROM public.payments WHERE sale_id=_sale_id AND amount>0) THEN _client_request_id ELSE NULL END);
  END LOOP;

  UPDATE public.sales SET status='void',paid=0,due=0,
    notes=concat_ws(' | ',NULLIF(notes,''),'Cancelled: '||COALESCE(NULLIF(trim(_reason),''),'No reason'))
  WHERE id=_sale_id;

  RETURN jsonb_build_object('sale_id',_sale_id,'return_id',_return_id,'return_no',_return_no,
    'refund_amount',_refund_amount,'refunded',_refund_paid,'due_reduction',_due_reduction,'duplicate',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.update_sale(
  _sale_id uuid,
  _items jsonb DEFAULT '[]'::jsonb,
  _discount numeric DEFAULT NULL,
  _notes text DEFAULT NULL,
  _extra_payment jsonb DEFAULT NULL,
  _new_items jsonb DEFAULT '[]'::jsonb,
  _owner_id uuid DEFAULT NULL,
  _set_owner boolean DEFAULT false,
  _refund_method_in public.payment_method DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE _sale public.sales%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO _sale FROM public.sales WHERE id=_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF jsonb_array_length(COALESCE(_new_items,'[]'::jsonb))>0 OR _extra_payment IS NOT NULL
     OR (_discount IS NOT NULL AND abs(_discount-_sale.discount)>0.004) THEN
    RAISE EXCEPTION 'financial changes must use Return, Cancel, or Collect Due';
  END IF;
  UPDATE public.sales SET owner_id=CASE WHEN _set_owner THEN _owner_id ELSE owner_id END,
    notes=COALESCE(_notes,notes) WHERE id=_sale_id;
  RETURN jsonb_build_object('sale_id',_sale_id,'total',_sale.total,'paid',_sale.paid,'due',_sale.due);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.next_return_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE prefix text; seq int;
BEGIN
  prefix := 'RET-' || to_char(now() AT TIME ZONE 'Asia/Dhaka','YYYYMM') || '-';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(return_no,'^.*-','','g'),'')::int),0)+1 INTO seq
  FROM public.sale_returns WHERE return_no LIKE prefix || '%';
  RETURN prefix || lpad(seq::text,5,'0');
END;
$fn$;

CREATE OR REPLACE VIEW public.sale_reconciliation
WITH (security_invoker=true)
AS
SELECT s.id,s.invoice_no,s.status,s.created_at,s.total AS invoice_total,
  COALESCE(r.return_amount,0) AS return_amount,
  COALESCE(r.refund_paid,0) AS refund_paid,
  COALESCE(r.due_reduction,0) AS due_reduction,
  COALESCE(p.payment_net,0) AS payment_net,
  s.paid AS stored_paid,s.due AS stored_due,
  GREATEST(s.total-COALESCE(r.return_amount,0),0) AS net_total,
  GREATEST(GREATEST(s.total-COALESCE(r.return_amount,0),0)-COALESCE(p.payment_net,0),0) AS calculated_due,
  abs(s.paid-CASE WHEN s.status='void' THEN 0 ELSE LEAST(GREATEST(COALESCE(p.payment_net,0),0),GREATEST(s.total-COALESCE(r.return_amount,0),0)) END)>0.01
    OR abs(s.due-CASE WHEN s.status='void' THEN 0 ELSE GREATEST(GREATEST(s.total-COALESCE(r.return_amount,0),0)-COALESCE(p.payment_net,0),0) END)>0.01 AS has_mismatch
FROM public.sales s
LEFT JOIN (SELECT sale_id,SUM(refund_amount) return_amount,SUM(refund_paid) refund_paid,SUM(due_reduction) due_reduction FROM public.sale_returns GROUP BY sale_id) r ON r.sale_id=s.id
LEFT JOIN (SELECT sale_id,SUM(amount) payment_net FROM public.payments GROUP BY sale_id) p ON p.sale_id=s.id;

GRANT SELECT ON public.sale_reconciliation TO authenticated;
GRANT SELECT ON public.sale_reconciliation TO service_role;

DO $do$
DECLARE _id uuid;
BEGIN
  FOR _id IN SELECT id FROM public.sales WHERE status <> 'void' LOOP
    PERFORM public.recalc_sale_totals(_id);
  END LOOP;
END
$do$;

REVOKE ALL ON FUNCTION public.create_return(uuid,jsonb,text,public.payment_method,boolean,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cancel_sale(uuid,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.update_sale(uuid,jsonb,numeric,text,jsonb,jsonb,uuid,boolean,public.payment_method) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_return(uuid,jsonb,text,public.payment_method,boolean,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_sale(uuid,jsonb,numeric,text,jsonb,jsonb,uuid,boolean,public.payment_method) TO authenticated;