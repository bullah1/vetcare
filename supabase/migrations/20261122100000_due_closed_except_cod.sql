-- Due sales are closed. A bill may keep an unpaid due only when
--   * it is a COD bill (courier / local delivery), or
--   * its customer is verified for due (pet_owners.due_allowed, set by an admin).
-- Old dues are untouched; collecting them works as before.

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cod boolean NOT NULL DEFAULT false;
ALTER TABLE public.pet_owners ADD COLUMN IF NOT EXISTS due_allowed boolean NOT NULL DEFAULT false;

-- Only an admin can verify a customer for due.
CREATE OR REPLACE FUNCTION public.trg_owner_due_allowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.due_allowed IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.due_allowed ELSE false END)
     AND auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an admin can allow due for a customer.';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS pet_owners_due_allowed ON public.pet_owners;
CREATE TRIGGER pet_owners_due_allowed BEFORE INSERT OR UPDATE OF due_allowed ON public.pet_owners
  FOR EACH ROW EXECUTE FUNCTION public.trg_owner_due_allowed();

-- Checked at the end of the transaction, when all payments of the bill are in.
CREATE OR REPLACE FUNCTION public.trg_sales_due_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _s record;
BEGIN
  SELECT id, due, cod, owner_id, status INTO _s FROM public.sales WHERE id = NEW.id;
  IF NOT FOUND OR _s.status = 'void' OR _s.due <= 0.009 OR _s.cod THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND _s.due <= COALESCE(OLD.due, 0) + 0.009 THEN RETURN NULL; END IF;  -- due did not grow
  IF _s.owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.pet_owners WHERE id = _s.owner_id AND due_allowed) THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Due is closed — take the full payment. Only COD (courier / local delivery) bills or verified customers can keep a due.';
END;
$function$;
DROP TRIGGER IF EXISTS sales_due_rule ON public.sales;
CREATE CONSTRAINT TRIGGER sales_due_rule AFTER INSERT OR UPDATE OF due ON public.sales
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trg_sales_due_rule();

-- POS sale: _cod marks a courier / local delivery bill that may stay unpaid.
DROP FUNCTION IF EXISTS public.create_project_sale(text, uuid, jsonb, jsonb, numeric, text);
CREATE OR REPLACE FUNCTION public.create_project_sale(_project text, _owner_id uuid, _items jsonb, _payments jsonb,
  _discount numeric DEFAULT 0, _notes text DEFAULT NULL::text, _cod boolean DEFAULT false)
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
  IF COALESCE(_cod, false) THEN
    UPDATE public.sales SET cod = true WHERE id = (_res->>'sale_id')::uuid;
  END IF;
  RETURN _res || jsonb_build_object('project', _project, 'cod', COALESCE(_cod, false));
END; $function$;
REVOKE ALL ON FUNCTION public.create_project_sale(text, uuid, jsonb, jsonb, numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project_sale(text, uuid, jsonb, jsonb, numeric, text, boolean) TO authenticated;
