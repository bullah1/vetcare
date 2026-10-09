ALTER TABLE public.pet_owners ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.pet_owners ADD CONSTRAINT pet_owners_gender_check CHECK (gender IS NULL OR gender IN ('male','female'));