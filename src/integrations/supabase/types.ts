export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      advice_templates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_common: boolean
          tags: string[]
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_common?: boolean
          tags?: string[]
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_common?: boolean
          tags?: string[]
          text?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      appointments: {
        Row: {
          created_at: string
          discount: number
          doctor_id: string | null
          duration_minutes: number
          fee: number
          guest_name: string | null
          guest_pet_name: string | null
          guest_pet_species: Database["public"]["Enums"]["pet_species"] | null
          guest_phone: string | null
          id: string
          notes: string | null
          online_booking: boolean
          owner_id: string | null
          paid: number
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          pet_id: string | null
          reason: string | null
          sale_id: string | null
          scheduled_at: string
          serial_no: number | null
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          discount?: number
          doctor_id?: string | null
          duration_minutes?: number
          fee?: number
          guest_name?: string | null
          guest_pet_name?: string | null
          guest_pet_species?: Database["public"]["Enums"]["pet_species"] | null
          guest_phone?: string | null
          id?: string
          notes?: string | null
          online_booking?: boolean
          owner_id?: string | null
          paid?: number
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          pet_id?: string | null
          reason?: string | null
          sale_id?: string | null
          scheduled_at: string
          serial_no?: number | null
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          discount?: number
          doctor_id?: string | null
          duration_minutes?: number
          fee?: number
          guest_name?: string | null
          guest_pet_name?: string | null
          guest_pet_species?: Database["public"]["Enums"]["pet_species"] | null
          guest_phone?: string | null
          id?: string
          notes?: string | null
          online_booking?: boolean
          owner_id?: string | null
          paid?: number
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          pet_id?: string | null
          reason?: string | null
          sale_id?: string | null
          scheduled_at?: string
          serial_no?: number | null
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "pet_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sale_reconciliation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_close_reports: {
        Row: {
          actual_cash: number
          branch: string | null
          cash_in: number
          cash_out: number
          cash_sales: number
          cashier: string | null
          closed_at: string
          created_at: string
          created_by: string | null
          difference: number
          expected_cash: number
          file_path: string
          id: string
          opening_cash: number
          refunds: number
          report_no: string
          shift_id: string
          snapshot: Json
        }
        Insert: {
          actual_cash?: number
          branch?: string | null
          cash_in?: number
          cash_out?: number
          cash_sales?: number
          cashier?: string | null
          closed_at: string
          created_at?: string
          created_by?: string | null
          difference?: number
          expected_cash?: number
          file_path: string
          id?: string
          opening_cash?: number
          refunds?: number
          report_no: string
          shift_id: string
          snapshot: Json
        }
        Update: {
          actual_cash?: number
          branch?: string | null
          cash_in?: number
          cash_out?: number
          cash_sales?: number
          cashier?: string | null
          closed_at?: string
          created_at?: string
          created_by?: string | null
          difference?: number
          expected_cash?: number
          file_path?: string
          id?: string
          opening_cash?: number
          refunds?: number
          report_no?: string
          shift_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cash_close_reports_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          direction: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          occurred_at: string
          reference: string | null
          shift_id: string | null
          source: string
          source_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          direction: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          occurred_at?: string
          reference?: string | null
          shift_id?: string | null
          source: string
          source_id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          occurred_at?: string
          reference?: string | null
          shift_id?: string | null
          source?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_shifts: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_notes: string | null
          counted_cash: number | null
          created_at: string
          expected_cash: number | null
          id: string
          opened_at: string
          opened_by: string
          opening_balance: number
          opening_notes: string | null
          status: string
          variance: number | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_notes?: string | null
          counted_cash?: number | null
          created_at?: string
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opened_by: string
          opening_balance?: number
          opening_notes?: string | null
          status?: string
          variance?: number | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_notes?: string | null
          counted_cash?: number | null
          created_at?: string
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opened_by?: string
          opening_balance?: number
          opening_notes?: string | null
          status?: string
          variance?: number | null
        }
        Relationships: []
      }
      clinical_visits: {
        Row: {
          advice: string[]
          appointment_id: string | null
          chief_complaint: string | null
          created_at: string
          created_by: string | null
          diagnoses: string[]
          doctor_id: string | null
          examination: string | null
          follow_up_date: string | null
          id: string
          notes: string | null
          owner_id: string | null
          pet_id: string
          symptoms: string[]
          temperature: number | null
          tests: string[]
          updated_at: string
          visit_date: string
          visit_no: string | null
          weight_kg: number | null
        }
        Insert: {
          advice?: string[]
          appointment_id?: string | null
          chief_complaint?: string | null
          created_at?: string
          created_by?: string | null
          diagnoses?: string[]
          doctor_id?: string | null
          examination?: string | null
          follow_up_date?: string | null
          id?: string
          notes?: string | null
          owner_id?: string | null
          pet_id: string
          symptoms?: string[]
          temperature?: number | null
          tests?: string[]
          updated_at?: string
          visit_date?: string
          visit_no?: string | null
          weight_kg?: number | null
        }
        Update: {
          advice?: string[]
          appointment_id?: string | null
          chief_complaint?: string | null
          created_at?: string
          created_by?: string | null
          diagnoses?: string[]
          doctor_id?: string | null
          examination?: string | null
          follow_up_date?: string | null
          id?: string
          notes?: string | null
          owner_id?: string | null
          pet_id?: string
          symptoms?: string[]
          temperature?: number | null
          tests?: string[]
          updated_at?: string
          visit_date?: string
          visit_no?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_visits_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_visits_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_visits_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "pet_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_visits_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_orders: {
        Row: {
          api_response: Json | null
          cod_amount: number
          consignment_id: string | null
          courier: string
          courier_charge: number
          courier_order_id: string | null
          created_at: string
          created_by: string | null
          id: string
          invoice_no: string
          item_description: string | null
          last_error: string | null
          note: string | null
          paid_by: string
          quantity: number
          recipient_address: string
          recipient_name: string
          recipient_phone: string
          sale_id: string
          sales_total: number
          sent_at: string | null
          status: string
          tracking_code: string | null
          updated_at: string
        }
        Insert: {
          api_response?: Json | null
          cod_amount?: number
          consignment_id?: string | null
          courier?: string
          courier_charge?: number
          courier_order_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_no: string
          item_description?: string | null
          last_error?: string | null
          note?: string | null
          paid_by?: string
          quantity?: number
          recipient_address: string
          recipient_name: string
          recipient_phone: string
          sale_id: string
          sales_total?: number
          sent_at?: string | null
          status?: string
          tracking_code?: string | null
          updated_at?: string
        }
        Update: {
          api_response?: Json | null
          cod_amount?: number
          consignment_id?: string | null
          courier?: string
          courier_charge?: number
          courier_order_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_no?: string
          item_description?: string | null
          last_error?: string | null
          note?: string | null
          paid_by?: string
          quantity?: number
          recipient_address?: string
          recipient_name?: string
          recipient_phone?: string
          sale_id?: string
          sales_total?: number
          sent_at?: string | null
          status?: string
          tracking_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_orders_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sale_reconciliation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_orders_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnoses: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_common: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_common?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_common?: boolean
          name?: string
        }
        Relationships: []
      }
      doctors: {
        Row: {
          additional_qualification: string | null
          bio: string | null
          consultation_fee: number | null
          created_at: string
          degree: string | null
          designation: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          photo_url: string | null
          registration_no: string | null
          specialization: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          additional_qualification?: string | null
          bio?: string | null
          consultation_fee?: number | null
          created_at?: string
          degree?: string | null
          designation?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          phone?: string | null
          photo_url?: string | null
          registration_no?: string | null
          specialization?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          additional_qualification?: string | null
          bio?: string | null
          consultation_fee?: number | null
          created_at?: string
          degree?: string | null
          designation?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          photo_url?: string | null
          registration_no?: string | null
          specialization?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          batch_id: string | null
          category: string
          created_at: string
          expense_date: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          paid_to: string | null
          purchase_invoice_id: string | null
        }
        Insert: {
          amount: number
          batch_id?: string | null
          category: string
          created_at?: string
          expense_date?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_to?: string | null
          purchase_invoice_id?: string | null
        }
        Update: {
          amount?: number
          batch_id?: string | null
          category?: string
          created_at?: string
          expense_date?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_to?: string | null
          purchase_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "stock_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      held_bills: {
        Row: {
          bill_no: string
          channel: string
          converted_sale_id: string | null
          created_at: string
          created_by: string | null
          customer_name: string | null
          customer_phone: string | null
          discount: number
          id: string
          items: Json
          note: string | null
          owner_id: string | null
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          bill_no: string
          channel?: string
          converted_sale_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          id?: string
          items?: Json
          note?: string | null
          owner_id?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          bill_no?: string
          channel?: string
          converted_sale_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          id?: string
          items?: Json
          note?: string | null
          owner_id?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "held_bills_converted_sale_id_fkey"
            columns: ["converted_sale_id"]
            isOneToOne: false
            referencedRelation: "sale_reconciliation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_bills_converted_sale_id_fkey"
            columns: ["converted_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_bills_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "pet_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_records: {
        Row: {
          appointment_id: string | null
          created_at: string
          diagnosis: string | null
          doctor_id: string | null
          id: string
          lab_report_urls: string[] | null
          notes: string | null
          pet_id: string
          symptoms: string | null
          temperature: number | null
          treatment: string | null
          visit_date: string
          weight_kg: number | null
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          diagnosis?: string | null
          doctor_id?: string | null
          id?: string
          lab_report_urls?: string[] | null
          notes?: string | null
          pet_id: string
          symptoms?: string | null
          temperature?: number | null
          treatment?: string | null
          visit_date?: string
          weight_kg?: number | null
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          diagnosis?: string | null
          doctor_id?: string | null
          id?: string
          lab_report_urls?: string[] | null
          notes?: string | null
          pet_id?: string
          symptoms?: string | null
          temperature?: number | null
          treatment?: string | null
          visit_date?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_records_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_tests: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_common: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_common?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_common?: boolean
          name?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          client_request_id: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          received_at: string
          reference: string | null
          return_id: string | null
          sale_id: string | null
        }
        Insert: {
          amount: number
          client_request_id?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          received_at?: string
          reference?: string | null
          return_id?: string | null
          sale_id?: string | null
        }
        Update: {
          amount?: number
          client_request_id?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          received_at?: string
          reference?: string | null
          return_id?: string | null
          sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sale_reconciliation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_owners: {
        Row: {
          address: string | null
          birthday: string | null
          created_at: string
          email: string | null
          full_name: string
          gender: string | null
          id: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          gender?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pets: {
        Row: {
          breed: string | null
          color: string | null
          created_at: string
          date_of_birth: string | null
          gender: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string
          photo_url: string | null
          species: Database["public"]["Enums"]["pet_species"]
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          breed?: string | null
          color?: string | null
          created_at?: string
          date_of_birth?: string | null
          gender?: string | null
          id?: string
          name: string
          notes?: string | null
          owner_id: string
          photo_url?: string | null
          species?: Database["public"]["Enums"]["pet_species"]
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          breed?: string | null
          color?: string | null
          created_at?: string
          date_of_birth?: string | null
          gender?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string
          photo_url?: string | null
          species?: Database["public"]["Enums"]["pet_species"]
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "pet_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_items: {
        Row: {
          dosage: string | null
          dose_amount: number | null
          dose_unit: string | null
          duration: string | null
          duration_days: number | null
          frequency: string | null
          id: string
          instruction: string | null
          instructions: string | null
          medicine_name: string
          morning: number | null
          night: number | null
          noon: number | null
          prescription_id: string
          product_id: string | null
          sort_order: number
        }
        Insert: {
          dosage?: string | null
          dose_amount?: number | null
          dose_unit?: string | null
          duration?: string | null
          duration_days?: number | null
          frequency?: string | null
          id?: string
          instruction?: string | null
          instructions?: string | null
          medicine_name: string
          morning?: number | null
          night?: number | null
          noon?: number | null
          prescription_id: string
          product_id?: string | null
          sort_order?: number
        }
        Update: {
          dosage?: string | null
          dose_amount?: number | null
          dose_unit?: string | null
          duration?: string | null
          duration_days?: number | null
          frequency?: string | null
          id?: string
          instruction?: string | null
          instructions?: string | null
          medicine_name?: string
          morning?: number | null
          night?: number | null
          noon?: number | null
          prescription_id?: string
          product_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          doctor_id: string | null
          follow_up_date: string | null
          id: string
          issued_at: string
          medical_record_id: string | null
          notes: string | null
          pet_id: string
          rx_no: string | null
          visit_id: string | null
        }
        Insert: {
          doctor_id?: string | null
          follow_up_date?: string | null
          id?: string
          issued_at?: string
          medical_record_id?: string | null
          notes?: string | null
          pet_id: string
          rx_no?: string | null
          visit_id?: string | null
        }
        Update: {
          doctor_id?: string | null
          follow_up_date?: string | null
          id?: string
          issued_at?: string
          medical_record_id?: string | null
          notes?: string | null
          pet_id?: string
          rx_no?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_medical_record_id_fkey"
            columns: ["medical_record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "clinical_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category: Database["public"]["Enums"]["product_category"]
          created_at: string
          description: string | null
          dose_form: string | null
          dose_unit: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_prescribable: boolean
          low_stock_threshold: number
          name: string
          purchase_price: number
          selling_price: number
          sku: string | null
          stock_quantity: number
          tax_percent: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category?: Database["public"]["Enums"]["product_category"]
          created_at?: string
          description?: string | null
          dose_form?: string | null
          dose_unit?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_prescribable?: boolean
          low_stock_threshold?: number
          name: string
          purchase_price?: number
          selling_price?: number
          sku?: string | null
          stock_quantity?: number
          tax_percent?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category?: Database["public"]["Enums"]["product_category"]
          created_at?: string
          description?: string | null
          dose_form?: string | null
          dose_unit?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_prescribable?: boolean
          low_stock_threshold?: number
          name?: string
          purchase_price?: number
          selling_price?: number
          sku?: string | null
          stock_quantity?: number
          tax_percent?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      purchase_invoice_items: {
        Row: {
          batch_id: string | null
          batch_no: string | null
          created_at: string
          discount: number
          expiry_date: string | null
          id: string
          invoice_id: string
          line_total: number
          name: string
          product_id: string
          purchase_price: number
          quantity: number
          returned_quantity: number
        }
        Insert: {
          batch_id?: string | null
          batch_no?: string | null
          created_at?: string
          discount?: number
          expiry_date?: string | null
          id?: string
          invoice_id: string
          line_total: number
          name: string
          product_id: string
          purchase_price: number
          quantity: number
          returned_quantity?: number
        }
        Update: {
          batch_id?: string | null
          batch_no?: string | null
          created_at?: string
          discount?: number
          expiry_date?: string | null
          id?: string
          invoice_id?: string
          line_total?: number
          name?: string
          product_id?: string
          purchase_price?: number
          quantity?: number
          returned_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "stock_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoices: {
        Row: {
          created_at: string
          created_by: string | null
          discount: number
          due: number
          freight: number
          id: string
          invoice_date: string
          invoice_no: string
          notes: string | null
          paid: number
          status: string
          subtotal: number
          supplier_id: string | null
          supplier_invoice_no: string | null
          total: number
          updated_at: string
          vat: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discount?: number
          due?: number
          freight?: number
          id?: string
          invoice_date?: string
          invoice_no: string
          notes?: string | null
          paid?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          supplier_invoice_no?: string | null
          total?: number
          updated_at?: string
          vat?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discount?: number
          due?: number
          freight?: number
          id?: string
          invoice_date?: string
          invoice_no?: string
          notes?: string | null
          paid?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          supplier_invoice_no?: string | null
          total?: number
          updated_at?: string
          vat?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_return_items: {
        Row: {
          created_at: string
          id: string
          invoice_item_id: string
          line_total: number
          name: string
          product_id: string | null
          quantity: number
          return_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_item_id: string
          line_total: number
          name: string
          product_id?: string | null
          quantity: number
          return_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_item_id?: string
          line_total?: number
          name?: string
          product_id?: string | null
          quantity?: number
          return_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_return_items_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "purchase_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_returns: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          processed_by: string | null
          reason: string | null
          refund_amount: number
          refund_method: Database["public"]["Enums"]["payment_method"] | null
          restock: boolean
          return_no: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          processed_by?: string | null
          reason?: string | null
          refund_amount?: number
          refund_method?: Database["public"]["Enums"]["payment_method"] | null
          restock?: boolean
          return_no: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          processed_by?: string | null
          reason?: string | null
          refund_amount?: number
          refund_method?: Database["public"]["Enums"]["payment_method"] | null
          restock?: boolean
          return_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_returns_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          cost_price: number
          discount: number
          id: string
          line_total: number
          name: string
          product_id: string | null
          quantity: number
          returned_quantity: number
          sale_id: string
          tax: number
          unit_price: number
        }
        Insert: {
          cost_price?: number
          discount?: number
          id?: string
          line_total: number
          name: string
          product_id?: string | null
          quantity: number
          returned_quantity?: number
          sale_id: string
          tax?: number
          unit_price: number
        }
        Update: {
          cost_price?: number
          discount?: number
          id?: string
          line_total?: number
          name?: string
          product_id?: string | null
          quantity?: number
          returned_quantity?: number
          sale_id?: string
          tax?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sale_reconciliation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_return_items: {
        Row: {
          id: string
          line_total: number
          name: string
          product_id: string | null
          quantity: number
          return_id: string
          sale_item_id: string
          unit_price: number
        }
        Insert: {
          id?: string
          line_total?: number
          name: string
          product_id?: string | null
          quantity: number
          return_id: string
          sale_item_id: string
          unit_price?: number
        }
        Update: {
          id?: string
          line_total?: number
          name?: string
          product_id?: string | null
          quantity?: number
          return_id?: string
          sale_item_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_returns: {
        Row: {
          client_request_id: string | null
          created_at: string
          due_reduction: number
          id: string
          processed_by: string | null
          reason: string | null
          refund_amount: number
          refund_method: Database["public"]["Enums"]["payment_method"] | null
          refund_paid: number
          restock: boolean
          return_no: string
          return_type: string
          sale_id: string
        }
        Insert: {
          client_request_id?: string | null
          created_at?: string
          due_reduction?: number
          id?: string
          processed_by?: string | null
          reason?: string | null
          refund_amount?: number
          refund_method?: Database["public"]["Enums"]["payment_method"] | null
          refund_paid?: number
          restock?: boolean
          return_no: string
          return_type?: string
          sale_id: string
        }
        Update: {
          client_request_id?: string | null
          created_at?: string
          due_reduction?: number
          id?: string
          processed_by?: string | null
          reason?: string | null
          refund_amount?: number
          refund_method?: Database["public"]["Enums"]["payment_method"] | null
          refund_paid?: number
          restock?: boolean
          return_no?: string
          return_type?: string
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sale_reconciliation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cashier_id: string | null
          created_at: string
          discount: number
          due: number
          id: string
          invoice_no: string
          notes: string | null
          owner_id: string | null
          paid: number
          status: Database["public"]["Enums"]["sale_status"]
          subtotal: number
          tax: number
          total: number
        }
        Insert: {
          cashier_id?: string | null
          created_at?: string
          discount?: number
          due?: number
          id?: string
          invoice_no: string
          notes?: string | null
          owner_id?: string | null
          paid?: number
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal?: number
          tax?: number
          total?: number
        }
        Update: {
          cashier_id?: string | null
          created_at?: string
          discount?: number
          due?: number
          id?: string
          invoice_no?: string
          notes?: string | null
          owner_id?: string | null
          paid?: number
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal?: number
          tax?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "pet_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          after_qty: number | null
          before_qty: number | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          product_id: string
          quantity_change: number
          reason: Database["public"]["Enums"]["stock_adjustment_reason"]
        }
        Insert: {
          after_qty?: number | null
          before_qty?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id: string
          quantity_change: number
          reason?: Database["public"]["Enums"]["stock_adjustment_reason"]
        }
        Update: {
          after_qty?: number | null
          before_qty?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          quantity_change?: number
          reason?: Database["public"]["Enums"]["stock_adjustment_reason"]
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_batches: {
        Row: {
          batch_no: string | null
          client_request_id: string | null
          expiry_date: string | null
          id: string
          notes: string | null
          product_id: string
          purchase_price: number
          quantity: number
          received_at: string
          supplier_id: string | null
        }
        Insert: {
          batch_no?: string | null
          client_request_id?: string | null
          expiry_date?: string | null
          id?: string
          notes?: string | null
          product_id: string
          purchase_price?: number
          quantity: number
          received_at?: string
          supplier_id?: string | null
        }
        Update: {
          batch_no?: string | null
          client_request_id?: string | null
          expiry_date?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          purchase_price?: number
          quantity?: number
          received_at?: string
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          paid_at: string
          reference: string | null
          supplier_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          reference?: string | null
          supplier_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          reference?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          balance_due: number
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          balance_due?: number
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          balance_due?: number
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      surgeries: {
        Row: {
          created_at: string
          created_by: string | null
          discount: number
          doctor_id: string | null
          fee: number
          id: string
          is_free: boolean
          notes: string | null
          outcome: string | null
          owner_id: string | null
          paid: number
          pet_id: string
          surgery_date: string
          surgery_type: string
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discount?: number
          doctor_id?: string | null
          fee?: number
          id?: string
          is_free?: boolean
          notes?: string | null
          outcome?: string | null
          owner_id?: string | null
          paid?: number
          pet_id: string
          surgery_date?: string
          surgery_type: string
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discount?: number
          doctor_id?: string | null
          fee?: number
          id?: string
          is_free?: boolean
          notes?: string | null
          outcome?: string | null
          owner_id?: string | null
          paid?: number
          pet_id?: string
          surgery_date?: string
          surgery_type?: string
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "surgeries_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surgeries_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "pet_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surgeries_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surgeries_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "clinical_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      symptoms: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_common: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_common?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_common?: boolean
          name?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          created_at: string
          id: string
          permission: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vaccinations: {
        Row: {
          administered_at: string
          batch_no: string | null
          certificate_url: string | null
          created_at: string
          doctor_id: string | null
          id: string
          next_due_date: string | null
          notes: string | null
          pet_id: string
          vaccine_name: string
        }
        Insert: {
          administered_at?: string
          batch_no?: string | null
          certificate_url?: string | null
          created_at?: string
          doctor_id?: string | null
          id?: string
          next_due_date?: string | null
          notes?: string | null
          pet_id: string
          vaccine_name: string
        }
        Update: {
          administered_at?: string
          batch_no?: string | null
          certificate_url?: string | null
          created_at?: string
          doctor_id?: string | null
          id?: string
          next_due_date?: string | null
          notes?: string | null
          pet_id?: string
          vaccine_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccinations_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccinations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_advice: {
        Row: {
          advice_id: string
          visit_id: string
        }
        Insert: {
          advice_id: string
          visit_id: string
        }
        Update: {
          advice_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_advice_advice_id_fkey"
            columns: ["advice_id"]
            isOneToOne: false
            referencedRelation: "advice_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_advice_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "clinical_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_diagnoses: {
        Row: {
          diagnosis_id: string
          visit_id: string
        }
        Insert: {
          diagnosis_id: string
          visit_id: string
        }
        Update: {
          diagnosis_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_diagnoses_diagnosis_id_fkey"
            columns: ["diagnosis_id"]
            isOneToOne: false
            referencedRelation: "diagnoses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_diagnoses_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "clinical_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_symptoms: {
        Row: {
          symptom_id: string
          visit_id: string
        }
        Insert: {
          symptom_id: string
          visit_id: string
        }
        Update: {
          symptom_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_symptoms_symptom_id_fkey"
            columns: ["symptom_id"]
            isOneToOne: false
            referencedRelation: "symptoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_symptoms_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "clinical_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_tests: {
        Row: {
          test_id: string
          visit_id: string
        }
        Insert: {
          test_id: string
          visit_id: string
        }
        Update: {
          test_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_tests_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "medical_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_tests_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "clinical_visits"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      sale_reconciliation: {
        Row: {
          calculated_due: number | null
          created_at: string | null
          due_reduction: number | null
          has_mismatch: boolean | null
          id: string | null
          invoice_no: string | null
          invoice_total: number | null
          net_total: number | null
          payment_net: number | null
          refund_paid: number | null
          return_amount: number | null
          status: Database["public"]["Enums"]["sale_status"] | null
          stored_due: number | null
          stored_paid: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      account_balances: {
        Args: { _from?: string; _to?: string }
        Returns: {
          balance: number
          inflow: number
          method: string
          outflow: number
        }[]
      }
      account_balances_breakdown: {
        Args: { _from?: string; _to?: string }
        Returns: {
          closing: number
          method: string
          opening: number
          other_in: number
          other_out: number
          received: number
          refunded: number
        }[]
      }
      account_flows: {
        Args: { _from?: string; _to?: string }
        Returns: {
          method: string
          other_in: number
          other_out: number
          received: number
          refunded: number
        }[]
      }
      adjust_stock: {
        Args: {
          _notes?: string
          _product_id: string
          _quantity_change: number
          _reason?: Database["public"]["Enums"]["stock_adjustment_reason"]
        }
        Returns: Json
      }
      cancel_appointment: {
        Args: { _appointment_id: string; _reason?: string }
        Returns: Json
      }
      cancel_sale:
        | { Args: { _reason: string; _sale_id: string }; Returns: Json }
        | {
            Args: {
              _client_request_id?: string
              _reason: string
              _sale_id: string
            }
            Returns: Json
          }
      cash_shift_method_summary: {
        Args: { _shift_id?: string }
        Returns: {
          cancelled_in: number
          cancelled_out: number
          due_collections: number
          manual_in: number
          manual_out: number
          method: string
          net: number
          refunds: number
          sales: number
          supplier_payments: number
        }[]
      }
      cash_shift_method_transactions: {
        Args: { _method: string; _shift_id: string }
        Returns: {
          amount: number
          id: string
          kind: string
          note: string
          occurred_at: string
          party: string
          reference: string
        }[]
      }
      cash_shift_movements: {
        Args: { _shift_id: string }
        Returns: {
          amount: number
          created_at: string
          created_by: string | null
          direction: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          occurred_at: string
          reference: string | null
          shift_id: string | null
          source: string
          source_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "cash_movements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cash_shift_summary: { Args: { _shift_id?: string }; Returns: Json }
      change_payment_method: {
        Args: {
          _method: Database["public"]["Enums"]["payment_method"]
          _payment_id: string
        }
        Returns: Json
      }
      close_cash_shift: {
        Args: { _counted: number; _notes?: string; _shift_id: string }
        Returns: Json
      }
      collect_sale_due: {
        Args: {
          _amount: number
          _method?: Database["public"]["Enums"]["payment_method"]
          _reference?: string
          _sale_id: string
        }
        Returns: Json
      }
      create_appointment: {
        Args: {
          _doctor_id: string
          _duration_minutes?: number
          _fee?: number
          _notes?: string
          _pet_id: string
          _reason?: string
          _scheduled_at: string
          _serial_no?: number
        }
        Returns: Json
      }
      create_purchase_invoice: {
        Args: {
          _discount?: number
          _freight?: number
          _invoice_date: string
          _items: Json
          _notes?: string
          _paid?: number
          _payment_method?: Database["public"]["Enums"]["payment_method"]
          _supplier_id: string
          _supplier_invoice_no: string
          _vat?: number
        }
        Returns: Json
      }
      create_purchase_return: {
        Args: {
          _invoice_id: string
          _items: Json
          _reason?: string
          _refund_method?: Database["public"]["Enums"]["payment_method"]
          _restock?: boolean
        }
        Returns: Json
      }
      create_return:
        | {
            Args: {
              _items: Json
              _reason?: string
              _refund_method?: Database["public"]["Enums"]["payment_method"]
              _restock?: boolean
              _sale_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              _client_request_id?: string
              _items: Json
              _reason?: string
              _refund_method?: Database["public"]["Enums"]["payment_method"]
              _restock?: boolean
              _sale_id: string
            }
            Returns: Json
          }
      create_sale: {
        Args: {
          _discount?: number
          _items: Json
          _notes?: string
          _owner_id: string
          _payments: Json
        }
        Returns: Json
      }
      current_open_shift: { Args: { _user_id: string }; Returns: string }
      delete_purchase_invoice: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      has_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      next_appointment_serial: {
        Args: { _doctor_id: string; _scheduled_at: string }
        Returns: number
      }
      next_held_bill_no: { Args: never; Returns: string }
      next_invoice_no: { Args: never; Returns: string }
      next_purchase_invoice_no: { Args: never; Returns: string }
      next_purchase_return_no: { Args: never; Returns: string }
      next_return_no: { Args: never; Returns: string }
      next_visit_no: { Args: never; Returns: string }
      open_cash_shift: {
        Args: { _notes?: string; _opening: number }
        Returns: string
      }
      recalc_sale_totals: { Args: { _sale_id: string }; Returns: Json }
      receive_appointment_payment: {
        Args: {
          _amount: number
          _appointment_id: string
          _method?: Database["public"]["Enums"]["payment_method"]
          _reference?: string
        }
        Returns: Json
      }
      record_cash_movement: {
        Args: {
          _amount: number
          _direction: string
          _note?: string
          _reference?: string
          _source: string
          _source_id: string
          _user?: string
        }
        Returns: string
      }
      record_manual_cash: {
        Args: {
          _amount: number
          _direction: string
          _method?: Database["public"]["Enums"]["payment_method"]
          _note?: string
          _reason?: string
        }
        Returns: Json
      }
      record_purchase:
        | {
            Args: {
              _batch_no: string
              _expiry_date?: string
              _notes?: string
              _product_id: string
              _purchase_price: number
              _quantity: number
              _supplier_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _batch_no: string
              _client_request_id?: string
              _expiry_date?: string
              _notes?: string
              _product_id: string
              _purchase_price: number
              _quantity: number
              _supplier_id: string
            }
            Returns: Json
          }
      record_supplier_payment: {
        Args: {
          _amount: number
          _invoice_id: string
          _method?: Database["public"]["Enums"]["payment_method"]
          _notes?: string
          _paid_at?: string
          _reference?: string
          _supplier_id: string
        }
        Returns: string
      }
      reset_transactions: { Args: { _keep_dues?: boolean }; Returns: Json }
      update_sale: {
        Args: {
          _discount?: number
          _extra_payment?: Json
          _items?: Json
          _new_items?: Json
          _notes?: string
          _owner_id?: string
          _refund_method_in?: Database["public"]["Enums"]["payment_method"]
          _sale_id: string
          _set_owner?: boolean
        }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "doctor"
        | "reception"
        | "cashier"
        | "pharmacy"
        | "store_manager"
      appointment_status:
        | "pending"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
      payment_method:
        | "cash"
        | "bkash"
        | "nagad"
        | "rocket"
        | "card"
        | "bank"
        | "due"
      pet_species: "dog" | "cat" | "bird" | "cow" | "goat" | "rabbit" | "other"
      product_category:
        | "pet_food"
        | "medicine"
        | "accessory"
        | "service"
        | "other"
      sale_status: "completed" | "refunded" | "partial_refund" | "void"
      stock_adjustment_reason:
        | "damage"
        | "loss"
        | "found"
        | "correction"
        | "expired"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "doctor",
        "reception",
        "cashier",
        "pharmacy",
        "store_manager",
      ],
      appointment_status: [
        "pending",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      payment_method: [
        "cash",
        "bkash",
        "nagad",
        "rocket",
        "card",
        "bank",
        "due",
      ],
      pet_species: ["dog", "cat", "bird", "cow", "goat", "rabbit", "other"],
      product_category: [
        "pet_food",
        "medicine",
        "accessory",
        "service",
        "other",
      ],
      sale_status: ["completed", "refunded", "partial_refund", "void"],
      stock_adjustment_reason: [
        "damage",
        "loss",
        "found",
        "correction",
        "expired",
        "other",
      ],
    },
  },
} as const
