
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid REFERENCES public.cash_shifts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  amount numeric NOT NULL CHECK (amount >= 0),
  source text NOT NULL,
  source_id uuid NOT NULL DEFAULT gen_random_uuid(),
  reference text,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_cash_movements_source UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON public.cash_movements(shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_user_time ON public.cash_movements(created_by, occurred_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_movements TO authenticated;
GRANT ALL ON public.cash_movements TO service_role;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view own or admin" ON public.cash_movements FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "insert own" ON public.cash_movements FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.current_open_shift(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.cash_shifts WHERE opened_by=_user_id AND status='open' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.record_cash_movement(
  _direction text, _amount numeric, _source text, _source_id uuid,
  _reference text DEFAULT NULL, _note text DEFAULT NULL, _user uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid uuid; _sid uuid; _mid uuid;
BEGIN
  _uid := COALESCE(_user, auth.uid());
  IF _uid IS NULL OR _amount IS NULL OR _amount = 0 THEN RETURN NULL; END IF;
  _sid := public.current_open_shift(_uid);
  INSERT INTO public.cash_movements(shift_id, created_by, direction, amount, source, source_id, reference, note)
  VALUES (_sid, _uid, _direction, ABS(_amount), _source, COALESCE(_source_id, gen_random_uuid()), _reference, _note)
  ON CONFLICT (source, source_id) DO UPDATE
    SET amount = EXCLUDED.amount, direction = EXCLUDED.direction,
        reference = EXCLUDED.reference, note = EXCLUDED.note
  RETURNING id INTO _mid;
  RETURN _mid;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_payments_cash()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _cashier uuid; _inv text;
BEGIN
  IF NEW.method <> 'cash' THEN RETURN NEW; END IF;
  SELECT cashier_id, invoice_no INTO _cashier, _inv FROM public.sales WHERE id = NEW.sale_id;
  PERFORM public.record_cash_movement(
    CASE WHEN NEW.amount >= 0 THEN 'in' ELSE 'out' END,
    NEW.amount, CASE WHEN NEW.amount >= 0 THEN 'sale' ELSE 'refund' END,
    NEW.id, COALESCE(NEW.reference, _inv), NULL, _cashier
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS payments_cash_sync ON public.payments;
CREATE TRIGGER payments_cash_sync AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_payments_cash();

CREATE OR REPLACE FUNCTION public.trg_supplier_payments_cash()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.method <> 'cash' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;
  PERFORM public.record_cash_movement(
    CASE WHEN NEW.amount >= 0 THEN 'out' ELSE 'in' END,
    NEW.amount, 'supplier_payment', NEW.id, NEW.reference, NEW.notes, NEW.created_by
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS supplier_payments_cash_sync ON public.supplier_payments;
CREATE TRIGGER supplier_payments_cash_sync AFTER INSERT ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_supplier_payments_cash();

CREATE OR REPLACE FUNCTION public.trg_expenses_cash()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.method <> 'cash' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;
  IF NEW.category = 'Supplier Payment' THEN RETURN NEW; END IF;
  PERFORM public.record_cash_movement(
    CASE WHEN NEW.amount >= 0 THEN 'out' ELSE 'in' END,
    NEW.amount, 'expense', NEW.id, NEW.paid_to,
    COALESCE(NEW.category,'') || CASE WHEN NEW.notes IS NOT NULL THEN ' — '||NEW.notes ELSE '' END,
    auth.uid()
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS expenses_cash_sync ON public.expenses;
CREATE TRIGGER expenses_cash_sync AFTER INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_expenses_cash();

INSERT INTO public.cash_movements(shift_id, created_by, direction, amount, source, source_id, reference, occurred_at)
SELECT NULL, s.cashier_id,
  CASE WHEN p.amount>=0 THEN 'in' ELSE 'out' END,
  ABS(p.amount),
  CASE WHEN p.amount>=0 THEN 'sale' ELSE 'refund' END,
  p.id, COALESCE(p.reference, s.invoice_no), p.received_at
FROM public.payments p JOIN public.sales s ON s.id=p.sale_id
WHERE p.method='cash' AND p.received_at > now() - interval '90 days'
ON CONFLICT (source, source_id) DO NOTHING;

INSERT INTO public.cash_movements(shift_id, created_by, direction, amount, source, source_id, reference, occurred_at)
SELECT NULL, sp.created_by, 'out', ABS(sp.amount), 'supplier_payment', sp.id, sp.reference, sp.created_at
FROM public.supplier_payments sp
WHERE sp.method='cash' AND sp.created_at > now() - interval '90 days'
ON CONFLICT (source, source_id) DO NOTHING;

INSERT INTO public.cash_movements(shift_id, created_by, direction, amount, source, source_id, reference, occurred_at)
SELECT NULL, NULL, 'out', ABS(e.amount), 'expense', e.id, e.paid_to, e.created_at
FROM public.expenses e
WHERE e.method='cash' AND e.category <> 'Supplier Payment' AND e.created_at > now() - interval '90 days'
ON CONFLICT (source, source_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cash_shift_summary(_shift_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _s record; _sales numeric:=0; _refunds numeric:=0; _sup numeric:=0; _exp numeric:=0; _end timestamptz;
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
    COALESCE(SUM(amount) FILTER (WHERE source='expense'), 0)
  INTO _sales,_refunds,_sup,_exp
  FROM public.cash_movements
  WHERE (shift_id = _s.id
      OR (shift_id IS NULL AND created_by = _s.opened_by AND occurred_at BETWEEN _s.opened_at AND _end));
  RETURN jsonb_build_object(
    'shift_id',_s.id,'status',_s.status,'opened_at',_s.opened_at,'closed_at',_s.closed_at,
    'opening_balance',_s.opening_balance,'cash_sales',_sales,'cash_refunds',_refunds,
    'supplier_payments',_sup,'expenses',_exp,
    'expected_cash', _s.opening_balance + _sales - _refunds - _sup - _exp,
    'counted_cash',_s.counted_cash,'variance',_s.variance,
    'opening_notes',_s.opening_notes,'closing_notes',_s.closing_notes);
END; $$;

CREATE OR REPLACE FUNCTION public.cash_shift_movements(_shift_id uuid)
RETURNS SETOF public.cash_movements
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT m.* FROM public.cash_movements m
  JOIN public.cash_shifts s ON s.id=_shift_id
  WHERE (m.shift_id=s.id
      OR (m.shift_id IS NULL AND m.created_by=s.opened_by
          AND m.occurred_at BETWEEN s.opened_at AND COALESCE(s.closed_at, now())))
  ORDER BY m.occurred_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.trg_shift_open_attach()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='open' THEN
    UPDATE public.cash_movements SET shift_id=NEW.id
      WHERE shift_id IS NULL AND created_by=NEW.opened_by AND occurred_at >= NEW.opened_at;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS shift_open_attach ON public.cash_shifts;
CREATE TRIGGER shift_open_attach AFTER INSERT ON public.cash_shifts
  FOR EACH ROW EXECUTE FUNCTION public.trg_shift_open_attach();
