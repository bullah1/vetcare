
CREATE OR REPLACE FUNCTION public.cash_shift_method_summary(_shift_id uuid DEFAULT NULL)
RETURNS TABLE(method text, sales numeric, refunds numeric, supplier_payments numeric, net numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _s record; _end timestamptz;
BEGIN
  IF _shift_id IS NULL THEN
    SELECT * INTO _s FROM public.cash_shifts WHERE opened_by=auth.uid() AND status='open' LIMIT 1;
  ELSE
    SELECT * INTO _s FROM public.cash_shifts WHERE id=_shift_id;
  END IF;
  IF NOT FOUND THEN RETURN; END IF;
  _end := COALESCE(_s.closed_at, now());

  RETURN QUERY
  WITH pm AS (
    SELECT p.method::text AS method,
           COALESCE(SUM(CASE WHEN p.amount>=0 THEN p.amount ELSE 0 END),0) AS sales,
           COALESCE(SUM(CASE WHEN p.amount<0 THEN -p.amount ELSE 0 END),0) AS refunds,
           0::numeric AS sup
    FROM public.payments p JOIN public.sales s ON s.id=p.sale_id
    WHERE s.cashier_id=_s.opened_by AND p.received_at BETWEEN _s.opened_at AND _end
    GROUP BY p.method
  ),
  sp AS (
    SELECT sp.method::text AS method, 0::numeric AS sales, 0::numeric AS refunds,
           COALESCE(SUM(sp.amount),0) AS sup
    FROM public.supplier_payments sp
    WHERE sp.created_by=_s.opened_by AND sp.created_at BETWEEN _s.opened_at AND _end
    GROUP BY sp.method
  ),
  merged AS (SELECT * FROM pm UNION ALL SELECT * FROM sp)
  SELECT m.method,
         SUM(m.sales)::numeric,
         SUM(m.refunds)::numeric,
         SUM(m.sup)::numeric,
         (SUM(m.sales) - SUM(m.refunds) - SUM(m.sup))::numeric AS net
  FROM merged m
  GROUP BY m.method
  ORDER BY m.method;
END; $$;
