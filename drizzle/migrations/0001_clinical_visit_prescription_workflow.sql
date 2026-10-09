-- ============ Doctor profile extensions ============
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS degree TEXT,
  ADD COLUMN IF NOT EXISTS designation TEXT,
  ADD COLUMN IF NOT EXISTS additional_qualification TEXT,
  ADD COLUMN IF NOT EXISTS registration_no TEXT;

-- ============ Product medicine profile ============
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_prescribable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dose_form TEXT,
  ADD COLUMN IF NOT EXISTS dose_unit TEXT;

-- Existing medicine-category products become prescribable (non-destructive backfill)
UPDATE public.products
   SET is_prescribable = true,
       dose_form = COALESCE(dose_form, 'tablet'),
       dose_unit = COALESCE(dose_unit, 'tablet')
 WHERE category = 'medicine' AND is_prescribable = false;

CREATE INDEX IF NOT EXISTS products_prescribable_idx ON public.products (is_prescribable) WHERE is_prescribable;

-- ============ Clinical master data ============
CREATE TABLE IF NOT EXISTS public.symptoms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_common BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.symptoms TO authenticated;
GRANT ALL ON public.symptoms TO service_role;
ALTER TABLE public.symptoms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all symptoms" ON public.symptoms FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_common BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.diagnoses TO authenticated;
GRANT ALL ON public.diagnoses TO service_role;
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all diagnoses" ON public.diagnoses FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.medical_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_common BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medical_tests TO authenticated;
GRANT ALL ON public.medical_tests TO service_role;
ALTER TABLE public.medical_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all medical_tests" ON public.medical_tests FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.advice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL UNIQUE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_common BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advice_templates TO authenticated;
GRANT ALL ON public.advice_templates TO service_role;
ALTER TABLE public.advice_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all advice_templates" ON public.advice_templates FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ============ Clinical visits ============
CREATE TABLE IF NOT EXISTS public.clinical_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_no TEXT,
  owner_id UUID REFERENCES public.pet_owners(id) ON DELETE SET NULL,
  pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  visit_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  chief_complaint TEXT,
  examination TEXT,
  weight_kg NUMERIC(6,2),
  temperature NUMERIC(5,2),
  symptoms TEXT[] NOT NULL DEFAULT '{}',
  diagnoses TEXT[] NOT NULL DEFAULT '{}',
  tests TEXT[] NOT NULL DEFAULT '{}',
  advice TEXT[] NOT NULL DEFAULT '{}',
  follow_up_date DATE,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinical_visits TO authenticated;
GRANT ALL ON public.clinical_visits TO service_role;
ALTER TABLE public.clinical_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all clinical_visits" ON public.clinical_visits FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_clinical_visits_updated BEFORE UPDATE ON public.clinical_visits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS clinical_visits_pet_idx ON public.clinical_visits (pet_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS clinical_visits_owner_idx ON public.clinical_visits (owner_id);
CREATE INDEX IF NOT EXISTS clinical_visits_doctor_idx ON public.clinical_visits (doctor_id);
CREATE INDEX IF NOT EXISTS clinical_visits_date_idx ON public.clinical_visits (visit_date DESC);

-- Relational link tables (master-data references per visit)
CREATE TABLE IF NOT EXISTS public.visit_symptoms (
  visit_id UUID NOT NULL REFERENCES public.clinical_visits(id) ON DELETE CASCADE,
  symptom_id UUID NOT NULL REFERENCES public.symptoms(id) ON DELETE CASCADE,
  PRIMARY KEY (visit_id, symptom_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_symptoms TO authenticated;
GRANT ALL ON public.visit_symptoms TO service_role;
ALTER TABLE public.visit_symptoms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all visit_symptoms" ON public.visit_symptoms FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.visit_diagnoses (
  visit_id UUID NOT NULL REFERENCES public.clinical_visits(id) ON DELETE CASCADE,
  diagnosis_id UUID NOT NULL REFERENCES public.diagnoses(id) ON DELETE CASCADE,
  PRIMARY KEY (visit_id, diagnosis_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_diagnoses TO authenticated;
GRANT ALL ON public.visit_diagnoses TO service_role;
ALTER TABLE public.visit_diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all visit_diagnoses" ON public.visit_diagnoses FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.visit_tests (
  visit_id UUID NOT NULL REFERENCES public.clinical_visits(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES public.medical_tests(id) ON DELETE CASCADE,
  PRIMARY KEY (visit_id, test_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_tests TO authenticated;
GRANT ALL ON public.visit_tests TO service_role;
ALTER TABLE public.visit_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all visit_tests" ON public.visit_tests FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.visit_advice (
  visit_id UUID NOT NULL REFERENCES public.clinical_visits(id) ON DELETE CASCADE,
  advice_id UUID NOT NULL REFERENCES public.advice_templates(id) ON DELETE CASCADE,
  PRIMARY KEY (visit_id, advice_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_advice TO authenticated;
GRANT ALL ON public.visit_advice TO service_role;
ALTER TABLE public.visit_advice ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all visit_advice" ON public.visit_advice FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ============ Prescription extensions ============
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.clinical_visits(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS rx_no TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_date DATE;
CREATE INDEX IF NOT EXISTS prescriptions_visit_idx ON public.prescriptions (visit_id);
CREATE INDEX IF NOT EXISTS prescriptions_pet_idx ON public.prescriptions (pet_id, issued_at DESC);

ALTER TABLE public.prescription_items
  ADD COLUMN IF NOT EXISTS dose_amount NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS dose_unit TEXT,
  ADD COLUMN IF NOT EXISTS morning NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS noon NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS night NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS duration_days INTEGER,
  ADD COLUMN IF NOT EXISTS instruction TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- ============ Visit serial ============
CREATE SEQUENCE IF NOT EXISTS public.clinical_visit_seq;
CREATE OR REPLACE FUNCTION public.next_visit_no()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 'V' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYMM') || '-' ||
         lpad(nextval('public.clinical_visit_seq')::TEXT, 5, '0');
$$;
GRANT EXECUTE ON FUNCTION public.next_visit_no() TO authenticated;

-- ============ Starter master data (no patient/visit data) ============
INSERT INTO public.symptoms (name, is_common) VALUES
  ('Vomiting', true), ('Diarrhea', true), ('Fever', true), ('Cough', true),
  ('Pain', true), ('Not Eating', true), ('Skin Problem', true), ('Lethargy', true),
  ('Sneezing', true), ('Itching', true), ('Hair Loss', false), ('Limping', false),
  ('Eye Discharge', false), ('Ear Discharge', false), ('Weight Loss', false),
  ('Constipation', false), ('Blood in Stool', false), ('Difficulty Breathing', false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.diagnoses (name, is_common) VALUES
  ('Gastritis', true), ('Gastroenteritis', true), ('Tick Fever', true),
  ('Dermatitis', true), ('Mange', false), ('Upper Respiratory Infection', true),
  ('Parvovirus Infection', false), ('Feline Panleukopenia', false),
  ('Worm Infestation', true), ('Otitis Externa', false), ('Conjunctivitis', false),
  ('Urinary Tract Infection', false), ('Fungal Infection', false), ('Arthritis', false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.medical_tests (name, is_common) VALUES
  ('CBC', true), ('Blood Smear', true), ('Fecal Examination', true),
  ('Urinalysis', false), ('Skin Scraping', true), ('X-Ray', true),
  ('Ultrasound', false), ('SGPT / ALT', false), ('Creatinine', false),
  ('Parvo Antigen Test', false), ('Distemper Test', false), ('Culture & Sensitivity', false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.advice_templates (text, tags, is_common) VALUES
  ('Keep adequate fresh water available', '{}', true),
  ('Monitor appetite and report if not improving', '{}', true),
  ('Follow the prescribed medicine schedule strictly', '{}', true),
  ('Give small, frequent bland meals', '{"Vomiting","Diarrhea","Gastritis","Not Eating"}', false),
  ('Avoid milk and oily food', '{"Diarrhea","Gastritis"}', false),
  ('Keep the pet warm and rested', '{"Fever","Lethargy"}', false),
  ('Do not bathe for 7 days', '{"Skin Problem","Dermatitis","Mange"}', false),
  ('Use an e-collar to prevent licking', '{"Skin Problem","Itching"}', false),
  ('Complete the full antibiotic course', '{}', false),
  ('Return immediately if breathing becomes difficult', '{"Cough","Difficulty Breathing"}', false)
ON CONFLICT (text) DO NOTHING;