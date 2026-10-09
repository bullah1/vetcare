
ALTER TABLE public.stock_batches ADD COLUMN IF NOT EXISTS client_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS stock_batches_client_request_id_key
  ON public.stock_batches(client_request_id) WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_purchase(
  _product_id uuid,
  _supplier_id uuid,
  _batch_no text,
  _quantity numeric,
  _purchase_price numeric,
  _expiry_date date DEFAULT NULL,
  _notes text DEFAULT NULL,
  _client_request_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _batch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF _client_request_id IS NOT NULL THEN
    SELECT id INTO _batch_id FROM public.stock_batches
      WHERE client_request_id = _client_request_id;
    IF _batch_id IS NOT NULL THEN
      RETURN _batch_id; -- idempotent: already processed
    END IF;
  END IF;

  INSERT INTO public.stock_batches(product_id, supplier_id, batch_no, quantity, purchase_price, expiry_date, notes, client_request_id)
  VALUES (_product_id, _supplier_id, _batch_no, _quantity, _purchase_price, _expiry_date, _notes, _client_request_id)
  RETURNING id INTO _batch_id;

  UPDATE public.products
    SET stock_quantity = stock_quantity + _quantity,
        purchase_price = _purchase_price
    WHERE id = _product_id;

  RETURN _batch_id;
EXCEPTION WHEN unique_violation THEN
  -- concurrent retry with same key raced us — return the winner
  SELECT id INTO _batch_id FROM public.stock_batches
    WHERE client_request_id = _client_request_id;
  RETURN _batch_id;
END;
$function$;
