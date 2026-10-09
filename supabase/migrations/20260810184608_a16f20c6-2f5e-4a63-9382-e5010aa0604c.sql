CREATE OR REPLACE FUNCTION public.close_cash_shift(_shift_id uuid, _counted numeric, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _sum jsonb; _expected numeric; _var numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE id=_shift_id AND status='open') THEN
    RAISE EXCEPTION 'shift not found or already closed';
  END IF;
  _sum := public.cash_shift_summary(_shift_id);
  _expected := (_sum->>'expected_cash')::numeric;
  _var := COALESCE(_counted,0) - _expected;
  UPDATE public.cash_shifts
    SET closed_by=auth.uid(), closed_at=now(),
        expected_cash=_expected, counted_cash=COALESCE(_counted,0),
        variance=_var, closing_notes=_notes, status='closed'
    WHERE id=_shift_id;
  RETURN public.cash_shift_summary(_shift_id);
END; $function$;