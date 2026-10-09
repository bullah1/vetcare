
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.stock_batches(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_batch_id_uniq ON public.expenses(batch_id) WHERE batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_purchase(_product_id uuid, _supplier_id uuid, _batch_no text, _quantity numeric, _purchase_price numeric, _expiry_date date DEFAULT NULL::date, _notes text DEFAULT NULL::text, _client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _batch_id uuid;
  _product_name text;
  _supplier_name text;
  _total numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF _client_request_id IS NOT NULL THEN
    SELECT id INTO _batch_id FROM public.stock_batches
      WHERE client_request_id = _client_request_id;
    IF _batch_id IS NOT NULL THEN
      RETURN jsonb_build_object('batch_id', _batch_id, 'duplicate', true);
    END IF;
  END IF;

  INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, purchase_price, expiry_date, notes, client_request_id)
  VALUES (_product_id, _supplier_id, _batch_no, _quantity, _purchase_price, _expiry_date, _notes, _client_request_id)
  RETURNING id INTO _batch_id;

  UPDATE public.products
    SET stock_quantity = stock_quantity + _quantity,
        purchase_price = _purchase_price
    WHERE id = _product_id
    RETURNING name INTO _product_name;

  IF _supplier_id IS NOT NULL THEN
    SELECT name INTO _supplier_name FROM public.suppliers WHERE id = _supplier_id;
  END IF;

  _total := COALESCE(_quantity,0) * COALESCE(_purchase_price,0);

  IF _total > 0 THEN
    INSERT INTO public.expenses(category, amount, paid_to, method, notes, batch_id)
    VALUES (
      'Purchase',
      _total,
      _supplier_name,
      'cash',
      'Purchase: ' || COALESCE(_product_name,'') ||
        ' x ' || _quantity::text ||
        CASE WHEN _batch_no IS NOT NULL AND _batch_no <> '' THEN ' (Batch ' || _batch_no || ')' ELSE '' END ||
        CASE WHEN _notes IS NOT NULL AND _notes <> '' THEN ' — ' || _notes ELSE '' END,
      _batch_id
    );
  END IF;

  RETURN jsonb_build_object('batch_id', _batch_id, 'duplicate', false);
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO _batch_id FROM public.stock_batches
    WHERE client_request_id = _client_request_id;
  RETURN jsonb_build_object('batch_id', _batch_id, 'duplicate', true);
END;
$function$;
