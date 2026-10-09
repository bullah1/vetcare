
DO $$ BEGIN
  CREATE TYPE public.stock_adjustment_reason AS ENUM ('damage','loss','found','correction','expired','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity_change numeric NOT NULL,
  reason public.stock_adjustment_reason NOT NULL DEFAULT 'correction',
  notes text,
  before_qty numeric,
  after_qty numeric,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stock_adjustments TO authenticated;
GRANT ALL ON public.stock_adjustments TO service_role;

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff view adjustments" ON public.stock_adjustments
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff insert adjustments" ON public.stock_adjustments
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "admin delete adjustments" ON public.stock_adjustments
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS stock_adjustments_product_idx ON public.stock_adjustments(product_id);
CREATE INDEX IF NOT EXISTS stock_adjustments_created_idx ON public.stock_adjustments(created_at DESC);

CREATE OR REPLACE FUNCTION public.adjust_stock(
  _product_id uuid,
  _quantity_change numeric,
  _reason public.stock_adjustment_reason DEFAULT 'correction',
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _before numeric; _after numeric; _adj_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _quantity_change IS NULL OR _quantity_change = 0 THEN RAISE EXCEPTION 'quantity change required'; END IF;

  SELECT stock_quantity INTO _before FROM public.products WHERE id = _product_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'product not found'; END IF;

  _after := _before + _quantity_change;
  IF _after < 0 THEN RAISE EXCEPTION 'resulting stock cannot be negative (current: %, change: %)', _before, _quantity_change; END IF;

  UPDATE public.products SET stock_quantity = _after WHERE id = _product_id;

  INSERT INTO public.stock_adjustments(product_id, quantity_change, reason, notes, before_qty, after_qty, created_by)
  VALUES (_product_id, _quantity_change, _reason, _notes, _before, _after, auth.uid())
  RETURNING id INTO _adj_id;

  RETURN jsonb_build_object('adjustment_id', _adj_id, 'before', _before, 'after', _after);
END; $$;
