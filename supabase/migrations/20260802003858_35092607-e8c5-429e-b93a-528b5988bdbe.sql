CREATE OR REPLACE FUNCTION public.account_balances(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE(method text, inflow numeric, outflow numeric, balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH parts AS (
    -- sales payments (in) and refunds (out)
    SELECT p.method::text AS m,
           SUM(CASE WHEN p.amount >= 0 THEN p.amount ELSE 0 END) AS inn,
           SUM(CASE WHEN p.amount < 0 THEN -p.amount ELSE 0 END) AS outt
    FROM public.payments p
    WHERE (_from IS NULL OR p.received_at >= _from::timestamptz)
      AND (_to IS NULL OR p.received_at < (_to + 1)::timestamptz)
    GROUP BY p.method

    UNION ALL
    -- supplier payments (out)
    SELECT sp.method::text, 0, SUM(sp.amount)
    FROM public.supplier_payments sp
    WHERE (_from IS NULL OR sp.paid_at >= _from)
      AND (_to IS NULL OR sp.paid_at <= _to)
    GROUP BY sp.method

    UNION ALL
    -- expenses (out), excluding purchase-invoice rows already covered by supplier payments
    SELECT e.method::text,
           SUM(CASE WHEN e.amount < 0 THEN -e.amount ELSE 0 END),
           SUM(CASE WHEN e.amount >= 0 THEN e.amount ELSE 0 END)
    FROM public.expenses e
    WHERE e.purchase_invoice_id IS NULL
      AND e.category NOT IN ('Supplier Payment', 'Purchase')
      AND (_from IS NULL OR e.expense_date >= _from)
      AND (_to IS NULL OR e.expense_date <= _to)
    GROUP BY e.method

    UNION ALL
    -- manual cash movements
    SELECT cm.method::text,
           SUM(CASE WHEN cm.direction = 'in' THEN cm.amount ELSE 0 END),
           SUM(CASE WHEN cm.direction = 'out' THEN cm.amount ELSE 0 END)
    FROM public.cash_movements cm
    WHERE cm.source = 'manual'
      AND (_from IS NULL OR cm.occurred_at >= _from::timestamptz)
      AND (_to IS NULL OR cm.occurred_at < (_to + 1)::timestamptz)
    GROUP BY cm.method
  )
  SELECT m,
         COALESCE(SUM(inn),0)::numeric,
         COALESCE(SUM(outt),0)::numeric,
         (COALESCE(SUM(inn),0) - COALESCE(SUM(outt),0))::numeric
  FROM parts
  WHERE public.is_staff(auth.uid())
  GROUP BY m
  ORDER BY m;
$$;

REVOKE ALL ON FUNCTION public.account_balances(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_balances(date, date) TO authenticated;