-- Courier (Steadfast) API keys saved from inside the app (Delivery Report → Steadfast keys),
-- so they do not have to be set as hosting environment variables.
-- Nobody can read the table directly. Admins save keys through set_courier_credentials();
-- the server reads them through get_courier_credentials() when it sends a parcel.
-- Environment variables, if set, still win. Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.courier_credentials (
  courier text PRIMARY KEY,
  api_key text NOT NULL,
  secret_key text NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.courier_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.courier_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.courier_credentials TO service_role;

-- Admin saves (or clears, with empty keys) the keys.
CREATE OR REPLACE FUNCTION public.set_courier_credentials(_courier text, _api_key text, _secret_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an admin can change courier keys';
  END IF;
  IF COALESCE(trim(_api_key), '') = '' AND COALESCE(trim(_secret_key), '') = '' THEN
    DELETE FROM public.courier_credentials WHERE courier = _courier;
    RETURN jsonb_build_object('saved', false);
  END IF;
  IF COALESCE(trim(_api_key), '') = '' OR COALESCE(trim(_secret_key), '') = '' THEN
    RAISE EXCEPTION 'Give both the API key and the secret key';
  END IF;
  INSERT INTO public.courier_credentials(courier, api_key, secret_key, updated_by, updated_at)
  VALUES (_courier, trim(_api_key), trim(_secret_key), auth.uid(), now())
  ON CONFLICT (courier) DO UPDATE
    SET api_key = EXCLUDED.api_key, secret_key = EXCLUDED.secret_key, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('saved', true);
END; $$;

-- Whether keys are saved (never returns the keys themselves).
CREATE OR REPLACE FUNCTION public.courier_credentials_status(_courier text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.is_staff(auth.uid()) THEN
    COALESCE((SELECT jsonb_build_object('saved', true, 'api_key_end', right(api_key, 4), 'updated_at', updated_at)
              FROM public.courier_credentials WHERE courier = _courier), jsonb_build_object('saved', false))
  ELSE jsonb_build_object('saved', false) END;
$$;

-- Used by the app server when sending a parcel (staff only).
CREATE OR REPLACE FUNCTION public.get_courier_credentials(_courier text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.courier_credentials;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RETURN NULL; END IF;
  SELECT * INTO _r FROM public.courier_credentials WHERE courier = _courier;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('api_key', _r.api_key, 'secret_key', _r.secret_key);
END; $$;

REVOKE ALL ON FUNCTION public.set_courier_credentials(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.courier_credentials_status(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_courier_credentials(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_courier_credentials(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_credentials_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_courier_credentials(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
