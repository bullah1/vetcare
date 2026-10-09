INSERT INTO public.user_permissions (user_id, permission)
SELECT DISTINCT user_id, 'clinical_intelligence'
FROM public.user_permissions
WHERE permission IN ('clinic_dashboard', 'clinical_visit', 'medical')
ON CONFLICT DO NOTHING;