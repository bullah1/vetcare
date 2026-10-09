CREATE OR REPLACE FUNCTION public.cash_shift_summary(_shift_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s record; _sales numeric:=0; _due_collections numeric:=0; _refunds numeric:=0; _sup numeric:=0; _exp numeric:=0;
        _min numeric:=0; _mout numeric:=0; _cin numeric:=0; _cout numeric:=0; _end timestamptz;
BEGIN
  IF _shift_id IS NULL THEN
    SELECT * INTO _s FROM public.cash_shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1;
  ELSE
    SELECT * INTO _s FROM public.cash_shifts WHERE id=_shift_id;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _end := COALESCE(_s.closed_at, now());
  SELECT
    COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='sale' AND cm.direction='in' AND (sl.status IS NULL OR sl.status <> 'void') AND (sl.id IS NULL OR sl.created_at >= _s.opened_at)), 0),
    COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='sale' AND cm.direction='in' AND sl.status IS NOT NULL AND sl.status <> 'void' AND sl.created_at < _s.opened_at), 0),
    COALESCE(SUM(cm.amount) FILTER (WHERE (cm.source='refund' OR (cm.source='sale' AND cm.direction='out')) AND (sl.status IS NULL OR sl.status <> 'void')), 0),
    COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='supplier_payment'), 0),
    COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='expense'), 0),
    COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='manual' AND cm.direction='in'), 0),
    COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='manual' AND cm.direction='out'), 0),
    COALESCE(SUM(cm.amount) FILTER (WHERE sl.status = 'void' AND cm.direction='in' AND cm.source <> 'manual'), 0),
    COALESCE(SUM(cm.amount) FILTER (WHERE sl.status = 'void' AND cm.direction='out' AND cm.source <> 'manual'), 0)
  INTO _sales,_due_collections,_refunds,_sup,_exp,_min,_mout,_cin,_cout
  FROM public.cash_movements cm
  LEFT JOIN public.payments p ON p.id = cm.source_id
  LEFT JOIN public.sales sl ON sl.id = p.sale_id
  WHERE cm.method = 'cash'
    AND (cm.shift_id = _s.id
      OR (cm.shift_id IS NULL AND cm.occurred_at BETWEEN _s.opened_at AND _end));
  RETURN jsonb_build_object(
    'shift_id',_s.id,'status',_s.status,'opened_at',_s.opened_at,'closed_at',_s.closed_at,
    'opening_balance',_s.opening_balance,'cash_sales',_sales,'cash_due_collections',_due_collections,'cash_refunds',_refunds,
    'supplier_payments',_sup,'expenses',_exp,
    'manual_in',_min,'manual_out',_mout,
    'cancelled_in',_cin,'cancelled_out',_cout,
    'expected_cash', _s.opening_balance + _sales + _due_collections + _min + _cin - _refunds - _cout - _sup - _exp - _mout,
    'counted_cash',_s.counted_cash,'variance',_s.variance,
    'opening_notes',_s.opening_notes,'closing_notes',_s.closing_notes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cash_shift_method_summary(_shift_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(method text, sales numeric, due_collections numeric, refunds numeric, supplier_payments numeric, manual_in numeric, manual_out numeric, cancelled_in numeric, cancelled_out numeric, net numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s record; _end timestamptz;
BEGIN
  IF _shift_id IS NULL THEN
    SELECT * INTO _s FROM public.cash_shifts WHERE status='open' ORDER BY opened_at DESC LIMIT 1;
  ELSE
    SELECT * INTO _s FROM public.cash_shifts WHERE id=_shift_id;
  END IF;
  IF NOT FOUND THEN RETURN; END IF;
  _end := COALESCE(_s.closed_at, now());

  RETURN QUERY
  WITH cash_pm(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total, cin_total, cout_total) AS (
    SELECT 'cash'::text,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='sale' AND cm.direction='in' AND (sl.status IS NULL OR sl.status <> 'void') AND (sl.id IS NULL OR sl.created_at >= _s.opened_at)),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='sale' AND cm.direction='in' AND sl.status IS NOT NULL AND sl.status <> 'void' AND sl.created_at < _s.opened_at),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE (cm.source='refund' OR (cm.source='sale' AND cm.direction='out')) AND (sl.status IS NULL OR sl.status <> 'void')),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source IN ('supplier_payment','expense')),0)::numeric,
           0::numeric, 0::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE sl.status = 'void' AND cm.direction='in'),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE sl.status = 'void' AND cm.direction='out'),0)::numeric
    FROM public.cash_movements cm
    LEFT JOIN public.payments p ON p.id = cm.source_id
    LEFT JOIN public.sales sl ON sl.id = p.sale_id
    WHERE cm.method = 'cash'
      AND cm.source <> 'manual'
      AND (cm.shift_id = _s.id
        OR (cm.shift_id IS NULL AND cm.occurred_at BETWEEN _s.opened_at AND _end))
  ),
  manual_pm(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total, cin_total, cout_total) AS (
    SELECT cm.method::text, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.direction='in'),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.direction='out'),0)::numeric,
           0::numeric, 0::numeric
    FROM public.cash_movements cm
    WHERE cm.source='manual'
      AND (cm.shift_id = _s.id
        OR (cm.shift_id IS NULL AND cm.occurred_at BETWEEN _s.opened_at AND _end))
    GROUP BY cm.method
  ),
  non_cash_payments(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total, cin_total, cout_total) AS (
    SELECT p.method::text,
           COALESCE(SUM(CASE WHEN p.amount>=0 AND (sl.status IS NULL OR sl.status <> 'void') AND (sl.id IS NULL OR sl.created_at >= _s.opened_at) THEN p.amount ELSE 0 END),0)::numeric,
           COALESCE(SUM(CASE WHEN p.amount>=0 AND sl.status IS NOT NULL AND sl.status <> 'void' AND sl.created_at < _s.opened_at THEN p.amount ELSE 0 END),0)::numeric,
           COALESCE(SUM(CASE WHEN p.amount<0 AND (sl.status IS NULL OR sl.status <> 'void') THEN -p.amount ELSE 0 END),0)::numeric,
           0::numeric, 0::numeric, 0::numeric,
           COALESCE(SUM(CASE WHEN p.amount>=0 AND sl.status = 'void' THEN p.amount ELSE 0 END),0)::numeric,
           COALESCE(SUM(CASE WHEN p.amount<0 AND sl.status = 'void' THEN -p.amount ELSE 0 END),0)::numeric
    FROM public.payments p
    LEFT JOIN public.sales sl ON sl.id = p.sale_id
    WHERE p.method <> 'cash'
      AND p.received_at BETWEEN _s.opened_at AND _end
    GROUP BY p.method
  ),
  non_cash_supplier(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total, cin_total, cout_total) AS (
    SELECT sp.method::text, 0::numeric, 0::numeric, 0::numeric,
           COALESCE(SUM(sp.amount),0)::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric
    FROM public.supplier_payments sp
    WHERE sp.method <> 'cash'
      AND sp.created_at BETWEEN _s.opened_at AND _end
    GROUP BY sp.method
  ),
  non_cash_expense(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total, cin_total, cout_total) AS (
    SELECT e.method::text, 0::numeric, 0::numeric, 0::numeric,
           COALESCE(SUM(e.amount),0)::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric
    FROM public.expenses e
    WHERE e.method <> 'cash'
      AND e.purchase_invoice_id IS NULL
      AND e.category NOT IN ('Supplier Payment','Purchase')
      AND e.created_at BETWEEN _s.opened_at AND _end
    GROUP BY e.method
  ),
  merged AS (
    SELECT * FROM cash_pm c WHERE c.sale_total <> 0 OR c.due_total <> 0 OR c.refund_total <> 0 OR c.supplier_total <> 0 OR c.cin_total <> 0 OR c.cout_total <> 0
    UNION ALL SELECT * FROM manual_pm
    UNION ALL SELECT * FROM non_cash_payments
    UNION ALL SELECT * FROM non_cash_supplier
    UNION ALL SELECT * FROM non_cash_expense
  )
  SELECT m.method_name,
         SUM(m.sale_total)::numeric,
         SUM(m.due_total)::numeric,
         SUM(m.refund_total)::numeric,
         SUM(m.supplier_total)::numeric,
         SUM(m.min_total)::numeric,
         SUM(m.mout_total)::numeric,
         SUM(m.cin_total)::numeric,
         SUM(m.cout_total)::numeric,
         (SUM(m.sale_total) + SUM(m.due_total) + SUM(m.min_total) + SUM(m.cin_total) - SUM(m.refund_total) - SUM(m.cout_total) - SUM(m.supplier_total) - SUM(m.mout_total))::numeric
  FROM merged m
  GROUP BY m.method_name
  ORDER BY m.method_name;
END;
$function$;