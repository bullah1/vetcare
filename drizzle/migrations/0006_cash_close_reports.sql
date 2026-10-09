CREATE TABLE public.cash_close_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL UNIQUE REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  report_no text NOT NULL,
  file_path text NOT NULL UNIQUE,
  snapshot jsonb NOT NULL,
  branch text,
  cashier text,
  opening_cash numeric NOT NULL DEFAULT 0,
  cash_sales numeric NOT NULL DEFAULT 0,
  cash_in numeric NOT NULL DEFAULT 0,
  cash_out numeric NOT NULL DEFAULT 0,
  refunds numeric NOT NULL DEFAULT 0,
  expected_cash numeric NOT NULL DEFAULT 0,
  actual_cash numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  closed_at timestamptz NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.cash_close_reports TO authenticated;
GRANT ALL ON public.cash_close_reports TO service_role;
ALTER TABLE public.cash_close_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read cash close reports" ON public.cash_close_reports FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff create cash close reports for closed shifts" ON public.cash_close_reports FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND EXISTS (SELECT 1 FROM public.cash_shifts s WHERE s.id = shift_id AND s.status = 'closed'));
-- No UPDATE / DELETE policies: reports are immutable snapshots.

CREATE POLICY "Staff read cash close PDFs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cash-close-reports' AND public.is_staff(auth.uid()));
CREATE POLICY "Staff upload cash close PDFs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cash-close-reports' AND public.is_staff(auth.uid()));