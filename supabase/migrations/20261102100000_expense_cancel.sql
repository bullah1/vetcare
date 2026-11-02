-- Cancel an expense — only until the cash drawer is closed.
-- Once a cash drawer shift is closed after the expense was entered, the expense
-- is locked: no cancel, no change of amount / method / date.
-- A cancelled expense is removed from accounts and the open drawer, and kept in
-- expense_cancellations (voucher no, amount, reason, who, when).
-- Expenses made by purchases are changed from the purchase, not here.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.expense_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL,
  voucher_no text,
  category text,
  amount numeric(12,2),
  method text,
  paid_to text,
  expense_date date,
  project text,
  expense jsonb NOT NULL,
  reason text,
  cancelled_by uuid DEFAULT auth.uid(),
  cancelled_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.expense_cancellations TO authenticated;
GRANT ALL ON public.expense_cancellations TO service_role;
ALTER TABLE public.expense_cancellations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read expense cancellations" ON public.expense_cancellations;
CREATE POLICY "staff read expense cancellations" ON public.expense_cancellations FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE INDEX IF NOT EXISTS expense_cancellations_at ON public.expense_cancellations (cancelled_at);

-- Locked = a cash drawer shift was closed at or after the expense was entered.
CREATE OR REPLACE FUNCTION public.expense_locked(_created_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.cash_shifts c WHERE c.status = 'closed' AND c.closed_at >= _created_at)
     AND COALESCE(current_setting('app.allow_locked_edit', true), '') <> 'on';
$$;
GRANT EXECUTE ON FUNCTION public.expense_locked(timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_lock_closed_expenses()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _msg text := 'The cash drawer for this expense is closed — it cannot be cancelled or changed.';
BEGIN
  -- Purchase expenses follow their purchase invoice.
  IF OLD.purchase_invoice_id IS NOT NULL OR OLD.category IN ('Supplier Payment','Purchase') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF public.expense_locked(OLD.created_at) THEN RAISE EXCEPTION '%', _msg; END IF;
    RETURN OLD;
  END IF;
  IF (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.method IS DISTINCT FROM OLD.method
      OR NEW.expense_date IS DISTINCT FROM OLD.expense_date)
     AND public.expense_locked(OLD.created_at) THEN
    RAISE EXCEPTION '%', _msg;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS lock_closed_expenses ON public.expenses;
CREATE TRIGGER lock_closed_expenses BEFORE UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_lock_closed_expenses();

CREATE OR REPLACE FUNCTION public.cancel_expense(_expense_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.expenses%ROWTYPE; _j jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO _e FROM public.expenses WHERE id = _expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found — it may already be cancelled.'; END IF;
  IF _e.purchase_invoice_id IS NOT NULL OR _e.category IN ('Supplier Payment','Purchase') THEN
    RAISE EXCEPTION 'This expense comes from a purchase — change or delete the purchase instead.';
  END IF;
  IF public.expense_locked(_e.created_at) THEN
    RAISE EXCEPTION 'The cash drawer for this expense is closed — it cannot be cancelled.';
  END IF;

  _j := to_jsonb(_e);
  INSERT INTO public.expense_cancellations(expense_id, voucher_no, category, amount, method, paid_to, expense_date, project, expense, reason)
  VALUES (_e.id, _j->>'voucher_no', _e.category, _e.amount, _e.method::text, _e.paid_to, _e.expense_date, _j->>'project',
          _j, NULLIF(btrim(_reason), ''));
  -- Gives the cash back to the open drawer.
  DELETE FROM public.cash_movements WHERE source = 'expense' AND source_id = _e.id;
  DELETE FROM public.expenses WHERE id = _e.id;
  RETURN jsonb_build_object('cancelled', true, 'voucher_no', _j->>'voucher_no', 'amount', _e.amount);
END; $$;
REVOKE ALL ON FUNCTION public.cancel_expense(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_expense(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
