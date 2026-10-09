-- Fix over-recorded cash (change returned to customer was logged as drawer cash)
WITH over AS (
  SELECT p.id AS payment_id, s.id AS sale_id, s.total, p.amount
  FROM public.payments p
  JOIN public.sales s ON s.id = p.sale_id
  WHERE s.invoice_no IN ('INV-202607-01056','INV-202607-01061','INV-202607-01062')
    AND p.amount > s.total
)
UPDATE public.payments p
SET amount = o.total
FROM over o
WHERE p.id = o.payment_id;

UPDATE public.cash_movements m
SET amount = s.total
FROM public.payments p
JOIN public.sales s ON s.id = p.sale_id
WHERE m.source = 'sale' AND m.source_id = p.id
  AND s.invoice_no IN ('INV-202607-01056','INV-202607-01061','INV-202607-01062')
  AND m.amount <> s.total;

UPDATE public.sales s
SET paid = sub.paid, due = GREATEST(s.total - sub.paid, 0)
FROM (SELECT sale_id, COALESCE(SUM(amount),0) AS paid FROM public.payments GROUP BY sale_id) sub
WHERE s.id = sub.sale_id
  AND s.invoice_no IN ('INV-202607-01056','INV-202607-01061','INV-202607-01062');