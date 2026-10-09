CREATE OR REPLACE FUNCTION public.current_open_shift(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id FROM public.cash_shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.cash_shift_summary(_shift_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s record; _sales numeric:=0; _refunds numeric:=0; _sup numeric:=0; _exp numeric:=0;
        _min numeric:=0; _mout numeric:=0; _end timestamptz;
BEGIN
  IF _shift_id IS NULL THEN
    SELECT * INTO _s FROM public.cash_shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1;
  ELSE
    SELECT * INTO _s FROM public.cash_shifts WHERE id=_shift_id;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _end := COALESCE(_s.closed_at, now());
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE source='sale' AND direction='in'), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='refund' OR (source='sale' AND direction='out')), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='supplier_payment'), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='expense'), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='manual' AND direction='in' AND method='cash'), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='manual' AND direction='out' AND method='cash'), 0)
  INTO _sales,_refunds,_sup,_exp,_min,_mout
  FROM public.cash_movements
  WHERE (shift_id = _s.id
      OR (shift_id IS NULL AND occurred_at BETWEEN _s.opened_at AND _end));
  RETURN jsonb_build_object(
    'shift_id',_s.id,'status',_s.status,'opened_at',_s.opened_at,'closed_at',_s.closed_at,
    'opening_balance',_s.opening_balance,'cash_sales',_sales,'cash_refunds',_refunds,
    'supplier_payments',_sup,'expenses',_exp,
    'manual_in',_min,'manual_out',_mout,
    'expected_cash', _s.opening_balance + _sales + _min - _refunds - _sup - _exp - _mout,
    'counted_cash',_s.counted_cash,'variance',_s.variance,
    'opening_notes',_s.opening_notes,'closing_notes',_s.closing_notes);
END; $function$;