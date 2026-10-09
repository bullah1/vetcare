
CREATE OR REPLACE FUNCTION public.cash_shift_method_transactions(_shift_id uuid, _method text)
RETURNS TABLE(
  kind text, id uuid, occurred_at timestamptz, amount numeric,
  reference text, party text, note text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _s record; _end timestamptz;
BEGIN
  SELECT * INTO _s FROM public.cash_shifts WHERE id=_shift_id;
  IF NOT FOUND THEN RETURN; END IF;
  _end := COALESCE(_s.closed_at, now());

  RETURN QUERY
  -- Sales & refunds share the payments row; kind depends on sign
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
END; $$;
