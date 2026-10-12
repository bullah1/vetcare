-- B2B / wholesale pricing in POS, minimum selling price and a price-change audit log.
--
-- * Customers can be marked B2B (wholesale). Products can have a wholesale price
--   and a minimum selling price.
-- * POS saves through create_pos_sale(): it checks who may change a price and
--   blocks prices under the minimum (admins may go lower), then uses the normal
--   create_sale() — same invoice, stock, payment and cash drawer as before.
-- * Each invoice line keeps the price it was sold at (unit_price, as before), the
--   default price at that moment (list_price) and the cost (cost_price), so old
--   invoices never change when product prices change later.
-- * Every changed price is written to price_override_log (who, when, old, new).
-- The product's own purchase / selling price is never changed by a sale.
-- Safe to run more than once.

-- 1) New fields ---------------------------------------------------------------
ALTER TABLE public.pet_owners
  ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'retail';
DO $$ BEGIN
  ALTER TABLE public.pet_owners ADD CONSTRAINT pet_owners_customer_type_chk CHECK (customer_type IN ('retail', 'b2b'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wholesale_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS min_selling_price numeric(12,2);
DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_wholesale_price_chk CHECK (wholesale_price IS NULL OR wholesale_price >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_min_selling_price_chk CHECK (min_selling_price IS NULL OR min_selling_price >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS list_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS price_overridden boolean NOT NULL DEFAULT false;

-- 2) Audit log --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_override_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  sale_item_id uuid REFERENCES public.sale_items(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text,
  invoice_no text,
  customer_id uuid REFERENCES public.pet_owners(id) ON DELETE SET NULL,
  customer_type text,
  quantity numeric(12,2),
  old_price numeric(12,2) NOT NULL,
  new_price numeric(12,2) NOT NULL,
  min_price numeric(12,2),
  below_min boolean NOT NULL DEFAULT false,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_price_override_log_created ON public.price_override_log(created_at);
CREATE INDEX IF NOT EXISTS ix_price_override_log_product ON public.price_override_log(product_id);
ALTER TABLE public.price_override_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read price log" ON public.price_override_log;
CREATE POLICY "Staff read price log" ON public.price_override_log FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
-- No insert/update/delete policies: rows are written only by create_pos_sale().
GRANT SELECT ON public.price_override_log TO authenticated;
GRANT ALL ON public.price_override_log TO service_role;

CREATE INDEX IF NOT EXISTS ix_sales_cashier_created ON public.sales(cashier_id, created_at);
CREATE INDEX IF NOT EXISTS ix_sale_items_product ON public.sale_items(product_id);
CREATE INDEX IF NOT EXISTS ix_payments_received ON public.payments(received_at);

-- 3) Who may change prices --------------------------------------------------------
-- Admin always; others need the 'price_override' permission (Staff & Permissions).
CREATE OR REPLACE FUNCTION public.can_override_price(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'admin')
      OR EXISTS (SELECT 1 FROM public.user_permissions WHERE user_id = _uid AND permission = 'price_override');
$$;
REVOKE ALL ON FUNCTION public.can_override_price(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_override_price(uuid) TO authenticated;

-- 4) POS sale with price checks -----------------------------------------------------
-- Same arguments as create_sale(). Product lines may carry a changed unit_price.
CREATE OR REPLACE FUNCTION public.create_pos_sale(
  _owner_id uuid,
  _items jsonb,
  _payments jsonb,
  _discount numeric DEFAULT 0,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_admin boolean;
  _can boolean;
  _ctype text := 'retail';
  _item jsonb;
  _p record;
  _list numeric;
  _price numeric;
  _checked jsonb := '[]'::jsonb;
  _res jsonb;
  _sale_id uuid;
  _si record;
  _n int := 0;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN RAISE EXCEPTION 'not authorized'; END IF;
  _is_admin := public.has_role(_uid, 'admin');
  _can := public.can_override_price(_uid);
  IF _owner_id IS NOT NULL THEN
    SELECT COALESCE(customer_type, 'retail') INTO _ctype FROM public.pet_owners WHERE id = _owner_id;
  END IF;

  -- Check every product line against the price it should have.
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _n := _n + 1;
    IF NULLIF(_item->>'product_id', '') IS NOT NULL THEN
      SELECT id, name, selling_price, wholesale_price, min_selling_price INTO _p
      FROM public.products WHERE id = (_item->>'product_id')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'product not found on line %', _n; END IF;
      _list := CASE WHEN _ctype = 'b2b' THEN COALESCE(_p.wholesale_price, _p.selling_price) ELSE _p.selling_price END;
      _price := (_item->>'unit_price')::numeric;
      IF _price IS NULL OR _price < 0 THEN RAISE EXCEPTION 'invalid price for %', _p.name; END IF;
      IF abs(_price - COALESCE(_list, 0)) > 0.004 THEN
        IF NOT _can THEN
          RAISE EXCEPTION 'You are not allowed to change the price of % (ask an admin)', _p.name;
        END IF;
        IF _p.min_selling_price IS NOT NULL AND _price < _p.min_selling_price - 0.004 AND NOT _is_admin THEN
          RAISE EXCEPTION '% is below its minimum price (%). Only an admin can sell it lower.', _p.name, _p.min_selling_price;
        END IF;
      END IF;
      _item := _item || jsonb_build_object('_list', _list, '_min', _p.min_selling_price, '_line', _n);
    END IF;
    _checked := _checked || jsonb_build_array(_item);
  END LOOP;

  _res := public.create_sale(_owner_id, _items, _payments, _discount, _notes);
  _sale_id := (_res->>'sale_id')::uuid;

  -- Keep the default price next to the sold price, and log every change.
  FOR _item IN SELECT * FROM jsonb_array_elements(_checked) LOOP
    CONTINUE WHEN _item->>'_list' IS NULL;
    SELECT si.id, si.unit_price, si.quantity, si.name INTO _si
    FROM public.sale_items si
    WHERE si.sale_id = _sale_id AND si.product_id = (_item->>'product_id')::uuid AND si.list_price IS NULL
      AND abs(si.unit_price - (_item->>'unit_price')::numeric) < 0.005
    ORDER BY si.id LIMIT 1;
    CONTINUE WHEN _si.id IS NULL;
    UPDATE public.sale_items
       SET list_price = (_item->>'_list')::numeric,
           price_overridden = abs(_si.unit_price - (_item->>'_list')::numeric) > 0.004
     WHERE id = _si.id;
    IF abs(_si.unit_price - (_item->>'_list')::numeric) > 0.004 THEN
      INSERT INTO public.price_override_log(sale_id, sale_item_id, product_id, product_name, invoice_no, customer_id, customer_type,
                                            quantity, old_price, new_price, min_price, below_min, changed_by)
      VALUES (_sale_id, _si.id, (_item->>'product_id')::uuid, _si.name, _res->>'invoice_no', _owner_id, _ctype,
              _si.quantity, (_item->>'_list')::numeric, _si.unit_price, NULLIF(_item->>'_min', '')::numeric,
              NULLIF(_item->>'_min', '') IS NOT NULL AND _si.unit_price < (_item->>'_min')::numeric - 0.004, _uid);
    END IF;
  END LOOP;

  RETURN _res;
END; $$;
REVOKE ALL ON FUNCTION public.create_pos_sale(uuid, jsonb, jsonb, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(uuid, jsonb, jsonb, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
