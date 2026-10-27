-- Two projects in one app, one cash drawer:
--   pcv = Pet Care Vet (pet shop + clinic)   → invoices INV-YYYYMM-#####
--   ss  = Sasthya Seba (human medicine)      → invoices SS-YYYYMM-#####
-- A product belongs to a project through its category. A bill belongs to ONE
-- project (separate invoices). Expenses can be for one project or shared (NULL).
-- Everything that existed before stays Pet Care Vet. Safe to run more than once.

-- ---------- categories ----------
CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  project text NOT NULL DEFAULT 'pcv' CHECK (project IN ('pcv','ss')),
  -- The older fixed category kept on products (used by older reports).
  legacy_category public.product_category NOT NULL DEFAULT 'other',
  sort integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project, name)
);
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_categories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;
DROP POLICY IF EXISTS "categories read" ON public.product_categories;
DROP POLICY IF EXISTS "categories write" ON public.product_categories;
CREATE POLICY "categories read" ON public.product_categories FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "categories write" ON public.product_categories FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'inventory')) WITH CHECK (public.has_permission(auth.uid(), 'inventory'));

INSERT INTO public.product_categories(name, project, legacy_category, sort) VALUES
  ('Pet Medicine', 'pcv', 'medicine', 1), ('Pet Food', 'pcv', 'pet_food', 2), ('Accessory', 'pcv', 'accessory', 3),
  ('Service', 'pcv', 'service', 4), ('Other', 'pcv', 'other', 5),
  ('Tablet', 'ss', 'medicine', 1), ('Capsule', 'ss', 'medicine', 2), ('Syrup & Suspension', 'ss', 'medicine', 3),
  ('Injection', 'ss', 'medicine', 4), ('Drops, Cream & Ointment', 'ss', 'medicine', 5), ('Surgical', 'ss', 'other', 6),
  ('Baby & Personal Care', 'ss', 'other', 7), ('Other Health', 'ss', 'other', 8)
ON CONFLICT (project, name) DO NOTHING;

-- ---------- products ----------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS project text NOT NULL DEFAULT 'pcv';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL;
DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_project_check CHECK (project IN ('pcv','ss'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS products_project_idx ON public.products (project);

-- Existing products: Pet Care Vet category with the same old category.
UPDATE public.products p SET category_id = c.id
FROM public.product_categories c
WHERE p.category_id IS NULL AND c.project = 'pcv' AND c.legacy_category = p.category
  AND c.name IN ('Pet Medicine','Pet Food','Accessory','Service','Other');

-- The category decides the project (and the older fixed category).
CREATE OR REPLACE FUNCTION public.trg_products_category_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c record;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT project, legacy_category INTO _c FROM public.product_categories WHERE id = NEW.category_id;
    IF FOUND THEN
      NEW.project := _c.project;
      NEW.category := _c.legacy_category;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS products_category_project ON public.products;
CREATE TRIGGER products_category_project BEFORE INSERT OR UPDATE OF category_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.trg_products_category_project();

-- Moving a category to the other project moves its products too.
CREATE OR REPLACE FUNCTION public.trg_category_moves_products()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.project IS DISTINCT FROM OLD.project OR NEW.legacy_category IS DISTINCT FROM OLD.legacy_category THEN
    UPDATE public.products SET project = NEW.project, category = NEW.legacy_category WHERE category_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS product_categories_move ON public.product_categories;
CREATE TRIGGER product_categories_move AFTER UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.trg_category_moves_products();

-- ---------- bills ----------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS project text NOT NULL DEFAULT 'pcv';
DO $$ BEGIN
  ALTER TABLE public.sales ADD CONSTRAINT sales_project_check CHECK (project IN ('pcv','ss'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS sales_project_created_idx ON public.sales (project, created_at);

ALTER TABLE public.held_bills ADD COLUMN IF NOT EXISTS project text NOT NULL DEFAULT 'pcv';

-- Expenses: one project, or NULL = shared by both.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS project text;
DO $$ BEGIN
  ALTER TABLE public.expenses ADD CONSTRAINT expenses_project_check CHECK (project IS NULL OR project IN ('pcv','ss'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Separate invoice numbers. A Sasthya Seba bill sets app.sale_project = 'ss'
-- for its own transaction; every other bill keeps the INV numbers as before.
CREATE SEQUENCE IF NOT EXISTS public.ss_invoice_seq;
GRANT USAGE, SELECT ON SEQUENCE public.ss_invoice_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.next_invoice_no()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN current_setting('app.sale_project', true) = 'ss'
    THEN 'SS-'  || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.ss_invoice_seq')::text, 5, '0')
    ELSE 'INV-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.invoice_seq')::text, 5, '0')
  END;
$$;
GRANT EXECUTE ON FUNCTION public.next_invoice_no() TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_sales_project()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.project := COALESCE(NULLIF(current_setting('app.sale_project', true), ''), NEW.project, 'pcv');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS sales_project ON public.sales;
CREATE TRIGGER sales_project BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_project();

-- POS bill for one project. Runs the normal POS checks (create_pos_sale: price
-- rules, stock, payments) and only adds the project and its invoice number.
CREATE OR REPLACE FUNCTION public.create_project_sale(_project text, _owner_id uuid, _items jsonb, _payments jsonb, _discount numeric DEFAULT 0, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _res jsonb; _bad text;
BEGIN
  IF _project NOT IN ('pcv','ss') THEN RAISE EXCEPTION 'Unknown project %', _project; END IF;
  SELECT string_agg(p.name, ', ') INTO _bad
  FROM jsonb_array_elements(_items) x JOIN public.products p ON p.id = NULLIF(x->>'product_id','')::uuid
  WHERE p.project <> _project;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'These products belong to the other project: %. Make a separate bill for them.', _bad;
  END IF;

  PERFORM set_config('app.sale_project', _project, true);
  IF to_regprocedure('public.create_pos_sale(uuid,jsonb,jsonb,numeric,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.create_pos_sale($1,$2,$3,$4,$5)' INTO _res USING _owner_id, _items, _payments, COALESCE(_discount,0), _notes;
  ELSE
    _res := public.create_sale(_owner_id, _items, COALESCE(_payments,'[]'::jsonb), COALESCE(_discount,0), _notes);
  END IF;
  PERFORM set_config('app.sale_project', '', true);
  RETURN _res || jsonb_build_object('project', _project);
END; $$;
REVOKE ALL ON FUNCTION public.create_project_sale(text, uuid, jsonb, jsonb, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project_sale(text, uuid, jsonb, jsonb, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
