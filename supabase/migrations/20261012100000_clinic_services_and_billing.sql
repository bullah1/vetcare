-- Clinic: Problem list, Service list (with materials) and the Clinic Service Bill.
--
-- The clinic bill uses the SAME invoice / payment / cash drawer / accounts
-- system as POS (public.create_sale), so nothing is counted twice. A booking
-- alone is never revenue: money is only recorded when a bill is made.
-- Safe to run more than once. Existing data is not changed.

-- 1) Problems (what the pet comes in with) -----------------------------------
CREATE TABLE IF NOT EXISTS public.clinic_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_clinic_problems_name ON public.clinic_problems (lower(trim(name)));

-- 2) Services and the products / medicines each one uses -----------------------
CREATE TABLE IF NOT EXISTS public.clinic_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  category text NOT NULL DEFAULT 'procedure'
    CHECK (category IN ('consultation', 'vaccination', 'procedure', 'surgery', 'grooming', 'other')),
  price numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  direct_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (direct_cost >= 0),     -- cost other than stock items
  doctor_fee_type text NOT NULL DEFAULT 'fixed' CHECK (doctor_fee_type IN ('fixed', 'percent')),
  doctor_fee_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (doctor_fee_value >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_clinic_services_name ON public.clinic_services (lower(trim(name)));

CREATE TABLE IF NOT EXISTS public.clinic_service_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.clinic_services(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  UNIQUE (service_id, product_id)
);

ALTER TABLE public.clinic_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_service_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read clinic problems" ON public.clinic_problems;
CREATE POLICY "Staff read clinic problems" ON public.clinic_problems FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff add clinic problems" ON public.clinic_problems;
CREATE POLICY "Staff add clinic problems" ON public.clinic_problems FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Admin edit clinic problems" ON public.clinic_problems;
CREATE POLICY "Admin edit clinic problems" ON public.clinic_problems FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Staff read clinic services" ON public.clinic_services;
CREATE POLICY "Staff read clinic services" ON public.clinic_services FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Admin manage clinic services" ON public.clinic_services;
CREATE POLICY "Admin manage clinic services" ON public.clinic_services FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Staff read service materials" ON public.clinic_service_materials;
CREATE POLICY "Staff read service materials" ON public.clinic_service_materials FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Admin manage service materials" ON public.clinic_service_materials;
CREATE POLICY "Admin manage service materials" ON public.clinic_service_materials FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.clinic_problems TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_services, public.clinic_service_materials TO authenticated;
GRANT ALL ON public.clinic_problems, public.clinic_services, public.clinic_service_materials TO service_role;

-- 3) Links: appointment → problem; invoice → clinic; invoice line → service / doctor
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS problem_id uuid REFERENCES public.clinic_problems(id) ON DELETE SET NULL;
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pos',
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL;
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES public.clinic_services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS doctor_fee numeric(12,2) NOT NULL DEFAULT 0;

-- Older consultation invoices made from appointments are clinic invoices too.
UPDATE public.sales s SET source = 'clinic'
WHERE s.source = 'pos' AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.sale_id = s.id);
UPDATE public.sale_items si SET item_type = 'consultation'
WHERE si.item_type = 'product' AND si.product_id IS NULL
  AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.sale_id = si.sale_id);

CREATE INDEX IF NOT EXISTS ix_sales_source_created ON public.sales(source, created_at);
CREATE INDEX IF NOT EXISTS ix_sale_items_service_id ON public.sale_items(service_id);
CREATE INDEX IF NOT EXISTS ix_appointments_problem_id ON public.appointments(problem_id);

-- 4) The clinic bill ------------------------------------------------------------
-- _lines: [{ "kind": "consultation" | "service" | "product",
--            "service_id": uuid?, "product_id": uuid?, "name": text,
--            "quantity": n, "unit_price": n, "discount": n }]
-- One invoice through create_sale (same numbering, payments, cash drawer).
-- Service lines then get their service, doctor, doctor fee and real cost;
-- the medicines a service uses come off stock once, and their cost is the
-- service line's cost (COGS) — never counted a second time.
CREATE OR REPLACE FUNCTION public.create_clinic_bill(
  _appointment_id uuid,
  _owner_id uuid,
  _doctor_id uuid,
  _lines jsonb,
  _payments jsonb,
  _discount numeric DEFAULT 0,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _appt public.appointments%ROWTYPE;
  _items jsonb := '[]'::jsonb;
  _line jsonb;
  _res jsonb;
  _sale_id uuid;
  _kind text;
  _svc public.clinic_services%ROWTYPE;
  _qty numeric;
  _line_total numeric;
  _mat_cost numeric;
  _fee numeric;
  _item_id uuid;
  _m record;
  _paid numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'add at least one service or product'; END IF;

  IF _appointment_id IS NOT NULL THEN
    SELECT * INTO _appt FROM public.appointments WHERE id = _appointment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'appointment not found'; END IF;
    IF _appt.sale_id IS NOT NULL THEN RAISE EXCEPTION 'this appointment already has a bill'; END IF;
    IF _appt.status = 'cancelled' THEN RAISE EXCEPTION 'this appointment is cancelled'; END IF;
    _owner_id := COALESCE(_owner_id, _appt.owner_id, (SELECT owner_id FROM public.pets WHERE id = _appt.pet_id));
    _doctor_id := COALESCE(_doctor_id, _appt.doctor_id);
  END IF;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _kind := COALESCE(_line->>'kind', 'service');
    IF _kind NOT IN ('consultation', 'service', 'product') THEN RAISE EXCEPTION 'unknown line type %', _kind; END IF;
    IF COALESCE((_line->>'quantity')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'quantity must be more than 0'; END IF;
    IF COALESCE((_line->>'unit_price')::numeric, -1) < 0 THEN RAISE EXCEPTION 'price cannot be negative'; END IF;
    IF _kind = 'product' AND NULLIF(_line->>'product_id', '') IS NULL THEN RAISE EXCEPTION 'product line without product'; END IF;
    IF _kind = 'service' AND NULLIF(_line->>'service_id', '') IS NULL THEN RAISE EXCEPTION 'service line without service'; END IF;
    _items := _items || jsonb_build_array(jsonb_build_object(
      'product_id', CASE WHEN _kind = 'product' THEN _line->>'product_id' ELSE NULL END,
      'name', _line->>'name',
      'quantity', (_line->>'quantity')::numeric,
      'unit_price', (_line->>'unit_price')::numeric,
      'discount', COALESCE((_line->>'discount')::numeric, 0),
      'tax', 0));
  END LOOP;

  _res := public.create_sale(_owner_id, _items, COALESCE(_payments, '[]'::jsonb), COALESCE(_discount, 0), _notes);
  _sale_id := (_res->>'sale_id')::uuid;
  UPDATE public.sales SET source = 'clinic', appointment_id = _appointment_id WHERE id = _sale_id;

  -- Tag consultation / service lines (create_sale stored them without a product).
  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _kind := COALESCE(_line->>'kind', 'service');
    CONTINUE WHEN _kind = 'product';
    _qty := (_line->>'quantity')::numeric;
    SELECT id, line_total INTO _item_id, _line_total FROM public.sale_items
      WHERE sale_id = _sale_id AND product_id IS NULL AND item_type = 'product' AND name = _line->>'name'
      ORDER BY id LIMIT 1;
    IF _item_id IS NULL THEN CONTINUE; END IF;

    IF _kind = 'service' THEN
      SELECT * INTO _svc FROM public.clinic_services WHERE id = (_line->>'service_id')::uuid;
      -- medicines / materials used: off stock once, cost on this line
      _mat_cost := 0;
      FOR _m IN SELECT m.product_id, m.quantity, COALESCE(p.purchase_price, 0) AS cost
                FROM public.clinic_service_materials m JOIN public.products p ON p.id = m.product_id
                WHERE m.service_id = _svc.id LOOP
        UPDATE public.products SET stock_quantity = stock_quantity - (_m.quantity * _qty) WHERE id = _m.product_id;
        _mat_cost := _mat_cost + _m.quantity * _m.cost;
      END LOOP;
      _fee := CASE WHEN _svc.doctor_fee_type = 'percent' THEN round(_line_total * _svc.doctor_fee_value / 100, 2)
                   ELSE round(_svc.doctor_fee_value * _qty, 2) END;
      UPDATE public.sale_items SET item_type = 'service', service_id = _svc.id, doctor_id = _doctor_id,
        doctor_fee = COALESCE(_fee, 0), cost_price = round(COALESCE(_svc.direct_cost, 0) + _mat_cost, 2)
      WHERE id = _item_id;
    ELSE
      UPDATE public.sale_items SET item_type = 'consultation', doctor_id = _doctor_id WHERE id = _item_id;
    END IF;
  END LOOP;

  IF _appointment_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;
    UPDATE public.appointments SET sale_id = _sale_id, paid = _paid,
      status = CASE WHEN status IN ('cancelled', 'no_show') THEN status ELSE 'completed' END,
      payment_method = (SELECT method FROM public.payments WHERE sale_id = _sale_id ORDER BY received_at LIMIT 1),
      updated_at = now()
    WHERE id = _appointment_id;
  END IF;

  RETURN _res;
END; $$;

REVOKE ALL ON FUNCTION public.create_clinic_bill(uuid, uuid, uuid, jsonb, jsonb, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_clinic_bill(uuid, uuid, uuid, jsonb, jsonb, numeric, text) TO authenticated;

-- 4b) Any sale linked to an appointment (also from the older "receive cash" flow) counts as clinic.
CREATE OR REPLACE FUNCTION public.tag_appointment_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sale_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.sale_id IS DISTINCT FROM OLD.sale_id) THEN
    UPDATE public.sale_items SET item_type = 'consultation', doctor_id = COALESCE(doctor_id, NEW.doctor_id)
    WHERE sale_id = NEW.sale_id AND product_id IS NULL AND item_type = 'product'
      AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = NEW.sale_id AND s.source <> 'clinic');
    UPDATE public.sales SET source = 'clinic', appointment_id = COALESCE(appointment_id, NEW.id)
    WHERE id = NEW.sale_id AND (source <> 'clinic' OR appointment_id IS NULL);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_tag_appointment_sale ON public.appointments;
CREATE TRIGGER trg_tag_appointment_sale
  AFTER INSERT OR UPDATE OF sale_id ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.tag_appointment_sale();

-- older appointment sales: remember which appointment they belong to
UPDATE public.sales s SET appointment_id = a.id
FROM public.appointments a
WHERE a.sale_id = s.id AND s.appointment_id IS NULL;

-- 5) A starter problem list (edit / add more from Service Bill → Problems)
INSERT INTO public.clinic_problems(name) VALUES
  ('General check-up'), ('Vaccination'), ('Deworming'), ('Fever'), ('Vomiting'), ('Diarrhea'),
  ('Not eating'), ('Skin problem'), ('Ear problem'), ('Eye problem'), ('Injury / wound'), ('Breathing problem')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
