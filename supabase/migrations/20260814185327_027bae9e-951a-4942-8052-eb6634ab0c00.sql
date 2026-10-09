CREATE TABLE public.held_bills (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_no text NOT NULL UNIQUE,
  owner_id uuid REFERENCES public.pet_owners(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  note text,
  channel text NOT NULL DEFAULT 'counter',
  status text NOT NULL DEFAULT 'pending',
  converted_sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT held_bills_status_check CHECK (status IN ('pending','converted','cancelled'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.held_bills TO authenticated;
GRANT ALL ON public.held_bills TO service_role;

ALTER TABLE public.held_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage pending bills"
ON public.held_bills FOR ALL TO authenticated
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER held_bills_set_updated_at
BEFORE UPDATE ON public.held_bills
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX held_bills_status_idx ON public.held_bills(status, created_at DESC);

CREATE OR REPLACE FUNCTION public.next_held_bill_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(bill_no, '\D', '', 'g'), '')::bigint), 0) + 1
    INTO n FROM public.held_bills;
  RETURN 'PB-' || to_char(now(), 'YYMM') || '-' || lpad(n::text, 4, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_held_bill_no() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.next_held_bill_no() TO authenticated, service_role;