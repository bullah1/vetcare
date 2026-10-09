-- Courier COD charge (Steadfast charges 1% of the COD amount).
-- Stored on the courier order only; sales, payments and accounts are untouched.
ALTER TABLE public.courier_orders
  ADD COLUMN IF NOT EXISTS cod_charge numeric NOT NULL DEFAULT 0 CHECK (cod_charge >= 0),
  ADD COLUMN IF NOT EXISTS cod_charge_percent numeric NOT NULL DEFAULT 1 CHECK (cod_charge_percent >= 0 AND cod_charge_percent <= 10);

NOTIFY pgrst, 'reload schema';
