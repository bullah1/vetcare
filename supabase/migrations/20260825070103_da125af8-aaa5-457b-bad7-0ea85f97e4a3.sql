CREATE TABLE public.courier_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sale_id uuid NOT NULL UNIQUE REFERENCES public.sales(id) ON DELETE CASCADE,
  courier text NOT NULL DEFAULT 'steadfast',
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  recipient_address text NOT NULL,
  invoice_no text NOT NULL,
  item_description text,
  quantity numeric NOT NULL DEFAULT 1,
  sales_total numeric NOT NULL DEFAULT 0,
  courier_charge numeric NOT NULL DEFAULT 0,
  paid_by text NOT NULL DEFAULT 'customer' CHECK (paid_by IN ('customer','shop')),
  cod_amount numeric NOT NULL DEFAULT 0,
  note text,
  courier_order_id text,
  consignment_id text,
  tracking_code text,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  api_response jsonb,
  sent_at timestamp with time zone,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.courier_orders TO authenticated;
GRANT ALL ON public.courier_orders TO service_role;

ALTER TABLE public.courier_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view courier orders" ON public.courier_orders
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff can create courier orders" ON public.courier_orders
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff can update courier orders" ON public.courier_orders
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_courier_orders_updated_at BEFORE UPDATE ON public.courier_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_courier_orders_status ON public.courier_orders(status);