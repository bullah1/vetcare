-- Cash Close: only cash is counted by hand; digital accounts close at their expected amount.
-- _counted may carry "pending_expense": spending not yet entered as an expense. It is only
-- shown on the close (and the variance after it); it does not create an expense or touch accounts.
CREATE OR REPLACE FUNCTION public.close_cash_shift_v2(_shift_id uuid, _counted jsonb, _settle boolean DEFAULT true, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sh public.cash_shifts%ROWTYPE;
  _sum jsonb; _acc jsonb; _new_acc jsonb := '[]'::jsonb;
  _m text; _exp numeric; _cnt numeric; _settled numeric; _pending numeric;
  _res jsonb; _tot_exp numeric := 0; _tot_cnt numeric := 0; _tot_set numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO _sh FROM public.cash_shifts WHERE id = _shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shift not found'; END IF;
  IF _sh.status <> 'open' THEN RAISE EXCEPTION 'This cash drawer is already closed.'; END IF;
  _pending := round(GREATEST(COALESCE(NULLIF(_counted->>'pending_expense', '')::numeric, 0), 0), 2);

  _sum := public.cash_close_summary(_shift_id);

  FOR _acc IN SELECT * FROM jsonb_array_elements(_sum->'accounts') LOOP
    _m := _acc->>'method';
    _exp := (_acc->>'expected')::numeric;
    IF _m = 'cash' THEN
      _cnt := round(COALESCE(NULLIF(_counted->>'cash', '')::numeric, _exp), 2);
    ELSE
      _cnt := _exp;   -- digital accounts are not counted by hand
    END IF;
    _settled := 0;
    IF _m <> 'cash' AND COALESCE(_settle, true) AND _cnt > 0 THEN
      INSERT INTO public.cash_movements(shift_id, created_by, direction, amount, source, reference, note, method)
      VALUES (_shift_id, auth.uid(), 'out', _cnt, 'manual', 'Shift close settlement',
              'Closed out ' || _m || ' on shift close', _m::payment_method);
      _settled := _cnt;
    END IF;
    _new_acc := _new_acc || jsonb_build_array(_acc || jsonb_build_object(
      'counted', _cnt, 'variance', round(_cnt - _exp, 2), 'settled', _settled)
      || CASE WHEN _m = 'cash' THEN jsonb_build_object('pending_expense', _pending,
           'variance_after_pending', round(_cnt + _pending - _exp, 2)) ELSE '{}'::jsonb END);
    _tot_exp := _tot_exp + _exp; _tot_cnt := _tot_cnt + _cnt; _tot_set := _tot_set + _settled;
  END LOOP;

  _res := public.close_cash_shift(_shift_id, COALESCE(NULLIF(_counted->>'cash', '')::numeric, (_sum#>>'{accounts,0,expected}')::numeric), _notes);

  _sum := _sum || jsonb_build_object(
    'status', 'closed',
    'closed_at', (SELECT closed_at FROM public.cash_shifts WHERE id = _shift_id),
    'closed_by', auth.uid(),
    'accounts', _new_acc,
    'pending_expense', _pending,
    'totals', jsonb_build_object('expected', _tot_exp, 'counted', _tot_cnt, 'variance', round(_tot_cnt - _tot_exp, 2), 'settled', _tot_set),
    'notes', NULLIF(btrim(_notes), ''));
  UPDATE public.cash_shifts SET close_summary = _sum WHERE id = _shift_id;

  RETURN _res || jsonb_build_object('close_summary', _sum);
END;
$function$;
REVOKE ALL ON FUNCTION public.close_cash_shift_v2(uuid, jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_shift_v2(uuid, jsonb, boolean, text) TO authenticated;
