CREATE OR REPLACE FUNCTION public.next_held_bill_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text := 'PB-' || to_char(now(), 'YYMM') || '-';
  n integer;
  candidate text;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(substring(bill_no from char_length(prefix) + 1), '\D', '', 'g'), '')::bigint), 0)
    INTO n
  FROM public.held_bills
  WHERE bill_no LIKE prefix || '%';

  LOOP
    n := n + 1;
    candidate := prefix || lpad(n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.held_bills WHERE bill_no = candidate);
  END LOOP;

  RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.next_held_bill_no() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_held_bill_no() TO authenticated, service_role;