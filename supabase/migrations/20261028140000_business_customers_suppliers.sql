-- Customers and suppliers belong to a business: pcv (Pet Care Vet),
-- ss (Sasthya Seba) or both. Safe to run more than once. Needs the Projects SQL.

ALTER TABLE public.pet_owners ADD COLUMN IF NOT EXISTS business text NOT NULL DEFAULT 'pcv';
DO $$ BEGIN
  ALTER TABLE public.pet_owners ADD CONSTRAINT pet_owners_business_check CHECK (business IN ('pcv','ss','both'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS business text NOT NULL DEFAULT 'pcv';
DO $$ BEGIN
  ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_business_check CHECK (business IN ('pcv','ss','both'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Existing customers, from their bills: only Sasthya Seba → ss, both → both.
-- Customers with pets stay Pet Care Vet (clinic) unless they also bought at Sasthya Seba.
UPDATE public.pet_owners o SET business = CASE
    WHEN x.has_ss AND (x.has_pcv OR EXISTS (SELECT 1 FROM public.pets p WHERE p.owner_id = o.id)) THEN 'both'
    WHEN x.has_ss THEN 'ss'
    ELSE o.business END
FROM (
  SELECT owner_id, bool_or(project = 'ss') AS has_ss, bool_or(project = 'pcv') AS has_pcv
  FROM public.sales WHERE owner_id IS NOT NULL GROUP BY owner_id
) x
WHERE x.owner_id = o.id AND x.has_ss AND o.business = 'pcv';

-- Existing suppliers: if everything bought from them is Sasthya Seba → ss, a mix → both.
UPDATE public.suppliers s SET business = CASE WHEN x.has_pcv THEN 'both' ELSE 'ss' END
FROM (
  SELECT i.supplier_id, bool_or(p.project = 'ss') AS has_ss, bool_or(p.project = 'pcv') AS has_pcv
  FROM public.purchase_invoices i
  JOIN public.purchase_invoice_items it ON it.invoice_id = i.id
  JOIN public.products p ON p.id = it.product_id
  WHERE i.supplier_id IS NOT NULL GROUP BY i.supplier_id
) x
WHERE x.supplier_id = s.id AND x.has_ss AND s.business = 'pcv';

-- A customer who buys at the other business becomes "both" by itself.
CREATE OR REPLACE FUNCTION public.trg_sale_customer_business()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL AND NEW.project IN ('pcv','ss') THEN
    UPDATE public.pet_owners SET business = 'both'
      WHERE id = NEW.owner_id AND business <> 'both' AND business <> NEW.project;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS sale_customer_business ON public.sales;
CREATE TRIGGER sale_customer_business AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_customer_business();

NOTIFY pgrst, 'reload schema';
