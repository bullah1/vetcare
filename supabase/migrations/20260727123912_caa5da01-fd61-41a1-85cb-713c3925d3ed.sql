CREATE OR REPLACE FUNCTION public.cash_shift_method_summary(_shift_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(method text, sales numeric, refunds numeric, supplier_payments numeric, net numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  WITH cash_pm(method_name, sale_total, refund_total, supplier_total) AS (
    SELECT 'cash'::text,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='sale' AND cm.direction='in'),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='refund' OR (cm.source='sale' AND cm.direction='out')),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='supplier_payment'),0)::numeric
    FROM public.cash_movements cm
    WHERE (cm.shift_id = _s.id
        OR (cm.shift_id IS NULL AND cm.created_by = _s.opened_by AND cm.occurred_at BETWEEN _s.opened_at AND _end))
  ),
  non_cash_payments(method_name, sale_total, refund_total, supplier_total) AS (
    SELECT p.method::text,
           COALESCE(SUM(CASE WHEN p.amount>=0 THEN p.amount ELSE 0 END),0)::numeric,
           COALESCE(SUM(CASE WHEN p.amount<0 THEN -p.amount ELSE 0 END),0)::numeric,
           0::numeric
    FROM public.payments p
    JOIN public.sales s ON s.id=p.sale_id
    WHERE p.method <> 'cash'
      AND s.cashier_id=_s.opened_by
      AND p.received_at BETWEEN _s.opened_at AND _end
    GROUP BY p.method
  ),
  non_cash_supplier(method_name, sale_total, refund_total, supplier_total) AS (
    SELECT sp.method::text,
           0::numeric,
           0::numeric,
           COALESCE(SUM(sp.amount),0)::numeric
    FROM public.supplier_payments sp
    WHERE sp.method <> 'cash'
      AND sp.created_by=_s.opened_by
      AND sp.created_at BETWEEN _s.opened_at AND _end
    GROUP BY sp.method
  ),
  merged AS (
    SELECT * FROM cash_pm c WHERE c.sale_total <> 0 OR c.refund_total <> 0 OR c.supplier_total <> 0
    UNION ALL SELECT * FROM non_cash_payments
    UNION ALL SELECT * FROM non_cash_supplier
  )
  SELECT m.method_name,
         SUM(m.sale_total)::numeric,
         SUM(m.refund_total)::numeric,
         SUM(m.supplier_total)::numeric,
         (SUM(m.sale_total) - SUM(m.refund_total) - SUM(m.supplier_total))::numeric
  FROM merged m
  GROUP BY m.method_name
  ORDER BY m.method_name;
END;
$function$;