-- Cash Close: one shared drawer + full Sales / Collection / Account summary per business.
--
-- Part A  Sales       : bills made in the shift (cancelled bills left out), discount, refunds, net sales, new due
-- Part B  Collection  : money received in the shift per method, split into bills of this shift
--                       and previous-due collection; refunds paid on older bills
-- Part C  Accounts    : opening / in / out / expected per method (cash = drawer ledger as before)
-- Businesses          : pcv (Pet Care Vet), ss (Sasthya Seba), all (combined). Expenses are combined only.
-- Every money row is counted once: a payment belongs to exactly one bill, one method and one shift window.

-- 1) Only one cash drawer shift can be open at a time (shared drawer).
CREATE UNIQUE INDEX IF NOT EXISTS cash_shifts_one_open ON public.cash_shifts ((true)) WHERE status = 'open';

-- Everyone on staff can see every shift (shared drawer), not only their own.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_shifts' AND policyname = 'staff read all shifts') THEN
    CREATE POLICY "staff read all shifts" ON public.cash_shifts FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
  END IF;
END $$;

-- Frozen summary, saved when the drawer is closed.
ALTER TABLE public.cash_shifts ADD COLUMN IF NOT EXISTS close_summary jsonb;

CREATE OR REPLACE FUNCTION public.open_cash_shift(_opening numeric, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cash_shift_open'));
  SELECT id INTO _id FROM public.cash_shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF _id IS NOT NULL THEN
    RETURN _id;   -- the drawer is already open for everyone
  END IF;
  INSERT INTO public.cash_shifts(opened_by, opening_balance, opening_notes)
  VALUES (auth.uid(), COALESCE(_opening, 0), NULLIF(btrim(_notes), ''))
  RETURNING id INTO _id;
  RETURN _id;
END;
$function$;

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
      'net_collection', (SELECT sum(bill_collection + prev_due_collection - refund_paid) FROM per)
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

REVOKE ALL ON FUNCTION public.cash_close_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_close_summary(uuid) TO authenticated;

-- Close the shared drawer in one step and freeze the full summary.
--   _counted : {"cash": 4930, "bkash": 3590, ...}  money actually counted per account
--   _settle  : move the counted digital balances out (settled), as the old close did
CREATE OR REPLACE FUNCTION public.close_cash_shift_v2(_shift_id uuid, _counted jsonb, _settle boolean DEFAULT true, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sh public.cash_shifts%ROWTYPE;
  _sum jsonb; _acc jsonb; _new_acc jsonb := '[]'::jsonb;
  _m text; _exp numeric; _cnt numeric; _settled numeric;
  _res jsonb; _tot_exp numeric := 0; _tot_cnt numeric := 0; _tot_set numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO _sh FROM public.cash_shifts WHERE id = _shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shift not found'; END IF;
  IF _sh.status <> 'open' THEN RAISE EXCEPTION 'This cash drawer is already closed.'; END IF;

  -- 1) the summary up to now, before any settlement
  _sum := public.cash_close_summary(_shift_id);

  -- 2) counted / variance / settlement per account
  FOR _acc IN SELECT * FROM jsonb_array_elements(_sum->'accounts') LOOP
    _m := _acc->>'method';
    _exp := (_acc->>'expected')::numeric;
    _cnt := round(COALESCE(NULLIF(_counted->>_m, '')::numeric, _exp), 2);
    _settled := 0;
    IF _m <> 'cash' AND COALESCE(_settle, true) AND _cnt > 0 THEN
      INSERT INTO public.cash_movements(shift_id, created_by, direction, amount, source, reference, note, method)
      VALUES (_shift_id, auth.uid(), 'out', _cnt, 'manual', 'Shift close settlement',
              'Closed out ' || _m || ' on shift close', _m::payment_method);
      _settled := _cnt;
    END IF;
    _new_acc := _new_acc || jsonb_build_array(_acc || jsonb_build_object(
      'counted', _cnt, 'variance', round(_cnt - _exp, 2), 'settled', _settled));
    _tot_exp := _tot_exp + _exp; _tot_cnt := _tot_cnt + _cnt; _tot_set := _tot_set + _settled;
  END LOOP;

  -- 3) close the drawer (cash figures stored as before)
  _res := public.close_cash_shift(_shift_id, COALESCE(NULLIF(_counted->>'cash', '')::numeric, (_sum#>>'{accounts,0,expected}')::numeric), _notes);

  -- 4) freeze the summary
  _sum := _sum || jsonb_build_object(
    'status', 'closed',
    'closed_at', (SELECT closed_at FROM public.cash_shifts WHERE id = _shift_id),
    'closed_by', auth.uid(),
    'accounts', _new_acc,
    'totals', jsonb_build_object('expected', _tot_exp, 'counted', _tot_cnt, 'variance', round(_tot_cnt - _tot_exp, 2), 'settled', _tot_set),
    'notes', NULLIF(btrim(_notes), ''));
  UPDATE public.cash_shifts SET close_summary = _sum WHERE id = _shift_id;

  RETURN _res || jsonb_build_object('close_summary', _sum);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_cash_shift_v2(uuid, jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_shift_v2(uuid, jsonb, boolean, text) TO authenticated;
