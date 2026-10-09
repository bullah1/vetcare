-- Performance indexes for appointment history filtering/search (non-destructive)
CREATE INDEX IF NOT EXISTS appointments_scheduled_at_idx ON public.appointments (scheduled_at DESC);
CREATE INDEX IF NOT EXISTS appointments_owner_id_idx ON public.appointments (owner_id);
CREATE INDEX IF NOT EXISTS appointments_pet_id_idx ON public.appointments (pet_id);
CREATE INDEX IF NOT EXISTS appointments_doctor_id_idx ON public.appointments (doctor_id);
CREATE INDEX IF NOT EXISTS appointments_status_idx ON public.appointments (status);
CREATE INDEX IF NOT EXISTS pets_owner_id_idx ON public.pets (owner_id);
CREATE INDEX IF NOT EXISTS pet_owners_phone_idx ON public.pet_owners (phone);

-- Guarantee Customer -> Pet -> Appointment integrity: owner_id always derived from the pet
CREATE OR REPLACE FUNCTION public.appointments_sync_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.pet_id IS NOT NULL THEN
    SELECT owner_id INTO NEW.owner_id FROM public.pets WHERE id = NEW.pet_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_sync_owner ON public.appointments;
CREATE TRIGGER trg_appointments_sync_owner
BEFORE INSERT OR UPDATE OF pet_id ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.appointments_sync_owner();

-- Repair any historical rows whose owner link drifted (updates links only, never removes data)
UPDATE public.appointments a
SET owner_id = p.owner_id
FROM public.pets p
WHERE p.id = a.pet_id AND a.owner_id IS DISTINCT FROM p.owner_id;