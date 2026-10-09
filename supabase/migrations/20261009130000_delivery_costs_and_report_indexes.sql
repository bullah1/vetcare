-- Delivery costs & settlements (for the Business Report) + report indexes.
--
-- TRACKING ONLY, like the rest of the Delivery module: nothing here writes to
-- sales, payments, stock, cash_movements, expenses or accounts. These fields
-- record what a delivery really cost and whether the rider / courier has
-- settled, so the report can show Delivery Income vs Delivery Expense.
-- Safe to run more than once.

-- 1) Local delivery: what we pay the rider, and settlement marks ------------
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS rider_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (rider_fee >= 0),
  ADD COLUMN IF NOT EXISTS rider_paid_at timestamptz,        -- rider fee paid to the delivery man
  ADD COLUMN IF NOT EXISTS cash_received_at timestamptz;     -- rider handed over the cash he collected

-- 2) Courier: the courier's real deduction and the COD it paid us -------------
ALTER TABLE public.courier_orders
  ADD COLUMN IF NOT EXISTS actual_charge numeric(12,2) CHECK (actual_charge IS NULL OR actual_charge >= 0), -- delivery + COD fee the courier deducted
  ADD COLUMN IF NOT EXISTS return_charge numeric(12,2) NOT NULL DEFAULT 0 CHECK (return_charge >= 0),        -- charge for a returned parcel
  ADD COLUMN IF NOT EXISTS cod_received numeric(12,2) CHECK (cod_received IS NULL OR cod_received >= 0),     -- money the courier paid out to the shop
  ADD COLUMN IF NOT EXISTS cod_received_at timestamptz;

-- 3) Rider cost / settlement — changes ONLY these delivery columns ----------
CREATE OR REPLACE FUNCTION public.set_delivery_settlement(
  _delivery_ids uuid[],
  _rider_fee numeric DEFAULT NULL,      -- NULL = keep each delivery's fee
  _rider_paid boolean DEFAULT NULL,     -- NULL = unchanged, true = paid now, false = not paid
  _cash_received boolean DEFAULT NULL   -- NULL = unchanged, true = received now, false = not received
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _rider_fee IS NOT NULL AND _rider_fee < 0 THEN RAISE EXCEPTION 'rider fee cannot be negative'; END IF;
  UPDATE public.deliveries d SET
    rider_fee = COALESCE(round(_rider_fee, 2), d.rider_fee),
    rider_paid_at = CASE WHEN _rider_paid IS NULL THEN d.rider_paid_at WHEN _rider_paid THEN COALESCE(d.rider_paid_at, now()) ELSE NULL END,
    cash_received_at = CASE WHEN _cash_received IS NULL THEN d.cash_received_at WHEN _cash_received THEN COALESCE(d.cash_received_at, now()) ELSE NULL END
  WHERE d.id = ANY(_delivery_ids);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

REVOKE ALL ON FUNCTION public.set_delivery_settlement(uuid[], numeric, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_delivery_settlement(uuid[], numeric, boolean, boolean) TO authenticated;

-- 4) Indexes for date-range reports --------------------------------------------
CREATE INDEX IF NOT EXISTS ix_payments_received_at ON public.payments(received_at);
CREATE INDEX IF NOT EXISTS ix_sale_returns_created_at ON public.sale_returns(created_at);
CREATE INDEX IF NOT EXISTS ix_sale_items_sale_id ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS ix_expenses_expense_date ON public.expenses(expense_date);
CREATE INDEX IF NOT EXISTS ix_purchase_invoices_invoice_date ON public.purchase_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS ix_purchase_returns_created_at ON public.purchase_returns(created_at);
CREATE INDEX IF NOT EXISTS ix_supplier_payments_paid_at ON public.supplier_payments(paid_at);
CREATE INDEX IF NOT EXISTS ix_appointments_scheduled_at ON public.appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS ix_appointments_sale_id ON public.appointments(sale_id);
CREATE INDEX IF NOT EXISTS ix_courier_orders_created_at ON public.courier_orders(created_at);
CREATE INDEX IF NOT EXISTS ix_courier_orders_sale_id ON public.courier_orders(sale_id);
CREATE INDEX IF NOT EXISTS ix_stock_adjustments_created_at ON public.stock_adjustments(created_at);

-- 5) Business Report permission: admins have it already; give it to nobody else
--    automatically (financial data). Grant it from Staff & Permissions.

NOTIFY pgrst, 'reload schema';
