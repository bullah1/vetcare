-- ===== Sync with live Lovable DB: objects that exist live but are not in the repo migrations =====
CREATE SEQUENCE IF NOT EXISTS public.clinical_visit_seq START 1;

-- Columns added directly on the live database
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS degree text;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS designation text;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS additional_qualification text;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS registration_no text;
ALTER TABLE public.prescription_items ADD COLUMN IF NOT EXISTS dose_amount numeric(8,2);
ALTER TABLE public.prescription_items ADD COLUMN IF NOT EXISTS dose_unit text;
ALTER TABLE public.prescription_items ADD COLUMN IF NOT EXISTS morning numeric(8,2);
ALTER TABLE public.prescription_items ADD COLUMN IF NOT EXISTS noon numeric(8,2);
ALTER TABLE public.prescription_items ADD COLUMN IF NOT EXISTS night numeric(8,2);
ALTER TABLE public.prescription_items ADD COLUMN IF NOT EXISTS duration_days integer;
ALTER TABLE public.prescription_items ADD COLUMN IF NOT EXISTS instruction text;
ALTER TABLE public.prescription_items ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS visit_id uuid;
ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS rx_no text;
ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS follow_up_date date;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_prescribable boolean DEFAULT false NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS dose_form text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS dose_unit text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS external_ref text;
-- Not present on the live database
ALTER TABLE public.hr_salary_items DROP COLUMN IF EXISTS item_date;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_barcode_key;
DROP INDEX IF EXISTS public.products_barcode_unique_idx;

-- Tables that exist only on the live database
CREATE TABLE IF NOT EXISTS public.advice_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  text text NOT NULL,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  is_common boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.cash_close_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  shift_id uuid NOT NULL,
  report_no text NOT NULL,
  file_path text NOT NULL,
  snapshot jsonb NOT NULL,
  branch text,
  cashier text,
  opening_cash numeric DEFAULT 0 NOT NULL,
  cash_sales numeric DEFAULT 0 NOT NULL,
  cash_in numeric DEFAULT 0 NOT NULL,
  cash_out numeric DEFAULT 0 NOT NULL,
  refunds numeric DEFAULT 0 NOT NULL,
  expected_cash numeric DEFAULT 0 NOT NULL,
  actual_cash numeric DEFAULT 0 NOT NULL,
  difference numeric DEFAULT 0 NOT NULL,
  closed_at timestamp with time zone NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.clinical_visits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  visit_no text,
  owner_id uuid,
  pet_id uuid NOT NULL,
  doctor_id uuid,
  appointment_id uuid,
  visit_date timestamp with time zone DEFAULT now() NOT NULL,
  chief_complaint text,
  examination text,
  weight_kg numeric(6,2),
  temperature numeric(5,2),
  symptoms text[] DEFAULT '{}'::text[] NOT NULL,
  diagnoses text[] DEFAULT '{}'::text[] NOT NULL,
  tests text[] DEFAULT '{}'::text[] NOT NULL,
  advice text[] DEFAULT '{}'::text[] NOT NULL,
  follow_up_date date,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.diagnoses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  is_common boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.medical_tests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  is_common boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.online_integration (
  id integer DEFAULT 1 NOT NULL,
  secret_hash text NOT NULL,
  owner_user uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.surgeries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  visit_id uuid,
  pet_id uuid NOT NULL,
  owner_id uuid,
  doctor_id uuid,
  surgery_type text NOT NULL,
  surgery_date timestamp with time zone DEFAULT now() NOT NULL,
  fee numeric DEFAULT 0 NOT NULL,
  paid numeric DEFAULT 0 NOT NULL,
  discount numeric DEFAULT 0 NOT NULL,
  is_free boolean DEFAULT false NOT NULL,
  outcome text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.symptoms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  is_common boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.visit_advice (
  visit_id uuid NOT NULL,
  advice_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.visit_diagnoses (
  visit_id uuid NOT NULL,
  diagnosis_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.visit_symptoms (
  visit_id uuid NOT NULL,
  symptom_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.visit_tests (
  visit_id uuid NOT NULL,
  test_id uuid NOT NULL
);

ALTER TABLE public.advice_templates ADD CONSTRAINT advice_templates_pkey PRIMARY KEY (id);
ALTER TABLE public.advice_templates ADD CONSTRAINT advice_templates_text_key UNIQUE (text);
ALTER TABLE public.cash_close_reports ADD CONSTRAINT cash_close_reports_file_path_key UNIQUE (file_path);
ALTER TABLE public.cash_close_reports ADD CONSTRAINT cash_close_reports_pkey PRIMARY KEY (id);
ALTER TABLE public.cash_close_reports ADD CONSTRAINT cash_close_reports_shift_id_key UNIQUE (shift_id);
ALTER TABLE public.clinical_visits ADD CONSTRAINT clinical_visits_pkey PRIMARY KEY (id);
ALTER TABLE public.diagnoses ADD CONSTRAINT diagnoses_name_key UNIQUE (name);
ALTER TABLE public.diagnoses ADD CONSTRAINT diagnoses_pkey PRIMARY KEY (id);
ALTER TABLE public.medical_tests ADD CONSTRAINT medical_tests_name_key UNIQUE (name);
ALTER TABLE public.medical_tests ADD CONSTRAINT medical_tests_pkey PRIMARY KEY (id);
ALTER TABLE public.online_integration ADD CONSTRAINT online_integration_id_check CHECK ((id = 1));
ALTER TABLE public.online_integration ADD CONSTRAINT online_integration_pkey PRIMARY KEY (id);
ALTER TABLE public.surgeries ADD CONSTRAINT surgeries_pkey PRIMARY KEY (id);
ALTER TABLE public.symptoms ADD CONSTRAINT symptoms_name_key UNIQUE (name);
ALTER TABLE public.symptoms ADD CONSTRAINT symptoms_pkey PRIMARY KEY (id);
ALTER TABLE public.visit_advice ADD CONSTRAINT visit_advice_pkey PRIMARY KEY (visit_id, advice_id);
ALTER TABLE public.visit_diagnoses ADD CONSTRAINT visit_diagnoses_pkey PRIMARY KEY (visit_id, diagnosis_id);
ALTER TABLE public.visit_symptoms ADD CONSTRAINT visit_symptoms_pkey PRIMARY KEY (visit_id, symptom_id);
ALTER TABLE public.visit_tests ADD CONSTRAINT visit_tests_pkey PRIMARY KEY (visit_id, test_id);

ALTER TABLE public.cash_close_reports ADD CONSTRAINT cash_close_reports_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES cash_shifts(id) ON DELETE RESTRICT;
ALTER TABLE public.clinical_visits ADD CONSTRAINT clinical_visits_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
ALTER TABLE public.clinical_visits ADD CONSTRAINT clinical_visits_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL;
ALTER TABLE public.clinical_visits ADD CONSTRAINT clinical_visits_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES pet_owners(id) ON DELETE SET NULL;
ALTER TABLE public.clinical_visits ADD CONSTRAINT clinical_visits_pet_id_fkey FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinical_visits(id) ON DELETE CASCADE;
ALTER TABLE public.surgeries ADD CONSTRAINT surgeries_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES doctors(id);
ALTER TABLE public.surgeries ADD CONSTRAINT surgeries_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES pet_owners(id);
ALTER TABLE public.surgeries ADD CONSTRAINT surgeries_pet_id_fkey FOREIGN KEY (pet_id) REFERENCES pets(id);
ALTER TABLE public.surgeries ADD CONSTRAINT surgeries_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinical_visits(id) ON DELETE SET NULL;
ALTER TABLE public.visit_advice ADD CONSTRAINT visit_advice_advice_id_fkey FOREIGN KEY (advice_id) REFERENCES advice_templates(id) ON DELETE CASCADE;
ALTER TABLE public.visit_advice ADD CONSTRAINT visit_advice_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinical_visits(id) ON DELETE CASCADE;
ALTER TABLE public.visit_diagnoses ADD CONSTRAINT visit_diagnoses_diagnosis_id_fkey FOREIGN KEY (diagnosis_id) REFERENCES diagnoses(id) ON DELETE CASCADE;
ALTER TABLE public.visit_diagnoses ADD CONSTRAINT visit_diagnoses_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinical_visits(id) ON DELETE CASCADE;
ALTER TABLE public.visit_symptoms ADD CONSTRAINT visit_symptoms_symptom_id_fkey FOREIGN KEY (symptom_id) REFERENCES symptoms(id) ON DELETE CASCADE;
ALTER TABLE public.visit_symptoms ADD CONSTRAINT visit_symptoms_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinical_visits(id) ON DELETE CASCADE;
ALTER TABLE public.visit_tests ADD CONSTRAINT visit_tests_test_id_fkey FOREIGN KEY (test_id) REFERENCES medical_tests(id) ON DELETE CASCADE;
ALTER TABLE public.visit_tests ADD CONSTRAINT visit_tests_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinical_visits(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS appointments_doctor_id_idx ON public.appointments USING btree (doctor_id);
CREATE INDEX IF NOT EXISTS appointments_owner_id_idx ON public.appointments USING btree (owner_id);
CREATE INDEX IF NOT EXISTS appointments_pet_id_idx ON public.appointments USING btree (pet_id);
CREATE INDEX IF NOT EXISTS appointments_scheduled_at_idx ON public.appointments USING btree (scheduled_at DESC);
CREATE INDEX IF NOT EXISTS appointments_status_idx ON public.appointments USING btree (status);
CREATE INDEX IF NOT EXISTS clinical_visits_date_idx ON public.clinical_visits USING btree (visit_date DESC);
CREATE INDEX IF NOT EXISTS clinical_visits_doctor_idx ON public.clinical_visits USING btree (doctor_id);
CREATE INDEX IF NOT EXISTS clinical_visits_owner_idx ON public.clinical_visits USING btree (owner_id);
CREATE INDEX IF NOT EXISTS clinical_visits_pet_idx ON public.clinical_visits USING btree (pet_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS ix_appointments_problem_id ON public.appointments USING btree (problem_id);
CREATE INDEX IF NOT EXISTS ix_appointments_sale_id ON public.appointments USING btree (sale_id);
CREATE INDEX IF NOT EXISTS ix_appointments_scheduled_at ON public.appointments USING btree (scheduled_at);
CREATE INDEX IF NOT EXISTS ix_sales_cashier_created ON public.sales USING btree (cashier_id, created_at);
CREATE INDEX IF NOT EXISTS ix_sales_source_created ON public.sales USING btree (source, created_at);
CREATE INDEX IF NOT EXISTS pet_owners_phone_idx ON public.pet_owners USING btree (phone);
CREATE INDEX IF NOT EXISTS pets_owner_id_idx ON public.pets USING btree (owner_id);
CREATE INDEX IF NOT EXISTS prescriptions_pet_idx ON public.prescriptions USING btree (pet_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_visit_idx ON public.prescriptions USING btree (visit_id);
CREATE INDEX IF NOT EXISTS products_prescribable_idx ON public.products USING btree (is_prescribable) WHERE is_prescribable;
CREATE INDEX IF NOT EXISTS products_project_idx ON public.products USING btree (project);
CREATE INDEX IF NOT EXISTS sales_created_at_idx ON public.sales USING btree (created_at);
CREATE INDEX IF NOT EXISTS sales_project_created_idx ON public.sales USING btree (project, created_at);
CREATE INDEX IF NOT EXISTS surgeries_date_idx ON public.surgeries USING btree (surgery_date DESC);
CREATE INDEX IF NOT EXISTS surgeries_doctor_idx ON public.surgeries USING btree (doctor_id);
CREATE INDEX IF NOT EXISTS surgeries_pet_idx ON public.surgeries USING btree (pet_id);
CREATE INDEX IF NOT EXISTS surgeries_visit_idx ON public.surgeries USING btree (visit_id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_external_ref_uidx ON public.sales USING btree (external_ref) WHERE (external_ref IS NOT NULL);
CREATE OR REPLACE FUNCTION public.appointments_sync_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.pet_id IS NOT NULL THEN
    SELECT owner_id INTO NEW.owner_id FROM public.pets WHERE id = NEW.pet_id;
  END IF;
  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.cancel_expense(_expense_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  DELETE FROM public.cash_movements WHERE source = 'expense' AND source_id = _e.id;
  DELETE FROM public.expenses WHERE id = _e.id;
  RETURN jsonb_build_object('cancelled', true, 'voucher_no', _j->>'voucher_no', 'amount', _e.amount);
END; $function$

;

CREATE OR REPLACE FUNCTION public.cancel_online_order(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := public.online_auth(p->>'secret');
  v_sale record; si record; v_back numeric;
begin
  select * into v_sale from sales where external_ref = p->>'order_ref' for update;
  if not found then return jsonb_build_object('ok', true, 'missing', true); end if;
  if v_sale.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_sale.paid > 0 then raise exception 'এই বিক্রিতে টাকা জমা হয়েছে — POS থেকে রিটার্ন করুন'; end if;
  for si in select * from sale_items where sale_id = v_sale.id loop
    v_back := si.qty - coalesce(si.returned_qty, 0);
    if v_back > 0 then
      update medicine_batches set qty_on_hand = qty_on_hand + v_back where id = si.batch_id;
      insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
      values (si.batch_id, si.medicine_id, 'sale_cancel', v_back, 'sales', v_sale.id, uid);
    end if;
  end loop;
  update sales set status = 'cancelled', due = 0 where id = v_sale.id;
  insert into audit_log (actor, action, entity, entity_id, details)
  values (uid, 'online_order_cancel', 'sales', v_sale.id, jsonb_build_object('order_ref', p->>'order_ref'));
  return jsonb_build_object('ok', true, 'invoice_no', v_sale.invoice_no);
end $function$

;

CREATE OR REPLACE FUNCTION public.cost_stock_out(_product_id uuid, _qty numeric, _unit_cost numeric, _source text, _ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p record; _left numeric; _new numeric;
BEGIN
  SELECT stock_quantity, purchase_price INTO _p FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  _left := COALESCE(_p.stock_quantity, 0) - _qty;
  _new := _p.purchase_price;
  IF _left > 0 AND COALESCE(_p.stock_quantity, 0) > 0 AND _unit_cost IS NOT NULL THEN
    _new := (_p.stock_quantity * _p.purchase_price - _qty * _unit_cost) / _left;
    IF _new IS NULL OR _new <= 0 THEN _new := _p.purchase_price; END IF;
    _new := round(_new, 4);
  END IF;
  UPDATE public.products SET stock_quantity = GREATEST(_left, 0), purchase_price = _new WHERE id = _product_id;
  IF _new IS DISTINCT FROM _p.purchase_price THEN
    INSERT INTO public.product_cost_history(product_id, old_cost, new_cost, quantity, unit_cost, source, ref_no)
    VALUES (_product_id, _p.purchase_price, _new, -_qty, _unit_cost, _source, _ref);
  END IF;
END; $function$

;

CREATE OR REPLACE FUNCTION public.next_visit_no()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'V' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYMM') || '-' ||
         lpad(nextval('public.clinical_visit_seq')::TEXT, 5, '0');
$function$

;

CREATE OR REPLACE FUNCTION public.online_act_as(_uid uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid::text, true);
$function$

;

CREATE OR REPLACE FUNCTION public.online_auth(p_secret text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner uuid;
begin
  select owner_user into v_owner from online_integration
   where id = 1 and secret_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex');
  if v_owner is null then raise exception 'Invalid key'; end if;
  return v_owner;
end $function$

;

CREATE OR REPLACE FUNCTION public.online_list_medicines(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  perform public.online_auth(p->>'secret');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'strength', m.strength, 'form', m.dosage_form,
      'unit', m.sale_unit, 'manufacturer', m.manufacturer,
      'price', coalesce((select max(b.sale_price) from medicine_batches b where b.medicine_id = m.id), m.default_price),
      'stock', coalesce((select sum(b.qty_on_hand) from medicine_batches b
                          where b.medicine_id = m.id and b.expiry_date > v_today), 0)
    ) order by m.name)
    from medicines m where m.is_active), '[]'::jsonb);
end $function$

;

CREATE OR REPLACE FUNCTION public.sync_product_batches(_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _left numeric; _b record; _q numeric;
BEGIN
  SELECT GREATEST(COALESCE(stock_quantity, 0), 0) INTO _left FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RETURN; END IF;
  FOR _b IN
    SELECT id, quantity, COALESCE(received_quantity, quantity, 0) AS rq
    FROM public.stock_batches
    WHERE product_id = _product_id
    ORDER BY expiry_date DESC NULLS FIRST, received_at DESC, id DESC
  LOOP
    _q := LEAST(GREATEST(_b.rq, 0), _left);
    _left := _left - _q;
    IF _b.quantity IS DISTINCT FROM _q THEN
      UPDATE public.stock_batches SET quantity = _q WHERE id = _b.id;
    END IF;
  END LOOP;
END; $function$

;

CREATE OR REPLACE FUNCTION public.trg_lock_closed_expenses()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _msg text := 'The cash drawer for this expense is closed — it cannot be cancelled or changed.';
BEGIN
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
END; $function$

;

CREATE OR REPLACE FUNCTION public.trg_lock_closed_sales()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _msg text := 'This bill is from a closed cash drawer shift — it cannot be edited or cancelled. Use Return instead.';
BEGIN
  IF TG_TABLE_NAME = 'sale_returns' THEN
    IF NEW.return_type = 'cancel' AND public.sale_locked(NEW.sale_id) THEN RAISE EXCEPTION '%', _msg; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF OLD.sale_id IS NOT NULL AND public.sale_locked(OLD.sale_id) THEN
      IF TG_OP = 'DELETE' OR NEW.method IS DISTINCT FROM OLD.method OR NEW.amount IS DISTINCT FROM OLD.amount THEN
        RAISE EXCEPTION '%', _msg;
      END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
  ELSE
    IF (NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.notes IS DISTINCT FROM OLD.notes)
       AND public.sale_locked(OLD.id) THEN
      RAISE EXCEPTION '%', _msg;
    END IF;
    RETURN NEW;
  END IF;
END; $function$
;
CREATE OR REPLACE FUNCTION public.create_pos_sale(_owner_id uuid, _items jsonb, _payments jsonb, _discount numeric DEFAULT 0, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$

;

CREATE OR REPLACE FUNCTION public.create_project_sale(_project text, _owner_id uuid, _items jsonb, _payments jsonb, _discount numeric DEFAULT 0, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _res jsonb; _bad text;
BEGIN
  IF _project NOT IN ('pcv','ss') THEN RAISE EXCEPTION 'Unknown project %', _project; END IF;
  SELECT string_agg(p.name, ', ') INTO _bad
  FROM jsonb_array_elements(_items) x JOIN public.products p ON p.id = NULLIF(x->>'product_id','')::uuid
  WHERE p.project <> _project;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'These products belong to the other project: %. Make a separate bill for them.', _bad;
  END IF;

  IF NOT public.pos_out_of_stock_allowed() THEN
    SELECT string_agg(format('%s (stock %s, bill %s)', p.name, trim_scale(COALESCE(p.stock_quantity, 0)), trim_scale(q.qty)), ', ') INTO _bad
    FROM (
      SELECT NULLIF(x->>'product_id','')::uuid AS pid, SUM((x->>'quantity')::numeric) AS qty
      FROM jsonb_array_elements(_items) x WHERE NULLIF(x->>'product_id','') IS NOT NULL GROUP BY 1
    ) q JOIN public.products p ON p.id = q.pid
    WHERE NOT COALESCE((to_jsonb(p)->>'no_stock')::boolean, false) AND q.qty > COALESCE(p.stock_quantity, 0);
    IF _bad IS NOT NULL THEN
      RAISE EXCEPTION 'Out of stock: %. Selling out-of-stock items is turned off.', _bad;
    END IF;
  END IF;

  PERFORM set_config('app.sale_project', _project, true);
  IF to_regprocedure('public.create_pos_sale(uuid,jsonb,jsonb,numeric,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.create_pos_sale($1,$2,$3,$4,$5)' INTO _res USING _owner_id, _items, _payments, COALESCE(_discount,0), _notes;
  ELSE
    _res := public.create_sale(_owner_id, _items, COALESCE(_payments,'[]'::jsonb), COALESCE(_discount,0), _notes);
  END IF;
  PERFORM set_config('app.sale_project', '', true);
  RETURN _res || jsonb_build_object('project', _project);
END; $function$

;

CREATE OR REPLACE FUNCTION public.delete_purchase_invoice(_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _item record; _inv record; _bad text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF NOT COALESCE(_inv.pending_receipt, false)
     AND (_inv.created_at AT TIME ZONE 'Asia/Dhaka')::date <> (now() AT TIME ZONE 'Asia/Dhaka')::date THEN
    RAISE EXCEPTION 'A purchase can be %ed only on the day it was entered (%). Use Return instead.', 'delet',
      to_char(_inv.created_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY');
  END IF;

  IF NOT COALESCE(_inv.pending_receipt, false) THEN
    SELECT string_agg(i.name, ', ') INTO _bad
    FROM public.purchase_invoice_items i JOIN public.products p ON p.id = i.product_id
    WHERE i.invoice_id = _invoice_id AND NOT i.no_stock AND (i.quantity - i.returned_quantity) > COALESCE(p.stock_quantity, 0);
    IF _bad IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot delete: stock is lower than this invoice for %. Some of it is already sold — use Return for what is left.', _bad;
    END IF;
  END IF;

  FOR _item IN SELECT * FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id LOOP
    IF NOT _item.no_stock AND NOT COALESCE(_inv.pending_receipt, false) THEN
      PERFORM public.cost_stock_out(_item.product_id, _item.quantity - _item.returned_quantity,
                                    COALESCE(_item.landed_cost, _item.purchase_price), 'purchase_delete', _inv.invoice_no);
    END IF;
    IF _item.batch_id IS NOT NULL THEN
      DELETE FROM public.stock_batches WHERE id = _item.batch_id;
    END IF;
  END LOOP;

  IF _inv.supplier_id IS NOT NULL THEN
    PERFORM 1 FROM public.suppliers WHERE id = _inv.supplier_id FOR UPDATE;
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) - (_inv.due + _inv.paid)
      WHERE id = _inv.supplier_id;
  END IF;

  UPDATE public.supplier_payments
    SET notes = COALESCE(notes || ' — ', '') || 'Invoice ' || _inv.invoice_no || ' deleted; kept as supplier advance',
        invoice_id = NULL
    WHERE invoice_id = _invoice_id;

  DELETE FROM public.expenses WHERE purchase_invoice_id = _invoice_id;
  DELETE FROM public.purchase_invoices WHERE id = _invoice_id;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.post_online_order(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := public.online_auth(p->>'secret');
  v_ref text := nullif(trim(p->>'order_ref'), '');
  v_existing record; v_cust uuid; v_phone text; v_name text;
  v_id uuid; v_no text; it jsonb; b record; m record;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_need numeric; v_take numeric; v_price numeric;
  v_sub numeric(14,2) := 0;
begin
  if v_ref is null then raise exception 'Missing order_ref'; end if;
  select id, invoice_no, status into v_existing from sales where external_ref = v_ref;
  if found and v_existing.status <> 'cancelled' then
    return jsonb_build_object('sale_id', v_existing.id, 'invoice_no', v_existing.invoice_no, 'duplicate', true);
  end if;
  if found then
    update sales set external_ref = external_ref || '-cancelled-' || extract(epoch from now())::bigint where id = v_existing.id;
  end if;
  if jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then raise exception 'No items'; end if;

  v_phone := regexp_replace(coalesce(p->'customer'->>'phone', ''), '\D', '', 'g');
  if v_phone ~ '^8801' then v_phone := substr(v_phone, 3); end if;
  v_name := coalesce(nullif(trim(p->'customer'->>'name'), ''), 'Online customer');
  select id into v_cust from customers where phone = v_phone;
  if v_cust is null then
    insert into customers (name, phone, address, notes)
    values (v_name, nullif(v_phone, ''), p->'customer'->>'address', 'dibedex.com online order')
    returning id into v_cust;
  end if;

  v_id := gen_random_uuid();
  v_no := 'INV-' || lpad(nextval('invoice_no_seq')::text, 6, '0');
  insert into sales (id, invoice_no, idempotency_key, customer_id, subtotal, total, created_by, source, external_ref)
  values (v_id, v_no, gen_random_uuid(), v_cust, 0, 0, uid, 'online', v_ref);

  for it in select * from jsonb_array_elements(p->'items') loop
    v_need := (it->>'qty')::numeric;
    if v_need is null or v_need <= 0 then raise exception 'Quantity must be positive'; end if;
    select * into m from medicines where id = (it->>'medicine_id')::uuid;
    if not found or not m.is_active then raise exception 'Medicine not available in POS'; end if;
    if (select coalesce(sum(qty_on_hand), 0) from medicine_batches
         where medicine_id = m.id and expiry_date > v_today) < v_need then
      raise exception 'POS-এ স্টক নেই: % (দরকার %)', m.name, v_need;
    end if;
    for b in select * from medicine_batches
              where medicine_id = m.id and expiry_date > v_today and qty_on_hand > 0
              order by expiry_date, created_at for update loop
      exit when v_need <= 0;
      v_take := least(v_need, b.qty_on_hand);
      v_price := coalesce(round(nullif(it->>'unit_price', '')::numeric, 2), b.sale_price);
      update medicine_batches set qty_on_hand = qty_on_hand - v_take where id = b.id;
      insert into sale_items (sale_id, medicine_id, batch_id, medicine_name, batch_no, expiry_date, qty,
                              unit_price, list_price, discount, unit_cost, line_total)
      values (v_id, m.id, b.id, m.name, b.batch_no, b.expiry_date, v_take,
              v_price, b.sale_price, 0, b.unit_cost, round(v_take * v_price, 2));
      insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
      values (b.id, m.id, 'sale', -v_take, 'sales', v_id, uid);
      v_sub := v_sub + round(v_take * v_price, 2);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then raise exception 'POS-এ স্টক নেই: %', m.name; end if;
  end loop;

  update sales set subtotal = v_sub, total = v_sub, paid = 0, due = v_sub where id = v_id;
  insert into audit_log (actor, action, entity, entity_id, details)
  values (uid, 'online_order', 'sales', v_id, jsonb_build_object('order_ref', v_ref, 'note', p->>'note'));
  return jsonb_build_object('sale_id', v_id, 'invoice_no', v_no, 'duplicate', false);
end $function$

;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(_supplier_id uuid, _invoice_id uuid, _amount numeric, _method payment_method DEFAULT 'cash'::payment_method, _reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _paid_at date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _sup uuid; _first uuid; _pay uuid; _left numeric; _a numeric; _inv record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF COALESCE(_amount, 0) <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  _sup := _supplier_id;
  IF _invoice_id IS NOT NULL AND _sup IS NULL THEN
    SELECT supplier_id INTO _sup FROM public.purchase_invoices WHERE id = _invoice_id;
  END IF;

  IF _sup IS NULL THEN
    IF _invoice_id IS NULL THEN RAISE EXCEPTION 'choose a supplier or an invoice'; END IF;
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
    VALUES (NULL, _invoice_id, _amount, COALESCE(_method,'cash'), _reference, _notes, COALESCE(_paid_at, CURRENT_DATE), auth.uid())
    RETURNING id INTO _first;
    UPDATE public.purchase_invoices
      SET paid = paid + _amount,
          due = GREATEST(due - _amount, 0),
          status = CASE WHEN status IN ('returned','partially_returned') THEN status
                        WHEN due - _amount <= 0 THEN 'paid' ELSE 'posted' END
      WHERE id = _invoice_id;
    RETURN _first;
  END IF;

  PERFORM 1 FROM public.suppliers WHERE id = _sup FOR UPDATE;
  _left := _amount;

  FOR _inv IN
    SELECT id, due FROM public.purchase_invoices
    WHERE supplier_id = _sup AND due > 0
    ORDER BY (id IS NOT DISTINCT FROM _invoice_id) DESC, invoice_date, created_at
    FOR UPDATE
  LOOP
    EXIT WHEN _left <= 0;
    _a := LEAST(_inv.due, _left);
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
    VALUES (_sup, _inv.id, _a, COALESCE(_method,'cash'), _reference, _notes, COALESCE(_paid_at, CURRENT_DATE), auth.uid())
    RETURNING id INTO _pay;
    _first := COALESCE(_first, _pay);
    UPDATE public.purchase_invoices
      SET paid = paid + _a,
          due = GREATEST(due - _a, 0),
          status = CASE WHEN status IN ('returned','partially_returned') THEN status
                        WHEN due - _a <= 0 THEN 'paid' ELSE 'posted' END
      WHERE id = _inv.id;
    _left := _left - _a;
  END LOOP;

  IF _left > 0 THEN
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
    VALUES (_sup, NULL, _left, COALESCE(_method,'cash'), _reference,
            COALESCE(_notes || ' — ', '') || 'Advance to supplier', COALESCE(_paid_at, CURRENT_DATE), auth.uid())
    RETURNING id INTO _pay;
    _first := COALESCE(_first, _pay);
  END IF;

  UPDATE public.suppliers SET balance_due = COALESCE(balance_due, 0) - _amount WHERE id = _sup;
  RETURN _first;
END; $function$
;
CREATE OR REPLACE FUNCTION public.create_clinic_bill(_appointment_id uuid, _owner_id uuid, _doctor_id uuid, _lines jsonb, _payments jsonb, _discount numeric DEFAULT 0, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _appt public.appointments%ROWTYPE;
  _items jsonb := '[]'::jsonb;
  _line jsonb; _res jsonb; _sale_id uuid; _kind text;
  _svc public.clinic_services%ROWTYPE;
  _qty numeric; _line_total numeric; _mat_cost numeric; _fee numeric;
  _item_id uuid; _m record; _paid numeric;
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
END; $function$

;

CREATE OR REPLACE FUNCTION public.create_purchase_return(_invoice_id uuid, _items jsonb, _reason text DEFAULT NULL::text, _refund_method payment_method DEFAULT NULL::payment_method, _restock boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _return_id uuid; _return_no text; _item jsonb; _inv_item record; _inv record;
  _qty numeric; _line_total numeric; _refund_total numeric := 0;
  _new_total numeric; _new_paid numeric; _new_due numeric; _method payment_method;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  _method := CASE WHEN _inv.stock_only THEN NULL ELSE _refund_method END;
  IF _inv.supplier_id IS NOT NULL AND NOT _inv.stock_only THEN
    PERFORM 1 FROM public.suppliers WHERE id = _inv.supplier_id FOR UPDATE;
  END IF;

  _return_no := public.next_purchase_return_no();
  INSERT INTO public.purchase_returns(return_no, invoice_id, reason, refund_method, refund_amount, restock, processed_by)
  VALUES (_return_no, _invoice_id, _reason, _method, 0, COALESCE(_restock,true), auth.uid())
  RETURNING id INTO _return_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    IF _qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO _inv_item FROM public.purchase_invoice_items
      WHERE id = (_item->>'invoice_item_id')::uuid AND invoice_id = _invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice item not found'; END IF;
    IF _qty > (_inv_item.quantity - _inv_item.returned_quantity) THEN
      RAISE EXCEPTION 'return quantity exceeds remaining for %', _inv_item.name;
    END IF;

    _line_total := round(_qty * (_inv_item.line_total / NULLIF(_inv_item.quantity,0))::numeric, 2);
    _refund_total := _refund_total + _line_total;

    INSERT INTO public.purchase_return_items(return_id, invoice_item_id, product_id, name, quantity, unit_price, line_total)
    VALUES (_return_id, _inv_item.id, _inv_item.product_id, _inv_item.name, _qty, _inv_item.purchase_price, _line_total);

    UPDATE public.purchase_invoice_items SET returned_quantity = returned_quantity + _qty WHERE id = _inv_item.id;
    IF NOT _inv_item.no_stock THEN
      PERFORM public.cost_stock_out(_inv_item.product_id, _qty, COALESCE(_inv_item.landed_cost, _inv_item.purchase_price), 'purchase_return', _return_no);
      IF _inv_item.batch_id IS NOT NULL THEN
        UPDATE public.stock_batches
          SET received_quantity = GREATEST(COALESCE(received_quantity, quantity) - _qty, 0)
          WHERE id = _inv_item.batch_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.purchase_returns SET refund_amount = _refund_total WHERE id = _return_id;

  _new_total := GREATEST(_inv.total - _refund_total, 0);
  IF _inv.stock_only THEN
    _new_paid := 0; _new_due := 0;
  ELSIF _method IS NOT NULL THEN
    _new_paid := GREATEST(_inv.paid - _refund_total, 0);
    _new_due := GREATEST(_new_total - _new_paid, 0);
  ELSE
    _new_paid := _inv.paid;
    _new_due := GREATEST(_new_total - _new_paid, 0);
  END IF;

  UPDATE public.purchase_invoices
    SET total = _new_total, paid = _new_paid, due = _new_due,
        status = CASE
          WHEN (SELECT SUM(quantity - returned_quantity) FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id) <= 0
          THEN 'returned' ELSE 'partially_returned' END
    WHERE id = _invoice_id;

  IF NOT _inv.stock_only THEN
    IF _method IS NOT NULL AND _refund_total > 0 THEN
      INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
      VALUES (_inv.supplier_id, _invoice_id, -_refund_total, _method,
              'Refund ' || _return_no, _reason, CURRENT_DATE, auth.uid());
    ELSIF _inv.supplier_id IS NOT NULL AND _refund_total > 0 THEN
      UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) - _refund_total WHERE id = _inv.supplier_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('return_id', _return_id, 'return_no', _return_no, 'refund_amount', _refund_total);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.create_return(_sale_id uuid, _items jsonb, _reason text DEFAULT NULL::text, _refund_method payment_method DEFAULT NULL::payment_method, _restock boolean DEFAULT true, _client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sale public.sales%ROWTYPE; _return_id uuid; _return_no text; _item jsonb;
  _sale_item public.sale_items%ROWTYPE; _qty numeric; _line_total numeric; _refund_total numeric := 0;
  _gross numeric; _factor numeric := 1; _prior_returns numeric; _net_paid numeric;
  _net_total_before numeric; _due_before numeric; _due_reduction numeric; _cash_back numeric; _result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _client_request_id IS NULL THEN RAISE EXCEPTION 'request id required'; END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'choose at least one item'; END IF;

  SELECT jsonb_build_object('return_id', id, 'return_no', return_no, 'refund_amount', refund_amount,
    'refund_paid', refund_paid, 'due_reduction', due_reduction, 'duplicate', true)
  INTO _result FROM public.sale_returns WHERE client_request_id = _client_request_id;
  IF _result IS NOT NULL THEN RETURN _result; END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF _sale.status IN ('void','refunded') THEN RAISE EXCEPTION 'sale is already closed'; END IF;

  PERFORM 1 FROM public.sale_items WHERE sale_id = _sale_id ORDER BY id FOR UPDATE;
  SELECT COALESCE(SUM(line_total),0) INTO _gross FROM public.sale_items WHERE sale_id = _sale_id;
  IF _gross > 0 AND _sale.discount > 0 THEN _factor := GREATEST(0, 1 - (_sale.discount / _gross)); END IF;

  SELECT COALESCE(SUM(refund_amount),0) INTO _prior_returns FROM public.sale_returns WHERE sale_id = _sale_id;
  SELECT COALESCE(SUM(amount),0) INTO _net_paid FROM public.payments WHERE sale_id = _sale_id;
  _net_total_before := GREATEST(_sale.total - _prior_returns, 0);
  _due_before := GREATEST(_net_total_before - _net_paid, 0);

  _return_no := public.next_return_no();
  INSERT INTO public.sale_returns(sale_id, return_no, reason, refund_method, refund_amount, refund_paid,
    due_reduction, restock, return_type, client_request_id, processed_by)
  VALUES (_sale_id, _return_no, NULLIF(trim(_reason),''), _refund_method, 0, 0, 0,
    COALESCE(_restock,true), 'partial', _client_request_id, auth.uid())
  RETURNING id INTO _return_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_item->>'quantity')::numeric,0);
    IF _qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO _sale_item FROM public.sale_items
      WHERE id = (_item->>'sale_item_id')::uuid AND sale_id = _sale_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sale item not found'; END IF;
    IF _qty > _sale_item.quantity - _sale_item.returned_quantity THEN
      RAISE EXCEPTION 'return quantity exceeds remaining for %', _sale_item.name;
    END IF;
    _line_total := round(_qty * (_sale_item.line_total / NULLIF(_sale_item.quantity,0)) * _factor, 2);
    _refund_total := _refund_total + _line_total;
    INSERT INTO public.sale_return_items(return_id,sale_item_id,product_id,name,quantity,unit_price,line_total)
    VALUES (_return_id,_sale_item.id,_sale_item.product_id,_sale_item.name,_qty,
      round((_sale_item.line_total / NULLIF(_sale_item.quantity,0)) * _factor,2),_line_total);
    UPDATE public.sale_items SET returned_quantity = returned_quantity + _qty WHERE id = _sale_item.id;
    IF COALESCE(_restock,true) AND _sale_item.product_id IS NOT NULL THEN
      IF COALESCE(_sale_item.cost_price, 0) > 0 AND to_regprocedure('public.cost_stock_in(uuid,numeric,numeric,text,text)') IS NOT NULL THEN
        EXECUTE 'SELECT public.cost_stock_in($1,$2,$3,$4,$5)' USING _sale_item.product_id, _qty, _sale_item.cost_price, 'sale_return', _return_no;
      ELSE
        UPDATE public.products SET stock_quantity = stock_quantity + _qty WHERE id = _sale_item.product_id;
      END IF;
    END IF;
  END LOOP;

  IF _refund_total <= 0.004 THEN RAISE EXCEPTION 'choose at least one item'; END IF;
  _due_reduction := LEAST(_refund_total, _due_before);
  _cash_back := _refund_total - _due_reduction;
  IF _cash_back > 0.004 AND (_refund_method IS NULL OR _refund_method = 'due') THEN
    RAISE EXCEPTION 'refund method required for customer payout';
  END IF;
  IF _cash_back > 0.004 AND _refund_method = 'cash'
     AND NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE status = 'open') THEN
    RAISE EXCEPTION 'Open the cash drawer shift first — % cash is paid back.', round(_cash_back, 2);
  END IF;

  UPDATE public.sale_returns SET refund_amount=_refund_total, refund_paid=_cash_back,
    due_reduction=_due_reduction WHERE id=_return_id;
  IF _cash_back > 0.004 THEN
    INSERT INTO public.payments(sale_id,method,amount,reference,return_id,client_request_id)
    VALUES (_sale_id,_refund_method,-_cash_back,'Refund '||_return_no,_return_id,_client_request_id);
  END IF;
  PERFORM public.recalc_sale_totals(_sale_id);

  RETURN jsonb_build_object('return_id',_return_id,'return_no',_return_no,'refund_amount',_refund_total,
    'refund_paid',_cash_back,'due_reduction',_due_reduction,'duplicate',false);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.create_purchase_invoice(_supplier_id uuid, _supplier_invoice_no text, _invoice_date date, _items jsonb, _discount numeric DEFAULT 0, _vat numeric DEFAULT 0, _freight numeric DEFAULT 0, _paid numeric DEFAULT 0, _payment_method payment_method DEFAULT 'cash'::payment_method, _notes text DEFAULT NULL::text, _stock_only boolean DEFAULT false, _pending boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _invoice_id uuid; _invoice_no text; _l record;
  _subtotal numeric := 0; _total numeric; _due numeric; _status text; _batch_id uuid; _product_name text;
  _bal numeric; _credit numeric := 0; _pay numeric; _pend boolean := COALESCE(_pending, false);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  _invoice_no := public.next_purchase_invoice_no();
  SELECT COALESCE(SUM(line_total), 0) INTO _subtotal FROM public.purchase_lines(_items, _freight);
  _total := _subtotal - COALESCE(_discount,0) + COALESCE(_vat,0) + COALESCE(_freight,0);

  IF COALESCE(_stock_only, false) THEN
    _pay := 0; _due := 0; _status := 'stock';
  ELSE
    _pay := COALESCE(_paid,0);
    _due := GREATEST(_total - _pay, 0);
    IF _supplier_id IS NOT NULL THEN
      SELECT COALESCE(balance_due,0) INTO _bal FROM public.suppliers WHERE id = _supplier_id FOR UPDATE;
      _credit := LEAST(GREATEST(-COALESCE(_bal,0), 0), _due);
    END IF;
    _status := CASE WHEN _due - _credit <= 0 AND _total > 0 THEN 'paid' ELSE 'posted' END;
  END IF;

  INSERT INTO public.purchase_invoices(
    invoice_no, supplier_invoice_no, supplier_id, invoice_date,
    subtotal, discount, vat, freight, total, paid, due, credit_applied, notes, created_by, status, stock_only,
    pending_receipt, received_at
  ) VALUES (
    _invoice_no, _supplier_invoice_no, _supplier_id, COALESCE(_invoice_date, CURRENT_DATE),
    _subtotal, COALESCE(_discount,0), COALESCE(_vat,0), COALESCE(_freight,0),
    _total, _pay + _credit, _due - _credit, _credit, _notes, auth.uid(), _status, COALESCE(_stock_only, false),
    _pend, CASE WHEN _pend THEN NULL ELSE now() END
  ) RETURNING id INTO _invoice_id;

  FOR _l IN SELECT * FROM public.purchase_lines(_items, _freight) LOOP
    IF _l.qty IS NULL OR _l.qty <= 0 THEN RAISE EXCEPTION 'quantity must be above 0'; END IF;
    _batch_id := NULL;
    IF _pend THEN
      NULL;
    ELSIF _l.no_stock THEN
      UPDATE public.products SET purchase_price = round(_l.landed, 4) WHERE id = _l.product_id;
    ELSE
      INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, received_quantity, purchase_price, expiry_date, notes)
      VALUES (_l.product_id, _supplier_id, NULLIF(_l.item->>'batch_no',''), _l.qty, _l.qty, round(_l.landed, 4),
              NULLIF(_l.item->>'expiry_date','')::date, 'Invoice ' || _invoice_no)
      RETURNING id INTO _batch_id;
      PERFORM public.cost_stock_in(_l.product_id, _l.qty, _l.landed, 'purchase', _invoice_no);
    END IF;
    UPDATE public.products
      SET selling_price = CASE WHEN NULLIF(_l.item->>'new_selling_price','') IS NOT NULL
                               THEN (_l.item->>'new_selling_price')::numeric ELSE selling_price END
      WHERE id = _l.product_id
      RETURNING name INTO _product_name;

    INSERT INTO public.purchase_invoice_items(
      invoice_id, product_id, name, quantity, purchase_price, discount,
      line_total, batch_no, expiry_date, batch_id, no_stock, freight_share, landed_cost, freight_fixed
    ) VALUES (
      _invoice_id, _l.product_id, COALESCE(_product_name, _l.item->>'name'),
      _l.qty, _l.price, _l.disc, _l.line_total,
      NULLIF(_l.item->>'batch_no',''), NULLIF(_l.item->>'expiry_date','')::date, _batch_id,
      _l.no_stock, _l.share, round(_l.landed, 4), _l.fixed
    );
  END LOOP;

  IF _supplier_id IS NOT NULL AND _due > 0 THEN
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) + _due WHERE id = _supplier_id;
  END IF;

  IF _pay > 0 THEN
    INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, paid_at, created_by)
    VALUES (_supplier_id, _invoice_id, _pay, COALESCE(_payment_method,'cash'),
            'Against ' || _invoice_no, COALESCE(_invoice_date, CURRENT_DATE), auth.uid());
  END IF;

  RETURN jsonb_build_object('invoice_id', _invoice_id, 'invoice_no', _invoice_no,
                            'total', _total, 'paid', _pay + _credit, 'due', _due - _credit,
                            'credit_applied', _credit, 'status', _status, 'stock_only', COALESCE(_stock_only, false),
                            'pending_receipt', _pend);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.update_purchase_invoice(_invoice_id uuid, _supplier_id uuid, _supplier_invoice_no text, _invoice_date date, _items jsonb, _discount numeric DEFAULT 0, _vat numeric DEFAULT 0, _freight numeric DEFAULT 0, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv record; _old record; _l record; _bad text;
  _subtotal numeric := 0; _total numeric; _due numeric; _status text; _batch_id uuid; _product_name text; _stock_only boolean;
  _pend boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only an admin can edit a purchase'; END IF;
  IF jsonb_array_length(COALESCE(_items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'no items'; END IF;

  SELECT * INTO _inv FROM public.purchase_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  _pend := COALESCE(_inv.pending_receipt, false);
  IF NOT _pend AND (_inv.created_at AT TIME ZONE 'Asia/Dhaka')::date <> (now() AT TIME ZONE 'Asia/Dhaka')::date THEN
    RAISE EXCEPTION 'A purchase can be %ed only on the day it was entered (%). Use Return instead.', 'edit',
      to_char(_inv.created_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY');
  END IF;
  _stock_only := COALESCE(_inv.stock_only, false);

  IF EXISTS (SELECT 1 FROM public.purchase_returns WHERE invoice_id = _invoice_id)
     OR EXISTS (SELECT 1 FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id AND returned_quantity > 0) THEN
    RAISE EXCEPTION 'This purchase has a return, so it cannot be edited.';
  END IF;

  IF NOT _pend THEN
    SELECT string_agg(p.name, ', ') INTO _bad
    FROM (
      SELECT pid, SUM(q) AS delta FROM (
        SELECT product_id AS pid, -quantity AS q FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id AND NOT no_stock
        UNION ALL
        SELECT product_id, qty FROM public.purchase_lines(_items, _freight) WHERE NOT no_stock
      ) t GROUP BY pid
    ) d JOIN public.products p ON p.id = d.pid
    WHERE COALESCE(p.stock_quantity, 0) + d.delta < 0;
    IF _bad IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot lower % that much: some of that stock is already sold.', _bad;
    END IF;
  END IF;

  FOR _old IN SELECT * FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id LOOP
    IF NOT _old.no_stock AND NOT _pend THEN
      PERFORM public.cost_stock_out(_old.product_id, _old.quantity, COALESCE(_old.landed_cost, _old.purchase_price), 'purchase_edit', _inv.invoice_no);
    END IF;
    IF _old.batch_id IS NOT NULL THEN DELETE FROM public.stock_batches WHERE id = _old.batch_id; END IF;
  END LOOP;
  DELETE FROM public.purchase_invoice_items WHERE invoice_id = _invoice_id;

  IF NOT _stock_only AND _inv.supplier_id IS NOT NULL AND _inv.due > 0 THEN
    UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) - _inv.due WHERE id = _inv.supplier_id;
  END IF;

  FOR _l IN SELECT * FROM public.purchase_lines(_items, _freight) LOOP
    IF _l.qty IS NULL OR _l.qty <= 0 THEN RAISE EXCEPTION 'quantity must be above 0'; END IF;
    _subtotal := _subtotal + _l.line_total;
    _batch_id := NULL;
    IF _pend THEN
      NULL;
    ELSIF _l.no_stock THEN
      UPDATE public.products SET purchase_price = round(_l.landed, 4) WHERE id = _l.product_id;
    ELSE
      INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, received_quantity, purchase_price, expiry_date, notes)
      VALUES (_l.product_id, _supplier_id, NULLIF(_l.item->>'batch_no',''), _l.qty, _l.qty, round(_l.landed, 4),
              NULLIF(_l.item->>'expiry_date','')::date, 'Invoice ' || _inv.invoice_no)
      RETURNING id INTO _batch_id;
      PERFORM public.cost_stock_in(_l.product_id, _l.qty, _l.landed, 'purchase_edit', _inv.invoice_no);
    END IF;
    UPDATE public.products
      SET selling_price = CASE WHEN NULLIF(_l.item->>'new_selling_price','') IS NOT NULL
                               THEN (_l.item->>'new_selling_price')::numeric ELSE selling_price END
      WHERE id = _l.product_id
      RETURNING name INTO _product_name;
    INSERT INTO public.purchase_invoice_items(invoice_id, product_id, name, quantity, purchase_price, discount, line_total,
      batch_no, expiry_date, batch_id, no_stock, freight_share, landed_cost, freight_fixed)
    VALUES (_invoice_id, _l.product_id, COALESCE(_product_name, _l.item->>'name'), _l.qty, _l.price, _l.disc, _l.line_total,
            NULLIF(_l.item->>'batch_no',''), NULLIF(_l.item->>'expiry_date','')::date, _batch_id,
            _l.no_stock, _l.share, round(_l.landed, 4), _l.fixed);
  END LOOP;

  _total := _subtotal - COALESCE(_discount,0) + COALESCE(_vat,0) + COALESCE(_freight,0);
  IF _stock_only THEN
    _due := 0; _status := 'stock';
  ELSE
    _due := GREATEST(_total - _inv.paid, 0);
    _status := CASE WHEN _due <= 0 AND _total > 0 THEN 'paid' ELSE 'posted' END;
    IF _supplier_id IS NOT NULL AND _due > 0 THEN
      UPDATE public.suppliers SET balance_due = COALESCE(balance_due,0) + _due WHERE id = _supplier_id;
    END IF;
  END IF;

  UPDATE public.purchase_invoices
    SET supplier_id = _supplier_id, supplier_invoice_no = _supplier_invoice_no,
        invoice_date = COALESCE(_invoice_date, invoice_date),
        subtotal = _subtotal, discount = COALESCE(_discount,0), vat = COALESCE(_vat,0), freight = COALESCE(_freight,0),
        total = _total, due = _due, status = _status, notes = _notes
    WHERE id = _invoice_id;

  RETURN jsonb_build_object('invoice_id', _invoice_id, 'invoice_no', _inv.invoice_no, 'total', _total, 'due', _due, 'status', _status);
END;
$function$
;

CREATE TRIGGER surgeries_set_updated_at BEFORE UPDATE ON public.surgeries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_appointments_sync_owner BEFORE INSERT OR UPDATE OF pet_id ON public.appointments FOR EACH ROW EXECUTE FUNCTION appointments_sync_owner();
CREATE TRIGGER trg_clinical_visits_updated BEFORE UPDATE ON public.clinical_visits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.advice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_close_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_integration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surgeries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_advice ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_symptoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff create cash close reports for closed shifts" ON public.cash_close_reports AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_staff(auth.uid()) AND (EXISTS ( SELECT 1
   FROM cash_shifts s
  WHERE ((s.id = cash_close_reports.shift_id) AND (s.status = 'closed'::text))))));
CREATE POLICY "Staff manage surgeries" ON public.surgeries AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "Staff read cash close reports" ON public.cash_close_reports AS PERMISSIVE FOR SELECT TO authenticated USING (is_staff(auth.uid()));
CREATE POLICY "staff all advice_templates" ON public.advice_templates AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "staff all clinical_visits" ON public.clinical_visits AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "staff all diagnoses" ON public.diagnoses AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "staff all medical_tests" ON public.medical_tests AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "staff all symptoms" ON public.symptoms AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "staff all visit_advice" ON public.visit_advice AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "staff all visit_diagnoses" ON public.visit_diagnoses AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "staff all visit_symptoms" ON public.visit_symptoms AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "staff all visit_tests" ON public.visit_tests AS PERMISSIVE FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- online_integration holds a secret hash: no access for app users (same as live)
REVOKE ALL ON public.online_integration FROM anon, authenticated;

-- Storage buckets (private) + cash close PDF policies
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('cash-close-reports', 'cash-close-reports', false, 10485760) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Staff read cash close PDFs" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'cash-close-reports'::text) AND is_staff(auth.uid())));
CREATE POLICY "Staff upload cash close PDFs" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'cash-close-reports'::text) AND is_staff(auth.uid())));

-- Function permissions as on the live database
REVOKE ALL ON FUNCTION public.online_act_as(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.online_auth(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_online_order(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.online_list_medicines(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_online_order(jsonb) FROM PUBLIC;
