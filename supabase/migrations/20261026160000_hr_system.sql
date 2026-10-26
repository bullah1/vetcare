-- Simple HR: staff list, duty time, weekly off day, daily attendance and a
-- monthly salary sheet (deductions for absence / unpaid leave / unmarked past days, extra for working
-- on an off day, manual bonus / deduction / advance). Safe to run more than once.
-- Access: admins, and users given the "HR & Salary" permission (key: hr).

CREATE TABLE IF NOT EXISTS public.hr_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text,
  designation text,
  monthly_salary numeric(12,2) NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0),
  duty_start time,
  duty_end time,
  -- Weekly off days, 0 = Sunday … 5 = Friday, 6 = Saturday.
  weekly_off smallint[] NOT NULL DEFAULT '{5}',
  join_date date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unmarked days before this date are not counted as absent (attendance started being kept).
ALTER TABLE public.hr_employees ADD COLUMN IF NOT EXISTS attendance_from date NOT NULL DEFAULT CURRENT_DATE;

CREATE TABLE IF NOT EXISTS public.hr_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  -- present | half_day | leave (unpaid) | paid_leave | absent
  status text NOT NULL CHECK (status IN ('present','half_day','leave','paid_leave','absent')),
  check_in time,
  note text,
  marked_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS hr_attendance_date_idx ON public.hr_attendance (work_date);

-- Bonus / deduction / advance for a month (month = first day of the month).
CREATE TABLE IF NOT EXISTS public.hr_salary_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  month date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bonus','deduction','advance')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_salary_items_month_idx ON public.hr_salary_items (month);
-- Date of the fine / advance / bonus (shown on the calendar and the salary slip).
ALTER TABLE public.hr_salary_items ADD COLUMN IF NOT EXISTS item_date date;

-- "Salary paid" mark for a month (accounts are kept separately; this is a record only).
CREATE TABLE IF NOT EXISTS public.hr_salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  month date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  paid_on date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month)
);

DROP TRIGGER IF EXISTS hr_employees_updated ON public.hr_employees;
CREATE TRIGGER hr_employees_updated BEFORE UPDATE ON public.hr_employees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS hr_attendance_updated ON public.hr_attendance;
CREATE TRIGGER hr_attendance_updated BEFORE UPDATE ON public.hr_attendance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Who can do what:
--   everyone with the HR permission: see everything, mark TODAY's attendance;
--   admin: everything — change any day (past or future), salary items, paid marks, staff.
CREATE OR REPLACE FUNCTION public.hr_today() RETURNS date
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hr_employees','hr_attendance','hr_salary_items','hr_salary_payments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS "hr access" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "hr read" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "hr admin write" ON public.%I', t);
    EXECUTE format('CREATE POLICY "hr read" ON public.%I FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), ''hr''))', t);
    EXECUTE format('CREATE POLICY "hr admin write" ON public.%I FOR ALL TO authenticated USING (public.has_role(auth.uid(), ''admin'')) WITH CHECK (public.has_role(auth.uid(), ''admin''))', t);
  END LOOP;
END $$;

-- Non-admin HR users may mark today's attendance only.
DROP POLICY IF EXISTS "hr mark today" ON public.hr_attendance;
CREATE POLICY "hr mark today" ON public.hr_attendance FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'hr') AND work_date = public.hr_today())
  WITH CHECK (public.has_permission(auth.uid(), 'hr') AND work_date = public.hr_today());


NOTIFY pgrst, 'reload schema';
