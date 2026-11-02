-- Expense vouchers: every expense gets its own voucher number EXP-YYYYMM-#####,
-- given by the database (also for expenses made by purchases / stock write-offs).
-- Optional ref_no keeps the shop's / biller's own receipt number.
-- Old expenses get numbers in the order they were entered. Safe to run more than once.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS voucher_no text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS ref_no text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

CREATE SEQUENCE IF NOT EXISTS public.expense_voucher_seq;
GRANT USAGE, SELECT ON SEQUENCE public.expense_voucher_seq TO authenticated;

-- Number old expenses (oldest first), then continue the sequence after them.
WITH n AS (
  SELECT id, created_at, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.expenses WHERE voucher_no IS NULL
), base AS (SELECT COALESCE((SELECT last_value FROM public.expense_voucher_seq WHERE is_called), 0) AS b)
UPDATE public.expenses e
SET voucher_no = 'EXP-' || to_char(n.created_at AT TIME ZONE 'Asia/Dhaka', 'YYYYMM') || '-' || lpad((base.b + n.rn)::text, 5, '0')
FROM n, base WHERE e.id = n.id;

SELECT setval('public.expense_voucher_seq',
  GREATEST(COALESCE((SELECT max(NULLIF(split_part(voucher_no, '-', 3), '')::bigint) FROM public.expenses WHERE voucher_no ~ '^EXP-\d{6}-\d+$'), 0), 1),
  EXISTS (SELECT 1 FROM public.expenses WHERE voucher_no ~ '^EXP-\d{6}-\d+$'));

CREATE OR REPLACE FUNCTION public.trg_expense_voucher()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.voucher_no IS NULL OR btrim(NEW.voucher_no) = '' THEN
    NEW.voucher_no := 'EXP-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYYMM') || '-'
      || lpad(nextval('public.expense_voucher_seq')::text, 5, '0');
  END IF;
  NEW.ref_no := NULLIF(btrim(NEW.ref_no), '');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS expense_voucher ON public.expenses;
CREATE TRIGGER expense_voucher BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_expense_voucher();

-- Voucher number never changes after it is given.
CREATE OR REPLACE FUNCTION public.trg_expense_voucher_keep()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.voucher_no := OLD.voucher_no;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS expense_voucher_keep ON public.expenses;
CREATE TRIGGER expense_voucher_keep BEFORE UPDATE OF voucher_no ON public.expenses
  FOR EACH ROW WHEN (OLD.voucher_no IS NOT NULL) EXECUTE FUNCTION public.trg_expense_voucher_keep();

CREATE UNIQUE INDEX IF NOT EXISTS expenses_voucher_no_key ON public.expenses (voucher_no);

NOTIFY pgrst, 'reload schema';
