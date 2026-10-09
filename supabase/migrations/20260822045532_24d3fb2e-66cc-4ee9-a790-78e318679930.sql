CREATE OR REPLACE FUNCTION public.cancel_appointment(_appointment_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _a public.appointments;
  _sale record;
  _refund numeric := 0;
  _m payment_method;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT * INTO _a FROM public.appointments WHERE id = _appointment_id FOR UPDATE;
  IF _a.id IS NULL THEN RAISE EXCEPTION 'appointment not found'; END IF;

  IF _a.sale_id IS NOT NULL THEN
    SELECT * INTO _sale FROM public.sales WHERE id = _a.sale_id FOR UPDATE;

    IF FOUND AND _sale.status <> 'void' THEN
      SELECT COALESCE(SUM(amount),0) INTO _refund FROM public.payments WHERE sale_id = _sale.id;

      IF _refund > 0.004 THEN
        SELECT method INTO _m FROM public.payments
          WHERE sale_id = _sale.id AND amount > 0
          ORDER BY received_at DESC LIMIT 1;

        -- negative payment reverses cash movement / digital balance
        INSERT INTO public.payments(sale_id, method, amount, reference)
        VALUES (_sale.id, COALESCE(_m,'cash'), -_refund, 'Cancelled ' || _sale.invoice_no);
      END IF;

      UPDATE public.sales
        SET status = 'void',
            paid = 0,
            due = 0,
            notes = COALESCE(notes,'') ||
              CASE WHEN COALESCE(_reason,'') <> '' THEN ' | Appointment cancelled: ' || _reason ELSE ' | Appointment cancelled' END
        WHERE id = _sale.id;
    END IF;
  END IF;

  UPDATE public.appointments
  SET status = 'cancelled',
      paid = 0,
      notes = COALESCE(notes,'') ||
        CASE WHEN COALESCE(_reason,'') <> '' THEN ' | Cancelled: ' || _reason ELSE '' END,
      updated_at = now()
  WHERE id = _appointment_id;

  RETURN jsonb_build_object('appointment_id', _appointment_id, 'refunded', _refund);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancel_appointment(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cancel_appointment(uuid, text) TO authenticated;