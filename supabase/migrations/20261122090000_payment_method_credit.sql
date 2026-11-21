-- Store credit as a payment method (product exchange / return to customer account).
-- Kept in its own migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'credit';
