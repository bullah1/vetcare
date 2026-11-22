-- No product without a category: a product saved without one (e.g. from an upload)
-- gets the closest category of its business from its basic type.
CREATE OR REPLACE FUNCTION public.trg_products_default_category()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _name text; _proj text := COALESCE(NEW.project, 'pcv');
BEGIN
  IF NEW.category_id IS NOT NULL THEN RETURN NEW; END IF;
  _name := CASE
    WHEN _proj = 'ss' THEN 'Optimum Pharmaceuticals'
    WHEN NEW.category::text = 'pet_food' THEN 'Dry Food'
    WHEN NEW.category::text = 'medicine' THEN 'Cat Medicine'
    WHEN NEW.category::text = 'service' THEN 'Service'
    ELSE 'Accessories' END;
  SELECT id INTO NEW.category_id FROM public.product_categories
   WHERE project = _proj AND name = _name LIMIT 1;
  IF NEW.category_id IS NULL THEN
    SELECT id INTO NEW.category_id FROM public.product_categories
     WHERE project = _proj AND is_active ORDER BY sort, name LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS products_default_category ON public.products;
CREATE TRIGGER products_default_category BEFORE INSERT OR UPDATE OF category_id, project ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.trg_products_default_category();
