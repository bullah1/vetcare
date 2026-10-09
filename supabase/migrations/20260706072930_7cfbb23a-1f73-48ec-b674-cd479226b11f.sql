
CREATE TABLE IF NOT EXISTS public.cash_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by uuid NOT NULL REFERENCES auth.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_balance numeric NOT NULL DEFAULT 0,
  closed_by uuid REFERENCES auth.users(id),
  closed_at timestamptz,
  expected_cash numeric,
  counted_cash numeric,
  variance numeric,
  status text NOT NULL DEFAULT 'open',
  opening_notes text,
  closing_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_shifts_one_open_per_user
  ON public.cash_shifts(opened_by) WHERE status = 'open';

GRANT SELECT, INSERT, UPDATE ON public.cash_shifts TO authenticated;
GRANT ALL ON public.cash_shifts TO service_role;
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff view own shifts" ON public.cash_shifts FOR SELECT TO authenticated
  USING (opened_by = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "staff manage own shifts" ON public.cash_shifts FOR ALL TO authenticated
  USING (opened_by = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (opened_by = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Open a shift
CREATE OR REPLACE FUNCTION public.open_cash_shift(_opening numeric, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_shifts WHERE opened_by=auth.uid() AND status='open') THEN
    RAISE EXCEPTION 'You already have an open shift';
  END IF;
  INSERT INTO public.cash_shifts(opened_by, opening_balance, opening_notes)
  VALUES (auth.uid(), COALESCE(_opening,0), _notes) RETURNING id INTO _id;
  RETURN _id;
END; $$;

-- Summary for a shift (or current open shift if _shift_id null)
CREATE OR REPLACE FUNCTION public.cash_shift_summary(_shift_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _s record;
  _sales_cash numeric := 0;
  _refunds_cash numeric := 0;
  _supplier_pay_cash numeric := 0;
  _expenses_cash numeric := 0;
  _end timestamptz;
BEGIN
  IF _shift_id IS NULL THEN
    SELECT * INTO _s FROM public.cash_shifts WHERE opened_by=auth.uid() AND status='open' LIMIT 1;
  ELSE
    SELECT * INTO _s FROM public.cash_shifts WHERE id=_shift_id;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _end := COALESCE(_s.closed_at, now());

  -- Cash sales payments (positive) & refunds (negative amounts stored in payments)
  SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0)
    INTO _sales_cash, _refunds_cash
  FROM public.payments p
  JOIN public.sales s ON s.id=p.sale_id
  WHERE p.method='cash' AND s.cashier_id=_s.opened_by
    AND p.created_at BETWEEN _s.opened_at AND _end;

  -- Supplier payments (cash out)
  SELECT COALESCE(SUM(amount),0) INTO _supplier_pay_cash
  FROM public.supplier_payments
  WHERE method='cash' AND created_by=_s.opened_by
    AND created_at BETWEEN _s.opened_at AND _end;

  -- Expenses (cash out) — filter cash method, all users' expenses tied to this window & user is tricky;
  -- Use expenses created by this user
  SELECT COALESCE(SUM(amount),0) INTO _expenses_cash
  FROM public.expenses
  WHERE method='cash'
    AND created_at BETWEEN _s.opened_at AND _end
    AND category NOT IN ('Supplier Payment','Purchase','Purchase Return');

  RETURN jsonb_build_object(
    'shift_id', _s.id,
    'status', _s.status,
    'opened_at', _s.opened_at,
    'closed_at', _s.closed_at,
    'opening_balance', _s.opening_balance,
    'cash_sales', _sales_cash,
    'cash_refunds', _refunds_cash,
    'supplier_payments', _supplier_pay_cash,
    'expenses', _expenses_cash,
    'expected_cash', _s.opening_balance + _sales_cash - _refunds_cash - _supplier_pay_cash - _expenses_cash,
    'counted_cash', _s.counted_cash,
    'variance', _s.variance,
    'opening_notes', _s.opening_notes,
    'closing_notes', _s.closing_notes
  );
END; $$;

-- Close a shift
CREATE OR REPLACE FUNCTION public.close_cash_shift(_shift_id uuid, _counted numeric, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _sum jsonb; _expected numeric; _var numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE id=_shift_id AND opened_by=auth.uid() AND status='open') THEN
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
END; $$;
