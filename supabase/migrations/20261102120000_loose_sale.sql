-- Loose sale: chosen products (e.g. 1 kg cat food) can be sold in parts —
-- 0.5, 1.5, 0.25 … Turn it on per product in Inventory (Edit product).
-- Other products stay whole numbers only. Safe to run more than once.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS loose_sale boolean NOT NULL DEFAULT false;

-- A bill line with a part quantity needs a loose-sale product. Up to 3 decimals.
CREATE OR REPLACE FUNCTION public.trg_sale_item_loose_qty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p record;
BEGIN
  IF NEW.product_id IS NULL OR NEW.quantity = trunc(NEW.quantity) THEN RETURN NEW; END IF;
  SELECT name, loose_sale INTO _p FROM public.products WHERE id = NEW.product_id;
  IF NOT COALESCE(_p.loose_sale, false) THEN
    RAISE EXCEPTION '% is sold in whole numbers only. Turn on "Sell loose" for it in Inventory to sell %.', _p.name, NEW.quantity;
  END IF;
  IF NEW.quantity <> round(NEW.quantity, 3) THEN
    RAISE EXCEPTION 'Quantity % has too many decimals (3 at most).', NEW.quantity;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS sale_item_loose_qty ON public.sale_items;
CREATE TRIGGER sale_item_loose_qty BEFORE INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_item_loose_qty();

NOTIFY pgrst, 'reload schema';
