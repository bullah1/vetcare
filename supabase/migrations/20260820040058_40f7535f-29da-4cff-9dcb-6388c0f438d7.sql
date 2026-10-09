ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method payment_method,
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.next_appointment_serial(_doctor_id uuid, _scheduled_at timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(a.serial_no), 0) + 1
  FROM public.appointments a
  WHERE ((a.doctor_id IS NULL AND _doctor_id IS NULL) OR a.doctor_id = _doctor_id)
    AND (a.scheduled_at AT TIME ZONE 'Asia/Dhaka')::date = (_scheduled_at AT TIME ZONE 'Asia/Dhaka')::date;
$$;

CREATE OR REPLACE FUNCTION public.create_appointment(
  _pet_id uuid,
  _doctor_id uuid,
  _scheduled_at timestamptz,
  _duration_minutes integer DEFAULT 30,
  _fee numeric DEFAULT 0,
  _reason text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _serial_no integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _owner uuid; _serial integer; _id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT owner_id INTO _owner FROM public.pets WHERE id = _pet_id;
  _serial := COALESCE(_serial_no, public.next_appointment_serial(_doctor_id, _scheduled_at));

  INSERT INTO public.appointments(serial_no, pet_id, owner_id, doctor_id, scheduled_at, duration_minutes,
                                  reason, notes, status, online_booking, fee, paid)
  VALUES (_serial, _pet_id, _owner, _doctor_id, _scheduled_at, COALESCE(_duration_minutes, 30),
          NULLIF(_reason,''), NULLIF(_notes,''), 'pending', false, COALESCE(_fee,0), 0)
  RETURNING id INTO _id;

  RETURN jsonb_build_object('appointment_id', _id, 'serial_no', _serial);
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_appointment_payment(
  _appointment_id uuid,
  _amount numeric,
  _method payment_method DEFAULT 'cash',
  _reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  _due := GREATEST(_fee - COALESCE(_a.paid,0), 0);
  IF _fee > 0 AND _amount > _due + 0.001 THEN
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
    INSERT INTO public.payments(sale_id, method, amount, reference)
    VALUES (_sale_id, _method, _amount, _reference);
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments WHERE sale_id = _sale_id;

  UPDATE public.appointments
  SET sale_id = _sale_id,
      paid = _paid,
      payment_method = _method,
      updated_at = now()
  WHERE id = _appointment_id;

  RETURN jsonb_build_object('sale_id', _sale_id, 'paid', _paid, 'due', GREATEST(_fee - _paid, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.next_appointment_serial(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_appointment(uuid, uuid, timestamptz, integer, numeric, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_appointment_payment(uuid, numeric, payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_appointment_serial(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_appointment(uuid, uuid, timestamptz, integer, numeric, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_appointment_payment(uuid, numeric, payment_method, text) TO authenticated;