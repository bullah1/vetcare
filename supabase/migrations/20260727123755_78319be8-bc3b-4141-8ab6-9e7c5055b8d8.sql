CREATE OR REPLACE FUNCTION public.record_cash_movement(
  _direction text,
  _amount numeric,
  _source text,
  _source_id uuid,
  _reference text DEFAULT NULL::text,
  _note text DEFAULT NULL::text,
  _user uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _sid uuid; _mid uuid;
BEGIN
  _uid := COALESCE(_user, auth.uid());
  IF _uid IS NULL OR _amount IS NULL OR _amount = 0 THEN RETURN NULL; END IF;
  _sid := public.current_open_shift(_uid);

  INSERT INTO public.cash_movements(shift_id, created_by, direction, amount, source, source_id, reference, note)
  VALUES (_sid, _uid, _direction, ABS(_amount), _source, COALESCE(_source_id, gen_random_uuid()), _reference, _note)
  ON CONFLICT (source, source_id) DO UPDATE
    SET shift_id = EXCLUDED.shift_id,
        created_by = EXCLUDED.created_by,
        direction = EXCLUDED.direction,
        amount = EXCLUDED.amount,
        reference = EXCLUDED.reference,
        note = EXCLUDED.note
  RETURNING id INTO _mid;
  RETURN _mid;
END;
$function$;

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
  WITH cash_pm AS (
    SELECT 'cash'::text AS method,
           COALESCE(SUM(amount) FILTER (WHERE source='sale' AND direction='in'),0)::numeric AS sales,
           COALESCE(SUM(amount) FILTER (WHERE source='refund' OR (source='sale' AND direction='out')),0)::numeric AS refunds,
           COALESCE(SUM(amount) FILTER (WHERE source='supplier_payment'),0)::numeric AS sup
    FROM public.cash_movements
    WHERE (shift_id = _s.id
        OR (shift_id IS NULL AND created_by = _s.opened_by AND occurred_at BETWEEN _s.opened_at AND _end))
  ),
  non_cash_payments AS (
    SELECT p.method::text AS method,
           COALESCE(SUM(CASE WHEN p.amount>=0 THEN p.amount ELSE 0 END),0)::numeric AS sales,
           COALESCE(SUM(CASE WHEN p.amount<0 THEN -p.amount ELSE 0 END),0)::numeric AS refunds,
           0::numeric AS sup
    FROM public.payments p
    JOIN public.sales s ON s.id=p.sale_id
    WHERE p.method <> 'cash'
      AND s.cashier_id=_s.opened_by
      AND p.received_at BETWEEN _s.opened_at AND _end
    GROUP BY p.method
  ),
  non_cash_supplier AS (
    SELECT sp.method::text AS method,
           0::numeric AS sales,
           0::numeric AS refunds,
           COALESCE(SUM(sp.amount),0)::numeric AS sup
    FROM public.supplier_payments sp
    WHERE sp.method <> 'cash'
      AND sp.created_by=_s.opened_by
      AND sp.created_at BETWEEN _s.opened_at AND _end
    GROUP BY sp.method
  ),
  merged AS (
    SELECT * FROM cash_pm WHERE sales <> 0 OR refunds <> 0 OR sup <> 0
    UNION ALL SELECT * FROM non_cash_payments
    UNION ALL SELECT * FROM non_cash_supplier
  )
  SELECT m.method,
         SUM(m.sales)::numeric,
         SUM(m.refunds)::numeric,
         SUM(m.sup)::numeric,
         (SUM(m.sales) - SUM(m.refunds) - SUM(m.sup))::numeric AS net
  FROM merged m
  GROUP BY m.method
  ORDER BY m.method;
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
  SELECT * INTO _s FROM public.cash_shifts WHERE id=_shift_id;
  IF NOT FOUND THEN RETURN; END IF;
  _end := COALESCE(_s.closed_at, now());

  IF _method = 'cash' THEN
    RETURN QUERY
    SELECT CASE
             WHEN m.source='refund' OR (m.source='sale' AND m.direction='out') THEN 'refund'
             WHEN m.source='supplier_payment' THEN 'supplier_payment'
             WHEN m.source='expense' THEN 'expense'
             ELSE 'sale'
           END AS kind,
           m.id,
           m.occurred_at,
           m.amount,
           m.reference,
           NULL::text AS party,
           m.note
    FROM public.cash_movements m
    WHERE (m.shift_id = _s.id
        OR (m.shift_id IS NULL AND m.created_by = _s.opened_by AND m.occurred_at BETWEEN _s.opened_at AND _end))
      AND m.source IN ('sale','refund','supplier_payment','expense')
    ORDER BY m.occurred_at DESC;
  ELSE
    RETURN QUERY
    SELECT CASE WHEN p.amount>=0 THEN 'sale' ELSE 'refund' END AS kind,
           p.id,
           p.received_at AS occurred_at,
           ABS(p.amount) AS amount,
           COALESCE(p.reference, s.invoice_no) AS reference,
           NULL::text AS party,
           NULL::text AS note
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
    ORDER BY occurred_at DESC;
  END IF;
END;
$function$;