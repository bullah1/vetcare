-- Product exchange + customer store credit.
--
-- Exchange = return items from an old bill + a new bill for the new items, in one step.
-- The return value moves to the new bill as store credit (payment method 'credit'):
--   old bill: -C credit  (customer gets the value back as credit, not money)
--   new bill: +C credit  (that credit pays for the new items)
-- So no money is counted twice: only the real difference is collected or paid back.
-- If the new items cost less, the rest is paid back (cash/bKash/…) or kept as store credit
-- on the customer's account, which can pay for a later bill at POS.
--
-- Store credit balance of a customer = -(sum of all 'credit' payments on their bills).
-- Only admins can exchange, and only bills from the last 15 days.

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS exchange_of_sale_id uuid REFERENCES public.sales(id);
ALTER TABLE public.sale_returns ADD COLUMN IF NOT EXISTS exchange_sale_id uuid REFERENCES public.sales(id);
CREATE INDEX IF NOT EXISTS ix_sales_exchange_of ON public.sales(exchange_of_sale_id) WHERE exchange_of_sale_id IS NOT NULL;

-- Store credit available to a customer.
CREATE OR REPLACE FUNCTION public.customer_credit_balance(_owner_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN round(COALESCE((
    SELECT -sum(p.amount) FROM public.payments p JOIN public.sales s ON s.id = p.sale_id
    WHERE s.owner_id = _owner_id AND p.method::text = 'credit'), 0), 2);
END;
$function$;
REVOKE ALL ON FUNCTION public.customer_credit_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_credit_balance(uuid) TO authenticated;

-- Store credit can only be spent if the customer has it, and only on a bill with a customer.
CREATE OR REPLACE FUNCTION public.trg_payments_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _owner uuid; _bal numeric; _old numeric := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.method::text = 'credit' AND NEW.method::text <> 'credit' THEN
    RAISE EXCEPTION 'A store credit payment cannot be changed to another method.';
  END IF;
  IF NEW.method::text <> 'credit' THEN RETURN NEW; END IF;
  IF COALESCE(current_setting('app.exchange_credit', true), '') = 'on' THEN RETURN NEW; END IF;

  SELECT owner_id INTO _owner FROM public.sales WHERE id = NEW.sale_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Store credit needs a customer on the bill.'; END IF;
  IF NEW.amount > 0 THEN
    PERFORM 1 FROM public.pet_owners WHERE id = _owner FOR UPDATE;   -- one spender at a time
    IF TG_OP = 'UPDATE' AND OLD.method::text = 'credit' THEN _old := OLD.amount; END IF;
    _bal := public.customer_credit_balance(_owner) + _old;
    IF NEW.amount > _bal + 0.004 THEN
      RAISE EXCEPTION 'Not enough store credit — available ৳%.', round(GREATEST(_bal, 0), 2);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS payments_credit_check ON public.payments;
CREATE TRIGGER payments_credit_check BEFORE INSERT OR UPDATE OF method, amount ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_payments_credit();

-- A bill that gave out store credit cannot be cancelled or re-priced (that would pay it out twice).
CREATE OR REPLACE FUNCTION public.trg_exchange_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _sid uuid;
BEGIN
  IF TG_TABLE_NAME = 'sale_returns' THEN
    IF NEW.return_type <> 'cancel' THEN RETURN NEW; END IF;
    _sid := NEW.sale_id;
  ELSE
    -- Store credit belongs to the bill's customer: moving the bill would move the credit.
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
       AND EXISTS (SELECT 1 FROM public.payments WHERE sale_id = NEW.id AND method::text = 'credit') THEN
      RAISE EXCEPTION 'This bill has store credit on it — its customer cannot be changed.';
    END IF;
    IF NEW.subtotal IS NOT DISTINCT FROM OLD.subtotal AND NEW.total IS NOT DISTINCT FROM OLD.total
       AND NEW.discount IS NOT DISTINCT FROM OLD.discount THEN RETURN NEW; END IF;
    _sid := NEW.id;
  END IF;
  IF COALESCE((SELECT sum(amount) FROM public.payments WHERE sale_id = _sid AND method::text = 'credit'), 0) < -0.004 THEN
    RAISE EXCEPTION 'This bill was exchanged or refunded to store credit — it cannot be cancelled or edited. Use Return instead.';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS sale_returns_exchange_guard ON public.sale_returns;
CREATE TRIGGER sale_returns_exchange_guard BEFORE INSERT ON public.sale_returns
  FOR EACH ROW EXECUTE FUNCTION public.trg_exchange_guard();
DROP TRIGGER IF EXISTS sales_exchange_guard ON public.sales;
CREATE TRIGGER sales_exchange_guard BEFORE UPDATE OF subtotal, total, discount, owner_id ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_exchange_guard();

-- The exchange itself, all or nothing.
--   _return_items: [{sale_item_id, quantity}]  items the customer brings back (restocked)
--   _new_items:    POS items [{product_id, name, quantity, unit_price, discount, tax}]
--   _payments:     extra money paid now when the new items cost more [{method, amount}]
--   _leftover:     'refund' (pay back with _refund_method) or 'credit' (keep on the account)
CREATE OR REPLACE FUNCTION public.create_exchange(
  _sale_id uuid, _return_items jsonb, _new_items jsonb, _payments jsonb DEFAULT '[]'::jsonb,
  _leftover text DEFAULT 'refund', _refund_method payment_method DEFAULT NULL, _reason text DEFAULT NULL,
  _client_request_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sale public.sales%ROWTYPE; _ret jsonb; _new jsonb; _project text; _bad text;
  _return_id uuid; _new_id uuid; _credit numeric; _new_due numeric; _use numeric := 0; _left numeric := 0;
  _res jsonb; _ns public.sales%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only an admin can exchange products.'; END IF;
  IF _client_request_id IS NULL THEN RAISE EXCEPTION 'request id required'; END IF;

  -- Pressed twice: give back the first result.
  SELECT r.id, r.exchange_sale_id INTO _return_id, _new_id FROM public.sale_returns r WHERE r.client_request_id = _client_request_id;
  IF _return_id IS NOT NULL THEN
    SELECT * INTO _ns FROM public.sales WHERE id = _new_id;
    RETURN jsonb_build_object('duplicate', true, 'return_id', _return_id, 'new_sale_id', _new_id, 'new_invoice_no', _ns.invoice_no);
  END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF _sale.status IN ('void', 'refunded') THEN RAISE EXCEPTION 'This bill is already % — nothing left to exchange.', CASE WHEN _sale.status = 'void' THEN 'cancelled' ELSE 'fully returned' END; END IF;
  IF _sale.created_at < now() - interval '15 days' THEN
    RAISE EXCEPTION 'Exchange is allowed only within 15 days of the bill (% was made on %).',
      _sale.invoice_no, to_char(_sale.created_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY');
  END IF;
  IF jsonb_typeof(_new_items) <> 'array' OR jsonb_array_length(_new_items) = 0 THEN RAISE EXCEPTION 'Add the new product(s) the customer takes.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE status = 'open') THEN
    RAISE EXCEPTION 'Open the cash drawer shift first.';
  END IF;
  IF _leftover NOT IN ('refund', 'credit') THEN RAISE EXCEPTION 'unknown leftover option %', _leftover; END IF;

  SELECT min(p.project), count(DISTINCT p.project) > 1 INTO _project, _bad
  FROM jsonb_array_elements(_new_items) x JOIN public.products p ON p.id = NULLIF(x->>'product_id', '')::uuid;
  IF _bad::boolean THEN RAISE EXCEPTION 'New products must all be from one business (Pet Care Vet or Sasthya Seba).'; END IF;
  _project := COALESCE(_project, _sale.project, 'pcv');

  PERFORM set_config('app.exchange_credit', 'on', true);

  -- 1) Items back: refund goes to store credit, after first clearing any due on the old bill.
  _ret := public.create_return(_sale_id, _return_items, 'Exchange: ' || COALESCE(NULLIF(trim(_reason), ''), 'product exchange'),
                               'credit'::payment_method, true, _client_request_id);
  _return_id := (_ret->>'return_id')::uuid;
  _credit := COALESCE((_ret->>'refund_paid')::numeric, 0);

  -- 2) New bill for the new items (+ any extra money paid now).
  _new := public.create_project_sale(_project, _sale.owner_id, _new_items, COALESCE(_payments, '[]'::jsonb), 0,
                                     'Exchange of ' || _sale.invoice_no);
  _new_id := (_new->>'sale_id')::uuid;
  UPDATE public.sales SET exchange_of_sale_id = _sale_id WHERE id = _new_id;
  UPDATE public.sale_returns SET exchange_sale_id = _new_id WHERE id = _return_id;

  -- 3) Credit pays the new bill.
  SELECT GREATEST(total - COALESCE((SELECT sum(amount) FROM public.payments WHERE sale_id = _new_id), 0), 0)
    INTO _new_due FROM public.sales WHERE id = _new_id;
  _use := round(LEAST(_credit, _new_due), 2);
  IF _use > 0.004 THEN
    INSERT INTO public.payments(sale_id, method, amount, reference, return_id)
    VALUES (_new_id, 'credit', _use, 'Exchange credit from ' || _sale.invoice_no, _return_id);
  END IF;

  -- 4) What is left of the credit: pay it back, or keep it on the customer's account.
  _left := round(_credit - _use, 2);
  IF _left > 0.004 THEN
    IF _leftover = 'credit' THEN
      IF _sale.owner_id IS NULL THEN
        RAISE EXCEPTION 'Store credit needs a customer — this bill has none. Pay the ৳% back instead.', _left;
      END IF;
    ELSE
      IF _refund_method IS NULL OR _refund_method::text IN ('due', 'credit') THEN
        RAISE EXCEPTION 'Choose how to pay back ৳%.', _left;
      END IF;
      INSERT INTO public.payments(sale_id, method, amount, reference, return_id)
      VALUES (_sale_id, 'credit', _left, 'Exchange refund ' || (_ret->>'return_no'), _return_id);
      INSERT INTO public.payments(sale_id, method, amount, reference, return_id)
      VALUES (_sale_id, _refund_method, -_left, 'Exchange refund ' || (_ret->>'return_no'), _return_id);
      UPDATE public.sale_returns SET refund_method = _refund_method WHERE id = _return_id;
    END IF;
  END IF;

  PERFORM set_config('app.exchange_credit', '', true);
  PERFORM public.recalc_sale_totals(_sale_id);
  PERFORM public.recalc_sale_totals(_new_id);
  SELECT * INTO _ns FROM public.sales WHERE id = _new_id;

  RETURN jsonb_build_object(
    'duplicate', false,
    'return_id', _return_id, 'return_no', _ret->>'return_no',
    'return_amount', (_ret->>'refund_amount')::numeric,
    'old_due_cleared', (_ret->>'due_reduction')::numeric,
    'credit', _credit, 'credit_used', _use,
    'leftover', _left, 'leftover_mode', CASE WHEN _left > 0.004 THEN _leftover END,
    'refund_method', CASE WHEN _left > 0.004 AND _leftover = 'refund' THEN _refund_method::text END,
    'new_sale_id', _new_id, 'new_invoice_no', _ns.invoice_no, 'project', _project,
    'new_total', _ns.total, 'new_paid', _ns.paid, 'new_due', _ns.due,
    'credit_balance', CASE WHEN _sale.owner_id IS NOT NULL THEN public.customer_credit_balance(_sale.owner_id) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_exchange(uuid, jsonb, jsonb, jsonb, text, payment_method, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exchange(uuid, jsonb, jsonb, jsonb, text, payment_method, text, uuid) TO authenticated;

-- Cash Close: show store credit used / given (not money, so not in collection).
CREATE OR REPLACE FUNCTION public.cash_close_summary(_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sh public.cash_shifts%ROWTYPE;
  _from timestamptz; _to timestamptz;
  _methods text[] := ARRAY['cash','bkash','nagad','rocket','bank','card'];
  _cash jsonb;
  _biz jsonb := '{}'::jsonb;
  _p text; _a jsonb; _b jsonb;
  _accounts jsonb := '[]'::jsonb;
  _m text;
  _open numeric; _coll numeric; _refd numeric; _min numeric; _mout numeric; _exp numeric; _sup numeric; _exp_total numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO _sh FROM public.cash_shifts WHERE id = _shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'shift not found'; END IF;
  _from := _sh.opened_at;
  _to := COALESCE(_sh.closed_at, now());

  -- Part A + B per business
  FOREACH _p IN ARRAY ARRAY['pcv','ss','all'] LOOP
    WITH bills AS (
      SELECT s.* FROM public.sales s
      WHERE s.created_at >= _from AND s.created_at < _to AND s.status <> 'void'
        AND (_p = 'all' OR s.project = _p)
    ), cancelled_here AS (
      SELECT s.* FROM public.sales s
      WHERE s.created_at >= _from AND s.created_at < _to AND s.status = 'void'
        AND (_p = 'all' OR s.project = _p)
    ), rets AS (
      SELECT r.*, s.created_at AS sale_created, s.project FROM public.sale_returns r JOIN public.sales s ON s.id = r.sale_id
      WHERE r.created_at >= _from AND r.created_at < _to
        AND (_p = 'all' OR s.project = _p)
        AND NOT (r.return_type = 'cancel' AND s.created_at >= _from)   -- bills made and cancelled in this shift are left out
    )
    SELECT jsonb_build_object(
      'bills', (SELECT count(*) FROM bills),
      'total_sales', (SELECT COALESCE(sum(subtotal + tax), 0) FROM bills),
      'discount', (SELECT COALESCE(sum(discount), 0) FROM bills),
      'returns', (SELECT COALESCE(sum(refund_amount), 0) FROM rets WHERE return_type <> 'cancel'),
      'cancelled_old_bills', (SELECT COALESCE(sum(refund_amount), 0) FROM rets WHERE return_type = 'cancel'),
      -- due left on this shift's bills at the end of the shift (later collections do not change it)
      'new_due', (SELECT COALESCE(sum(GREATEST(
                    b.total
                    - COALESCE((SELECT sum(r.refund_amount) FROM public.sale_returns r WHERE r.sale_id = b.id AND r.created_at < _to), 0)
                    - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.sale_id = b.id AND p.received_at < _to AND p.method <> 'due'), 0),
                  0)), 0) FROM bills b),
      'cancelled_bills', (SELECT count(*) FROM cancelled_here),
      'cancelled_bills_amount', (SELECT COALESCE(sum(total), 0) FROM cancelled_here)
    ) INTO _a;
    _a := _a || jsonb_build_object(
      'refund', (_a->>'returns')::numeric + (_a->>'cancelled_old_bills')::numeric,
      'net_sales', (_a->>'total_sales')::numeric - (_a->>'discount')::numeric
                   - (_a->>'returns')::numeric - (_a->>'cancelled_old_bills')::numeric);

    WITH pay AS (
      SELECT p.method::text AS method, p.amount, (s.created_at >= _from) AS this_shift_bill, s.status
      FROM public.payments p JOIN public.sales s ON s.id = p.sale_id
      WHERE p.received_at >= _from AND p.received_at < _to AND p.method <> 'due'
        AND (_p = 'all' OR s.project = _p)
        AND NOT (s.status = 'void' AND s.created_at >= _from)   -- bills made and cancelled in this shift
    ), per AS (
      SELECT m AS method,
        COALESCE((SELECT sum(amount) FROM pay WHERE pay.method = m AND this_shift_bill), 0) AS bill_collection,
        COALESCE((SELECT sum(amount) FROM pay WHERE pay.method = m AND NOT this_shift_bill AND amount > 0), 0) AS prev_due_collection,
        COALESCE((SELECT -sum(amount) FROM pay WHERE pay.method = m AND NOT this_shift_bill AND amount < 0), 0) AS refund_paid
      FROM unnest(_methods) m
    )
    SELECT jsonb_build_object(
      'methods', (SELECT jsonb_agg(jsonb_build_object(
                    'method', method, 'bill_collection', bill_collection, 'prev_due_collection', prev_due_collection,
                    'collection', bill_collection + prev_due_collection, 'refund_paid', refund_paid,
                    'net', bill_collection + prev_due_collection - refund_paid) ORDER BY array_position(_methods, method)) FROM per),
      'bill_collection', (SELECT sum(bill_collection) FROM per),
      'prev_due_collection', (SELECT sum(prev_due_collection) FROM per),
      'total_collection', (SELECT sum(bill_collection + prev_due_collection) FROM per),
      'refund_paid', (SELECT sum(refund_paid) FROM per),
      'net_collection', (SELECT sum(bill_collection + prev_due_collection - refund_paid) FROM per),
      -- store credit (product exchange): moves value between bills, no money in or out
      'credit_used', (SELECT COALESCE(sum(amount), 0) FROM pay WHERE pay.method = 'credit' AND amount > 0),
      'credit_issued', (SELECT COALESCE(-sum(amount), 0) FROM pay WHERE pay.method = 'credit' AND amount < 0)
    ) INTO _b;

    _biz := _biz || jsonb_build_object(_p, jsonb_build_object('sales', _a, 'collection', _b));
  END LOOP;

  -- Part C: accounts (combined). Cash = the drawer ledger, same as before.
  _cash := public.cash_shift_summary(_shift_id);
  FOREACH _m IN ARRAY _methods LOOP
    SELECT COALESCE(sum(amount) FILTER (WHERE received_at >= _from AND received_at < _to AND amount > 0), 0),
           COALESCE(-sum(amount) FILTER (WHERE received_at >= _from AND received_at < _to AND amount < 0), 0)
      INTO _coll, _refd
      FROM public.payments WHERE method::text = _m;
    SELECT COALESCE(sum(amount) FILTER (WHERE direction = 'in'), 0), COALESCE(sum(amount) FILTER (WHERE direction = 'out'), 0)
      INTO _min, _mout
      FROM public.cash_movements
      WHERE source = 'manual' AND method::text = _m
        AND (shift_id = _shift_id OR (shift_id IS NULL AND occurred_at >= _from AND occurred_at < _to));
    SELECT COALESCE(sum(amount), 0) INTO _exp FROM public.expenses
      WHERE method::text = _m AND created_at >= _from AND created_at < _to;
    SELECT COALESCE(sum(amount), 0) INTO _sup FROM public.supplier_payments
      WHERE method::text = _m AND created_at >= _from AND created_at < _to;

    IF _m = 'cash' THEN
      _accounts := _accounts || jsonb_build_array(jsonb_build_object(
        'method', 'cash',
        'opening', (_cash->>'opening_balance')::numeric,
        'collection', (_cash->>'cash_sales')::numeric + (_cash->>'cash_due_collections')::numeric
                      + (_cash->>'cancelled_in')::numeric,
        'refunds', (_cash->>'cash_refunds')::numeric + (_cash->>'cancelled_out')::numeric,
        'expenses', (_cash->>'expenses')::numeric,
        'supplier_payments', (_cash->>'supplier_payments')::numeric,
        'manual_in', (_cash->>'manual_in')::numeric,
        'manual_out', (_cash->>'manual_out')::numeric,
        'expected', (_cash->>'expected_cash')::numeric));
    ELSE
      -- digital opening = everything before the shift (receipts + manual in - refunds - manual out - spending)
      SELECT COALESCE((SELECT sum(amount) FROM public.payments WHERE method::text = _m AND received_at < _from), 0)
           + COALESCE((SELECT sum(CASE WHEN direction = 'in' THEN amount ELSE -amount END) FROM public.cash_movements
                        WHERE source = 'manual' AND method::text = _m
                          AND occurred_at < _from AND shift_id IS DISTINCT FROM _shift_id), 0)
           - COALESCE((SELECT sum(amount) FROM public.expenses WHERE method::text = _m AND created_at < _from), 0)
           - COALESCE((SELECT sum(amount) FROM public.supplier_payments WHERE method::text = _m AND created_at < _from), 0)
        INTO _open;
      _accounts := _accounts || jsonb_build_array(jsonb_build_object(
        'method', _m, 'opening', round(_open, 2), 'collection', _coll, 'refunds', _refd,
        'expenses', _exp, 'supplier_payments', _sup, 'manual_in', _min, 'manual_out', _mout,
        'expected', round(_open + _coll - _refd - _exp - _sup + _min - _mout, 2)));
    END IF;
  END LOOP;

  SELECT COALESCE(sum(amount), 0) INTO _exp_total FROM public.expenses WHERE created_at >= _from AND created_at < _to;

  RETURN jsonb_build_object(
    'version', 2,
    'shift_id', _sh.id, 'status', _sh.status,
    'opened_at', _sh.opened_at, 'closed_at', _sh.closed_at,
    'opening_balance', _sh.opening_balance,
    'business', _biz,
    'accounts', _accounts,
    'expenses', jsonb_build_object(
      'total', _exp_total,
      'cash', (SELECT COALESCE(sum(amount), 0) FROM public.expenses WHERE method = 'cash' AND created_at >= _from AND created_at < _to),
      'supplier_payments', (SELECT COALESCE(sum(amount), 0) FROM public.supplier_payments WHERE created_at >= _from AND created_at < _to)),
    'generated_at', now());
END;
$function$;
