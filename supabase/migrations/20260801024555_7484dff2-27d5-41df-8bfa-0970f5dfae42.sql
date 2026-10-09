ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS method payment_method NOT NULL DEFAULT 'cash';

-- allow manual source
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_movements_source_check') THEN
    ALTER TABLE public.cash_movements DROP CONSTRAINT cash_movements_source_check;
  END IF;
END $$;

-- ============ manual cash entry ============
CREATE OR REPLACE FUNCTION public.record_manual_cash(
  _direction text,
  _amount numeric,
  _method payment_method DEFAULT 'cash',
  _reason text DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _sid uuid; _mid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in or out'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount must be greater than 0'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'reason is required'; END IF;

  _sid := public.current_open_shift(auth.uid());
  IF _sid IS NULL THEN RAISE EXCEPTION 'open a cash shift first'; END IF;

  INSERT INTO public.cash_movements(shift_id, created_by, direction, amount, source, source_id, reference, note, method)
  VALUES (_sid, auth.uid(), _direction, ABS(_amount), 'manual', gen_random_uuid(), btrim(_reason), NULLIF(btrim(COALESCE(_note,'')),''), COALESCE(_method,'cash'))
  RETURNING id INTO _mid;

  RETURN jsonb_build_object('movement_id', _mid, 'shift_id', _sid);
END; $$;

REVOKE ALL ON FUNCTION public.record_manual_cash(text, numeric, payment_method, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_manual_cash(text, numeric, payment_method, text, text) TO authenticated;

-- ============ shift summary incl. manual (cash only affects drawer) ============
CREATE OR REPLACE FUNCTION public.cash_shift_summary(_shift_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _s record; _sales numeric:=0; _refunds numeric:=0; _sup numeric:=0; _exp numeric:=0;
        _min numeric:=0; _mout numeric:=0; _end timestamptz;
BEGIN
  IF _shift_id IS NULL THEN
    SELECT * INTO _s FROM public.cash_shifts WHERE opened_by=auth.uid() AND status='open' LIMIT 1;
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
      OR (shift_id IS NULL AND created_by = _s.opened_by AND occurred_at BETWEEN _s.opened_at AND _end));
  RETURN jsonb_build_object(
    'shift_id',_s.id,'status',_s.status,'opened_at',_s.opened_at,'closed_at',_s.closed_at,
    'opening_balance',_s.opening_balance,'cash_sales',_sales,'cash_refunds',_refunds,
    'supplier_payments',_sup,'expenses',_exp,
    'manual_in',_min,'manual_out',_mout,
    'expected_cash', _s.opening_balance + _sales + _min - _refunds - _sup - _exp - _mout,
    'counted_cash',_s.counted_cash,'variance',_s.variance,
    'opening_notes',_s.opening_notes,'closing_notes',_s.closing_notes);
END; $function$;

-- ============ per-method summary incl. manual ============
DROP FUNCTION IF EXISTS public.cash_shift_method_summary(uuid);
CREATE FUNCTION public.cash_shift_method_summary(_shift_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(method text, sales numeric, refunds numeric, supplier_payments numeric, manual_in numeric, manual_out numeric, net numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
  WITH cash_pm(method_name, sale_total, refund_total, supplier_total, min_total, mout_total) AS (
    SELECT 'cash'::text,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='sale' AND cm.direction='in'),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='refund' OR (cm.source='sale' AND cm.direction='out')),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.source='supplier_payment' OR cm.source='expense'),0)::numeric,
           0::numeric, 0::numeric
    FROM public.cash_movements cm
    WHERE (cm.shift_id = _s.id
        OR (cm.shift_id IS NULL AND cm.created_by = _s.opened_by AND cm.occurred_at BETWEEN _s.opened_at AND _end))
  ),
  manual_pm(method_name, sale_total, refund_total, supplier_total, min_total, mout_total) AS (
    SELECT cm.method::text, 0::numeric, 0::numeric, 0::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.direction='in'),0)::numeric,
           COALESCE(SUM(cm.amount) FILTER (WHERE cm.direction='out'),0)::numeric
    FROM public.cash_movements cm
    WHERE cm.source='manual'
      AND (cm.shift_id = _s.id
        OR (cm.shift_id IS NULL AND cm.created_by = _s.opened_by AND cm.occurred_at BETWEEN _s.opened_at AND _end))
    GROUP BY cm.method
  ),
  non_cash_payments(method_name, sale_total, refund_total, supplier_total, min_total, mout_total) AS (
    SELECT p.method::text,
           COALESCE(SUM(CASE WHEN p.amount>=0 THEN p.amount ELSE 0 END),0)::numeric,
           COALESCE(SUM(CASE WHEN p.amount<0 THEN -p.amount ELSE 0 END),0)::numeric,
           0::numeric, 0::numeric, 0::numeric
    FROM public.payments p
    JOIN public.sales s ON s.id=p.sale_id
    WHERE p.method <> 'cash'
      AND s.cashier_id=_s.opened_by
      AND p.received_at BETWEEN _s.opened_at AND _end
    GROUP BY p.method
  ),
  non_cash_supplier(method_name, sale_total, refund_total, supplier_total, min_total, mout_total) AS (
    SELECT sp.method::text, 0::numeric, 0::numeric,
           COALESCE(SUM(sp.amount),0)::numeric, 0::numeric, 0::numeric
    FROM public.supplier_payments sp
    WHERE sp.method <> 'cash'
      AND sp.created_by=_s.opened_by
      AND sp.created_at BETWEEN _s.opened_at AND _end
    GROUP BY sp.method
  ),
  merged AS (
    SELECT * FROM cash_pm c WHERE c.sale_total <> 0 OR c.refund_total <> 0 OR c.supplier_total <> 0
    UNION ALL SELECT * FROM manual_pm
    UNION ALL SELECT * FROM non_cash_payments
    UNION ALL SELECT * FROM non_cash_supplier
  )
  SELECT m.method_name,
         SUM(m.sale_total)::numeric,
         SUM(m.refund_total)::numeric,
         SUM(m.supplier_total)::numeric,
         SUM(m.min_total)::numeric,
         SUM(m.mout_total)::numeric,
         (SUM(m.sale_total) + SUM(m.min_total) - SUM(m.refund_total) - SUM(m.supplier_total) - SUM(m.mout_total))::numeric
  FROM merged m
  GROUP BY m.method_name
  ORDER BY m.method_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.cash_shift_method_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_shift_method_summary(uuid) TO authenticated;

-- ============ per-method transactions incl. manual ============
CREATE OR REPLACE FUNCTION public.cash_shift_method_transactions(_shift_id uuid, _method text)
 RETURNS TABLE(kind text, id uuid, occurred_at timestamp with time zone, amount numeric, reference text, party text, note text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
             ELSE 'sale'
           END AS kind,
           m.id, m.occurred_at, m.amount, m.reference,
           NULL::text AS party, m.note
    FROM public.cash_movements m
    WHERE (m.shift_id = _s.id
        OR (m.shift_id IS NULL AND m.created_by = _s.opened_by AND m.occurred_at BETWEEN _s.opened_at AND _end))
      AND m.source IN ('sale','refund','supplier_payment','expense','manual')
      AND (m.source <> 'manual' OR m.method = 'cash')
    ORDER BY m.occurred_at DESC;
  ELSE
    RETURN QUERY
    SELECT CASE WHEN p.amount>=0 THEN 'sale' ELSE 'refund' END AS kind,
           p.id, p.received_at AS occurred_at, ABS(p.amount) AS amount,
           COALESCE(p.reference, s.invoice_no) AS reference,
           NULL::text AS party, NULL::text AS note
    FROM public.payments p JOIN public.sales s ON s.id=p.sale_id
    WHERE p.method::text = _method
      AND s.cashier_id = _s.opened_by
      AND p.received_at BETWEEN _s.opened_at AND _end
    UNION ALL
    SELECT 'supplier_payment', sp.id, sp.created_at, sp.amount,
           sp.reference, sup.name, sp.notes
    FROM public.supplier_payments sp
    LEFT JOIN public.suppliers sup ON sup.id=sp.supplier_id
    WHERE sp.method::text = _method
      AND sp.created_by = _s.opened_by
      AND sp.created_at BETWEEN _s.opened_at AND _end
    UNION ALL
    SELECT 'manual_' || m.direction, m.id, m.occurred_at, m.amount, m.reference, NULL::text, m.note
    FROM public.cash_movements m
    WHERE m.source='manual' AND m.method::text = _method
      AND (m.shift_id = _s.id
        OR (m.shift_id IS NULL AND m.created_by = _s.opened_by AND m.occurred_at BETWEEN _s.opened_at AND _end))
    ORDER BY occurred_at DESC;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.cash_shift_method_transactions(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_shift_method_transactions(uuid, text) TO authenticated;