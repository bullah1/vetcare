CREATE OR REPLACE FUNCTION public.record_supplier_payment(_supplier_id uuid, _invoice_id uuid, _amount numeric, _method payment_method DEFAULT 'cash'::payment_method, _reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _paid_at date DEFAULT NULL::date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _pay_id uuid; _sup uuid; _sup_name text; _new_due numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;

  _sup := _supplier_id;
  IF _invoice_id IS NOT NULL AND _sup IS NULL THEN
    SELECT supplier_id INTO _sup FROM public.purchase_invoices WHERE id = _invoice_id;
  END IF;

  INSERT INTO public.supplier_payments(supplier_id, invoice_id, amount, method, reference, notes, paid_at, created_by)
  VALUES (_sup, _invoice_id, _amount, COALESCE(_method,'cash'), _reference, _notes,
          COALESCE(_paid_at, CURRENT_DATE), auth.uid())
  RETURNING id INTO _pay_id;

  IF _invoice_id IS NOT NULL THEN
    UPDATE public.purchase_invoices
      SET paid = paid + _amount,
          due = GREATEST(total - (paid + _amount), 0),
          status = CASE
            WHEN status IN ('returned','partially_returned') THEN status
            WHEN GREATEST(total - (paid + _amount), 0) <= 0 THEN 'paid'
            ELSE 'posted'
          END
      WHERE id = _invoice_id
      RETURNING due INTO _new_due;
  END IF;

  IF _sup IS NOT NULL THEN
    UPDATE public.suppliers SET balance_due = GREATEST(COALESCE(balance_due,0) - _amount, 0)
      WHERE id = _sup RETURNING name INTO _sup_name;
  END IF;

  -- No expense row here: the purchase invoice already books the expense.
  RETURN _pay_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_supplier_payment(uuid, uuid, numeric, payment_method, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, uuid, numeric, payment_method, text, text, date) TO authenticated;

DELETE FROM public.expenses WHERE category = 'Supplier Payment';