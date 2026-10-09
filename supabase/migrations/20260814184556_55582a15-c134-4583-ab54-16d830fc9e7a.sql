CREATE OR REPLACE FUNCTION public.cash_shift_summary(_shift_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _s record; _sales numeric:=0; _due_collections numeric:=0; _refunds numeric:=0; _sup numeric:=0; _exp numeric:=0;
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
    COALESCE(SUM(amount) FILTER (WHERE source='sale' AND direction='in' AND COALESCE(note,'') <> 'Due collection'), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='sale' AND direction='in' AND note='Due collection'), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='refund' OR (source='sale' AND direction='out')), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='supplier_payment'), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='expense'), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='manual' AND direction='in'), 0),
    COALESCE(SUM(amount) FILTER (WHERE source='manual' AND direction='out'), 0)
  INTO _sales,_due_collections,_refunds,_sup,_exp,_min,_mout
  FROM public.cash_movements
  WHERE method = 'cash'
    AND (shift_id = _s.id
      OR (shift_id IS NULL AND occurred_at BETWEEN _s.opened_at AND _end));
  RETURN jsonb_build_object(
    'shift_id',_s.id,'status',_s.status,'opened_at',_s.opened_at,'closed_at',_s.closed_at,
    'opening_balance',_s.opening_balance,'cash_sales',_sales,'cash_due_collections',_due_collections,'cash_refunds',_refunds,
    'supplier_payments',_sup,'expenses',_exp,
    'manual_in',_min,'manual_out',_mout,
    'expected_cash', _s.opening_balance + _sales + _due_collections + _min - _refunds - _sup - _exp - _mout,
    'counted_cash',_s.counted_cash,'variance',_s.variance,
    'opening_notes',_s.opening_notes,'closing_notes',_s.closing_notes);
END; $function$;

DROP FUNCTION IF EXISTS public.cash_shift_method_summary(uuid);
CREATE FUNCTION public.cash_shift_method_summary(_shift_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(method text, sales numeric, due_collections numeric, refunds numeric, supplier_payments numeric, manual_in numeric, manual_out numeric, net numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
  WITH cash_pm(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total) AS (
    SELECT 'cash'::text,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='sale' AND cm.direction='in' AND COALESCE(cm.note,'') <> 'Due collection'),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='sale' AND cm.direction='in' AND cm.note='Due collection'),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='refund' OR (cm.source='sale' AND cm.direction='out')),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source IN ('supplier_payment','expense')),0)::numeric,
           0::numeric, 0::numeric
    FROM public.cash_movements cm
    WHERE cm.method = 'cash'
      AND cm.source <> 'manual'
      AND (cm.shift_id = _s.id
        OR (cm.shift_id IS NULL AND cm.occurred_at BETWEEN _s.opened_at AND _end))
  ),
  manual_pm(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total) AS (
    SELECT cm.method::text, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.direction='in'),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.direction='out'),0)::numeric
    FROM public.cash_movements cm
    WHERE cm.source='manual'
      AND (cm.shift_id = _s.id
        OR (cm.shift_id IS NULL AND cm.occurred_at BETWEEN _s.opened_at AND _end))
    GROUP BY cm.method
  ),
  non_cash_payments(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total) AS (
    SELECT p.method::text,
           COALESCE(SUM(CASE WHEN p.amount>=0 AND COALESCE(p.reference,'') NOT LIKE 'Due collection %' THEN p.amount ELSE 0 END),0)::numeric,
           COALESCE(SUM(CASE WHEN p.amount>=0 AND COALESCE(p.reference,'') LIKE 'Due collection %' THEN p.amount ELSE 0 END),0)::numeric,
           COALESCE(SUM(CASE WHEN p.amount<0 THEN -p.amount ELSE 0 END),0)::numeric,
           0::numeric, 0::numeric, 0::numeric
    FROM public.payments p
    WHERE p.method <> 'cash'
      AND p.received_at BETWEEN _s.opened_at AND _end
    GROUP BY p.method
  ),
  non_cash_supplier(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total) AS (
    SELECT sp.method::text, 0::numeric, 0::numeric, 0::numeric,
           COALESCE(SUM(sp.amount),0)::numeric, 0::numeric, 0::numeric
    FROM public.supplier_payments sp
    WHERE sp.method <> 'cash'
      AND sp.created_at BETWEEN _s.opened_at AND _end
    GROUP BY sp.method
  ),
  non_cash_expense(method_name, sale_total, due_total, refund_total, supplier_total, min_total, mout_total) AS (
    SELECT e.method::text, 0::numeric, 0::numeric, 0::numeric,
           COALESCE(SUM(e.amount),0)::numeric, 0::numeric, 0::numeric
    FROM public.expenses e
    WHERE e.method <> 'cash'
      AND e.purchase_invoice_id IS NULL
      AND e.category NOT IN ('Supplier Payment','Purchase')
      AND e.created_at BETWEEN _s.opened_at AND _end
    GROUP BY e.method
  ),
  merged AS (
    SELECT * FROM cash_pm c WHERE c.sale_total <> 0 OR c.due_total <> 0 OR c.refund_total <> 0 OR c.supplier_total <> 0
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
         (SUM(m.sale_total) + SUM(m.due_total) + SUM(m.min_total) - SUM(m.refund_total) - SUM(m.supplier_total) - SUM(m.mout_total))::numeric
  FROM merged m
  GROUP BY m.method_name
  ORDER BY m.method_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cash_shift_method_transactions(_shift_id uuid, _method text)
RETURNS TABLE(kind text, id uuid, occurred_at timestamp with time zone, amount numeric, reference text, party text, note text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _s record; _end timestamptz;
BEGIN
  SELECT * INTO _s FROM public.cash_shifts cs WHERE cs.id=_shift_id;
  IF NOT FOUND THEN RETURN; END IF;
  _end := COALESCE(_s.closed_at, now());

  IF _method = 'cash' THEN
    RETURN QUERY
    SELECT CASE
             WHEN m.source='manual' THEN 'manual_' || m.direction
             WHEN m.source='refund' OR (m.source='sale' AND m.direction='out') THEN 'refund'
             WHEN m.source='supplier_payment' THEN 'supplier_payment'
             WHEN m.source='expense' THEN 'expense'
             WHEN m.source='sale' AND m.direction='in' AND m.note='Due collection' THEN 'due_collection'
             ELSE 'sale'
           END AS kind,
           m.id, m.occurred_at, m.amount, m.reference,
           NULL::text AS party, m.note
    FROM public.cash_movements m
    WHERE m.method = 'cash'
      AND (m.shift_id = _s.id
        OR (m.shift_id IS NULL AND m.occurred_at BETWEEN _s.opened_at AND _end))
      AND m.source IN ('sale','refund','supplier_payment','expense','manual')
    ORDER BY m.occurred_at DESC;
  ELSE
    RETURN QUERY
    SELECT CASE
             WHEN p.amount < 0 THEN 'refund'
             WHEN COALESCE(p.reference,'') LIKE 'Due collection %' THEN 'due_collection'
             ELSE 'sale'
           END AS kind,
           p.id, p.received_at AS occurred_at, ABS(p.amount) AS amount,
           COALESCE(p.reference, s.invoice_no) AS reference,
           NULL::text AS party, NULL::text AS note
    FROM public.payments p JOIN public.sales s ON s.id=p.sale_id
    WHERE p.method::text = _method
      AND p.received_at BETWEEN _s.opened_at AND _end
    UNION ALL
    SELECT 'supplier_payment', sp.id, sp.created_at, sp.amount,
           sp.reference, sup.name, sp.notes
    FROM public.supplier_payments sp
    LEFT JOIN public.suppliers sup ON sup.id=sp.supplier_id
    WHERE sp.method::text = _method
      AND sp.created_at BETWEEN _s.opened_at AND _end
    UNION ALL
    SELECT 'expense', e.id, e.created_at, e.amount, e.category, e.paid_to, e.notes
    FROM public.expenses e
    WHERE e.method::text = _method
      AND e.purchase_invoice_id IS NULL
      AND e.category NOT IN ('Supplier Payment','Purchase')
      AND e.created_at BETWEEN _s.opened_at AND _end
    UNION ALL
    SELECT 'manual_' || m.direction, m.id, m.occurred_at, m.amount, m.reference, NULL::text, m.note
    FROM public.cash_movements m
    WHERE m.source='manual' AND m.method::text = _method
      AND (m.shift_id = _s.id
        OR (m.shift_id IS NULL AND m.occurred_at BETWEEN _s.opened_at AND _end))
    ORDER BY occurred_at DESC;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.cash_shift_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cash_shift_method_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cash_shift_method_transactions(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_shift_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cash_shift_method_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cash_shift_method_transactions(uuid,text) TO authenticated, service_role;