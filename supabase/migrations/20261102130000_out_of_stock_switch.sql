-- Out-of-stock switch for POS bills.
-- app_settings key 'pos_out_of_stock' = {"allow": true|false}. Default (no row) = allowed, as before.
-- When off, a POS bill cannot sell more than the stock on hand ("Bulk / no stock"
-- products aside). Turned on / off by an admin from the POS page. Safe to run more than once.

CREATE OR REPLACE FUNCTION public.pos_out_of_stock_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT (value->>'allow')::boolean FROM public.app_settings WHERE key = 'pos_out_of_stock'), true);
$$;
GRANT EXECUTE ON FUNCTION public.pos_out_of_stock_allowed() TO authenticated;

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

  -- Out-of-stock selling turned off: every product must have enough stock.
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
END; $$;
REVOKE ALL ON FUNCTION public.create_project_sale(text, uuid, jsonb, jsonb, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project_sale(text, uuid, jsonb, jsonb, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
