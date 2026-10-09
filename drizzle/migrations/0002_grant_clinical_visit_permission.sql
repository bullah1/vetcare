-- Staff who can already see prescriptions/medical records get the new Clinical Visit screen.
INSERT INTO public.user_permissions (user_id, permission)
SELECT DISTINCT up.user_id, 'clinical_visit'
  FROM public.user_permissions up
 WHERE up.permission IN ('prescriptions', 'medical')
ON CONFLICT DO NOTHING;