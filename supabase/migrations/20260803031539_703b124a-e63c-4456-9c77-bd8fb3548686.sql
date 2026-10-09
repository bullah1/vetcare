CREATE OR REPLACE FUNCTION public.account_flows(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE(method text, received numeric, refunded numeric, other_in numeric, other_out numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH parts AS (
    SELECT p.method::text AS m,
           SUM(CASE WHEN p.amount >= 0 THEN p.amount ELSE 0 END) AS rec,
           SUM(CASE WHEN p.amount < 0 THEN -p.amount ELSE 0 END) AS ref,
           0::numeric AS oin, 0::numeric AS oout
    FROM public.payments p
    WHERE (_from IS NULL OR p.received_at >= _from::timestamptz)
      AND (_to IS NULL OR p.received_at < (_to + 1)::timestamptz)
    GROUP BY p.method

    UNION ALL
    SELECT sp.method::text, 0, 0, 0, SUM(sp.amount)
    FROM public.supplier_payments sp
    WHERE (_from IS NULL OR sp.paid_at >= _from)
      AND (_to IS NULL OR sp.paid_at <= _to)
    GROUP BY sp.method

    UNION ALL
    SELECT e.method::text, 0, 0,
           SUM(CASE WHEN e.amount < 0 THEN -e.amount ELSE 0 END),
           SUM(CASE WHEN e.amount >= 0 THEN e.amount ELSE 0 END)
    FROM public.expenses e
    WHERE e.purchase_invoice_id IS NULL
      AND e.category NOT IN ('Supplier Payment', 'Purchase')
      AND (_from IS NULL OR e.expense_date >= _from)
      AND (_to IS NULL OR e.expense_date <= _to)
    GROUP BY e.method

    UNION ALL
    SELECT cm.method::text, 0, 0,
           SUM(CASE WHEN cm.direction = 'in' THEN cm.amount ELSE 0 END),
           SUM(CASE WHEN cm.direction = 'out' THEN cm.amount ELSE 0 END)
    FROM public.cash_movements cm
    WHERE cm.source = 'manual'
      AND (_from IS NULL OR cm.occurred_at >= _from::timestamptz)
      AND (_to IS NULL OR cm.occurred_at < (_to + 1)::timestamptz)
    GROUP BY cm.method
  )
  SELECT m,
         COALESCE(SUM(rec),0)::numeric,
         COALESCE(SUM(ref),0)::numeric,
         COALESCE(SUM(oin),0)::numeric,
         COALESCE(SUM(oout),0)::numeric
  FROM parts
  WHERE public.is_staff(auth.uid())
  GROUP BY m
  ORDER BY m;
$$;

REVOKE ALL ON FUNCTION public.account_flows(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_flows(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.account_balances_breakdown(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE(method text, opening numeric, received numeric, refunded numeric, other_in numeric, other_out numeric, closing numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cur AS (
    SELECT * FROM public.account_flows(_from, _to)
  ), prev AS (
    SELECT * FROM public.account_flows(NULL, CASE WHEN _from IS NULL THEN NULL ELSE (_from - 1) END)
  ), ms AS (
    SELECT method FROM cur UNION SELECT method FROM prev
  )
  SELECT ms.method,
         CASE WHEN _from IS NULL THEN 0::numeric
              ELSE COALESCE(p.received,0) - COALESCE(p.refunded,0) + COALESCE(p.other_in,0) - COALESCE(p.other_out,0)
         END AS opening,
         COALESCE(c.received,0),
         COALESCE(c.refunded,0),
         COALESCE(c.other_in,0),
         COALESCE(c.other_out,0),
         (CASE WHEN _from IS NULL THEN 0::numeric
               ELSE COALESCE(p.received,0) - COALESCE(p.refunded,0) + COALESCE(p.other_in,0) - COALESCE(p.other_out,0)
          END
          + COALESCE(c.received,0) - COALESCE(c.refunded,0) + COALESCE(c.other_in,0) - COALESCE(c.other_out,0))::numeric AS closing
  FROM ms
  LEFT JOIN cur c ON c.method = ms.method
  LEFT JOIN prev p ON p.method = ms.method
  ORDER BY ms.method;
$$;

REVOKE ALL ON FUNCTION public.account_balances_breakdown(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_balances_breakdown(date, date) TO authenticated;