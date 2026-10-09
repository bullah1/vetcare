-- Consultation discount tracking on appointments
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS discount numeric NOT NULL DEFAULT 0;

-- Surgery records (clinic only; no shop/inventory involvement)
CREATE TABLE IF NOT EXISTS public.surgeries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid REFERENCES public.clinical_visits(id) ON DELETE SET NULL,
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  owner_id uuid REFERENCES public.pet_owners(id),
  doctor_id uuid REFERENCES public.doctors(id),
  surgery_type text NOT NULL,
  surgery_date timestamptz NOT NULL DEFAULT now(),
  fee numeric NOT NULL DEFAULT 0,
  paid numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  is_free boolean NOT NULL DEFAULT false,
  outcome text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.surgeries TO authenticated;
GRANT ALL ON public.surgeries TO service_role;

ALTER TABLE public.surgeries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage surgeries"
  ON public.surgeries FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS surgeries_date_idx ON public.surgeries (surgery_date DESC);
CREATE INDEX IF NOT EXISTS surgeries_pet_idx ON public.surgeries (pet_id);
CREATE INDEX IF NOT EXISTS surgeries_doctor_idx ON public.surgeries (doctor_id);
CREATE INDEX IF NOT EXISTS surgeries_visit_idx ON public.surgeries (visit_id);

CREATE TRIGGER surgeries_set_updated_at
  BEFORE UPDATE ON public.surgeries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
