-- Delivery module — TRACKING / DATA ONLY.
--
-- These tables only record who is delivering which invoice, where it goes,
-- the delivery charge and the delivery status. Nothing here writes to sales,
-- sale_items, payments, products, stock, cash_movements, expenses or any other
-- financial table, and there are no triggers on those tables. Cancelling a
-- delivery changes only the delivery row (and adds a history line).

-- 1) Delivery men -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_men (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Deliveries (one row per invoice sent for delivery) -----------------------
CREATE TABLE IF NOT EXISTS public.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  invoice_no text NOT NULL,
  delivery_man_id uuid REFERENCES public.delivery_men(id) ON DELETE SET NULL,
  -- snapshots, so the record keeps its history even if names change later
  delivery_man_name text NOT NULL,
  delivery_man_phone text,
  customer_name text,
  customer_phone text,
  customer_address text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{name, quantity}]
  delivery_charge numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'out_for_delivery', 'delivered', 'cancelled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- An invoice can have only one live delivery; after a cancel it can be sent again.
CREATE UNIQUE INDEX IF NOT EXISTS ux_deliveries_one_live_per_sale
  ON public.deliveries(sale_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS ix_deliveries_created_at ON public.deliveries(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_deliveries_man ON public.deliveries(delivery_man_id);
CREATE INDEX IF NOT EXISTS ix_deliveries_status ON public.deliveries(status);

-- 3) Status history -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_delivery_history_delivery ON public.delivery_status_history(delivery_id, changed_at);

-- 4) Row level security -------------------------------------------------------
ALTER TABLE public.delivery_men ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read delivery men" ON public.delivery_men;
CREATE POLICY "Staff read delivery men" ON public.delivery_men
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff add delivery men" ON public.delivery_men;
CREATE POLICY "Staff add delivery men" ON public.delivery_men
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff edit delivery men" ON public.delivery_men;
CREATE POLICY "Staff edit delivery men" ON public.delivery_men
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Deliveries and history are read directly; they are only written through the
-- functions below (which validate status changes and write the history).
DROP POLICY IF EXISTS "Staff read deliveries" ON public.deliveries;
CREATE POLICY "Staff read deliveries" ON public.deliveries
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff read delivery history" ON public.delivery_status_history;
CREATE POLICY "Staff read delivery history" ON public.delivery_status_history
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.delivery_men TO authenticated;
GRANT SELECT ON public.deliveries, public.delivery_status_history TO authenticated;
GRANT ALL ON public.delivery_men, public.deliveries, public.delivery_status_history TO service_role;

CREATE OR REPLACE FUNCTION public.trg_delivery_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_delivery_men_touch ON public.delivery_men;
CREATE TRIGGER trg_delivery_men_touch BEFORE UPDATE ON public.delivery_men
  FOR EACH ROW EXECUTE FUNCTION public.trg_delivery_touch();
DROP TRIGGER IF EXISTS trg_deliveries_touch ON public.deliveries;
CREATE TRIGGER trg_deliveries_touch BEFORE UPDATE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.trg_delivery_touch();

-- 5) Create a delivery from an invoice ----------------------------------------
-- Customer, phone, address and products are copied from the invoice. Only
-- READS the sale; never changes it.
CREATE OR REPLACE FUNCTION public.create_delivery(
  _sale_id uuid,
  _delivery_man_id uuid,
  _delivery_charge numeric DEFAULT 0,
  _note text DEFAULT NULL,
  _address text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sale record; _man record; _owner record; _items jsonb; _id uuid; _who text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF COALESCE(_delivery_charge, 0) < 0 THEN RAISE EXCEPTION 'delivery charge cannot be negative'; END IF;

  SELECT id, invoice_no, owner_id, status INTO _sale FROM public.sales WHERE id = _sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF _sale.status = 'void' THEN RAISE EXCEPTION 'this invoice is cancelled'; END IF;

  SELECT id, name, phone, is_active INTO _man FROM public.delivery_men WHERE id = _delivery_man_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'choose a delivery man'; END IF;
  IF NOT _man.is_active THEN RAISE EXCEPTION 'this delivery man is inactive'; END IF;

  IF EXISTS (SELECT 1 FROM public.deliveries WHERE sale_id = _sale_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'invoice % already has an active delivery', _sale.invoice_no;
  END IF;

  SELECT full_name, phone, address INTO _owner FROM public.pet_owners WHERE id = _sale.owner_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity - returned_quantity) ORDER BY id), '[]'::jsonb)
    INTO _items FROM public.sale_items WHERE sale_id = _sale_id AND quantity > returned_quantity;

  SELECT COALESCE(full_name, '') INTO _who FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.deliveries(sale_id, invoice_no, delivery_man_id, delivery_man_name, delivery_man_phone,
    customer_name, customer_phone, customer_address, items, delivery_charge, note, status, created_by)
  VALUES (_sale_id, _sale.invoice_no, _man.id, _man.name, _man.phone,
    _owner.full_name, _owner.phone, COALESCE(NULLIF(trim(_address), ''), _owner.address), _items,
    round(COALESCE(_delivery_charge, 0), 2), NULLIF(trim(_note), ''), 'pending', auth.uid())
  RETURNING id INTO _id;

  INSERT INTO public.delivery_status_history(delivery_id, from_status, to_status, note, changed_by, changed_by_name)
  VALUES (_id, NULL, 'pending', 'Delivery created', auth.uid(), NULLIF(_who, ''));

  RETURN jsonb_build_object('delivery_id', _id, 'invoice_no', _sale.invoice_no, 'status', 'pending');
END; $$;

-- 6) Change delivery status — changes ONLY the delivery row + history ---------
--   pending → out_for_delivery → delivered
--   pending / out_for_delivery → cancelled
CREATE OR REPLACE FUNCTION public.set_delivery_status(
  _delivery_id uuid,
  _status text,
  _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d record; _ok boolean; _who text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT id, status INTO _d FROM public.deliveries WHERE id = _delivery_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery not found'; END IF;
  IF _d.status = _status THEN RETURN jsonb_build_object('delivery_id', _d.id, 'status', _d.status, 'changed', false); END IF;

  _ok := (_d.status = 'pending' AND _status IN ('out_for_delivery', 'cancelled'))
      OR (_d.status = 'out_for_delivery' AND _status IN ('delivered', 'cancelled'));
  IF NOT _ok THEN RAISE EXCEPTION 'cannot change delivery from % to %', _d.status, _status; END IF;

  SELECT COALESCE(full_name, '') INTO _who FROM public.profiles WHERE id = auth.uid();
  UPDATE public.deliveries SET status = _status WHERE id = _d.id;
  INSERT INTO public.delivery_status_history(delivery_id, from_status, to_status, note, changed_by, changed_by_name)
  VALUES (_d.id, _d.status, _status, NULLIF(trim(_note), ''), auth.uid(), NULLIF(_who, ''));

  RETURN jsonb_build_object('delivery_id', _d.id, 'status', _status, 'changed', true);
END; $$;

-- 7) Edit delivery details (man / charge / address / note) while not finished.
CREATE OR REPLACE FUNCTION public.update_delivery_details(
  _delivery_id uuid,
  _delivery_man_id uuid,
  _delivery_charge numeric,
  _address text,
  _note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d record; _man record; _who text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF COALESCE(_delivery_charge, 0) < 0 THEN RAISE EXCEPTION 'delivery charge cannot be negative'; END IF;
  SELECT * INTO _d FROM public.deliveries WHERE id = _delivery_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery not found'; END IF;
  IF _d.status IN ('delivered', 'cancelled') THEN RAISE EXCEPTION 'a % delivery cannot be edited', _d.status; END IF;
  SELECT id, name, phone INTO _man FROM public.delivery_men WHERE id = _delivery_man_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'choose a delivery man'; END IF;

  UPDATE public.deliveries SET delivery_man_id = _man.id, delivery_man_name = _man.name, delivery_man_phone = _man.phone,
    delivery_charge = round(COALESCE(_delivery_charge, 0), 2), customer_address = NULLIF(trim(_address), ''),
    note = NULLIF(trim(_note), '')
  WHERE id = _d.id;

  SELECT COALESCE(full_name, '') INTO _who FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.delivery_status_history(delivery_id, from_status, to_status, note, changed_by, changed_by_name)
  VALUES (_d.id, _d.status, _d.status, 'Details edited', auth.uid(), NULLIF(_who, ''));
  RETURN jsonb_build_object('delivery_id', _d.id, 'status', _d.status);
END; $$;

REVOKE ALL ON FUNCTION public.create_delivery(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_delivery_status(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_delivery_details(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_delivery(uuid, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_delivery_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_delivery_details(uuid, uuid, numeric, text, text) TO authenticated;

-- 8) Staff who work with sales get the new Deliveries page.
INSERT INTO public.user_permissions (user_id, permission)
SELECT DISTINCT up.user_id, 'deliveries'
  FROM public.user_permissions up
 WHERE up.permission IN ('pos', 'sales_history', 'due_bills')
   AND NOT EXISTS (SELECT 1 FROM public.user_permissions x WHERE x.user_id = up.user_id AND x.permission = 'deliveries');
