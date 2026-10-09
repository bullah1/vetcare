INSERT INTO public.user_permissions (user_id, permission)
SELECT DISTINCT up.user_id, 'clinic_dashboard'
FROM public.user_permissions up
WHERE up.permission IN ('dashboard', 'clinical_visit', 'appointments')
  AND NOT EXISTS (
    SELECT 1 FROM public.user_permissions x
    WHERE x.user_id = up.user_id AND x.permission = 'clinic_dashboard'
  );
