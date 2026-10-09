REVOKE ALL ON FUNCTION public.create_return(uuid,jsonb,text,public.payment_method,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_sale(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_return(
  _sale_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL,
  _refund_method public.payment_method DEFAULT NULL,
  _restock boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $fn$
BEGIN
  RAISE EXCEPTION 'Please refresh the app before processing a return';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid,_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $fn$
BEGIN
  RAISE EXCEPTION 'Please refresh the app before cancelling a sale';
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_return(uuid,jsonb,text,public.payment_method,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_sale(uuid,text) FROM PUBLIC,anon,authenticated;