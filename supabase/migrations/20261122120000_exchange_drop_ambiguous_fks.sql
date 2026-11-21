-- A second foreign key from sale_returns to sales made PostgREST embeds like sale_returns -> sales(...)
-- ambiguous, so pages that read returns with their sale (dashboard, reports) got an error and showed 0.
-- Keep the columns, drop the foreign keys.
ALTER TABLE public.sale_returns DROP CONSTRAINT IF EXISTS sale_returns_exchange_sale_id_fkey;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_exchange_of_sale_id_fkey;
NOTIFY pgrst, 'reload schema';
