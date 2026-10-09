CREATE OR REPLACE FUNCTION public.receive_appointment_payment(_appointment_id uuid, _amount numeric, _method payment_method DEFAULT 'cash'::payment_method, _reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _a public.appointments;
  _fee numeric;
  _paid numeric;
  _due numeric;
  _sale_id uuid;
  _label text;
  _res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF COALESCE(_amount,0) <= 0 THEN RAISE EXCEPTION 'amount must be greater than zero'; END IF;

  SELECT * INTO _a FROM public.appointments WHERE id = _appointment_id FOR UPDATE;
  IF _a.id IS NULL THEN RAISE EXCEPTION 'appointment not found'; END IF;

  _fee := COALESCE(_a.fee, 0);

  -- no fee configured yet: the received amount becomes the fee
  IF _fee <= 0 THEN
    _fee := COALESCE(_a.paid,0) + _amount;
  END IF;

  _due := GREATEST(_fee - COALESCE(_a.paid,0), 0);
  IF _amount > _due + 0.001 THEN
    RAISE EXCEPTION 'amount exceeds due (%)', _due;
  END IF;

  _label := 'Consultation fee' ||
    COALESCE(' - ' || (SELECT name FROM public.pets WHERE id = _a.pet_id), '') ||
    COALESCE(' / Dr. ' || (SELECT full_name FROM public.doctors WHERE id = _a.doctor_id), '');

  IF _a.sale_id IS NULL THEN
    _res := public.create_sale(
      _a.owner_id,
      jsonb_build_array(jsonb_build_object(
        'name', _label,
        'quantity', 1,
        'unit_price', _fee,
        'discount', 0,
        'tax', 0
      )),
      jsonb_build_array(jsonb_build_object('amount', _amount, 'method', _method::text, 'reference', _reference)),
      0,
      'Appointment #' || COALESCE(_a.serial_no::text, '-') || ' on ' || to_char(_a.scheduled_at AT TIME ZONE 'Asia/Dhaka', 'DD Mon YYYY HH24:MI')
    );
    _sale_id := (_res->>'sale_id')::uuid;
  ELSE
    _sale_id := _a.sale_id;

    -- keep the invoice line in sync when the fee grew
    UPDATE public.sale_items
    SET quantity = 1, unit_price = _fee, line_total = _fee
    WHERE sale_id = _sale_id
      AND id = (SELECT id FROM public.sale_items WHERE sale_id = _sale_id ORDER BY id LIMIT 1)
      AND _fee > (SELECT COALESCE(SUM(line_total),0) FROM public.sale_items WHERE sale_id = _sale_id);

    INSERT INTO public.payments(sale_id, method, amount, reference)
    VALUES (_sale_id, _method, _amount, _reference);
  END IF;

  PERFORM public.recalc_sale_totals(_sale_id);

  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;

  UPDATE public.appointments
  SET sale_id = _sale_id,
      fee = _fee,
      paid = _paid,
      payment_method = _method,
      updated_at = now()
  WHERE id = _appointment_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'paid', _paid, 'due', GREATEST(_fee - _paid, 0));
END;
$function$;