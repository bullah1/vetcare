/** Every gated module in the app. `key` is the permission string stored in user_permissions. */
export type ModuleDef = { key: string; label: string; url: string; group: string; hidden?: boolean };

export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", url: "/dashboard", group: "Overview" },

  { key: "clinic_dashboard", label: "Clinic Dashboard", url: "/clinic-dashboard", group: "Clinic" },
  { key: "appointments", label: "Appointments", url: "/appointments", group: "Clinic" },
  { key: "clinic_bill", label: "Service Bill", url: "/clinic-bill", group: "Clinic" },
  { key: "pets", label: "Pets & Owners", url: "/pets", group: "Clinic" },
  // Older clinic pages: kept and still guarded, but not shown in the menu.
  { key: "clinical_intelligence", label: "Clinical Intelligence", url: "/clinical-intelligence", group: "Clinic", hidden: true },
  { key: "appointment_history", label: "Appointment History", url: "/appointment-history", group: "Clinic", hidden: true },
  { key: "clinical_visit", label: "Clinical Visit", url: "/clinical-visit", group: "Clinic", hidden: true },
  { key: "medical", label: "Medical Records", url: "/medical", group: "Clinic", hidden: true },
  { key: "prescriptions", label: "Prescriptions", url: "/prescriptions", group: "Clinic", hidden: true },

  { key: "pos", label: "POS Counter", url: "/pos", group: "Shop" },
  { key: "sales_history", label: "Sales History", url: "/sales-history", group: "Shop" },
  { key: "inventory", label: "Inventory", url: "/inventory", group: "Shop" },
  { key: "purchases", label: "Purchases", url: "/purchases", group: "Shop" },
  { key: "adjustments", label: "Stock Adjustments", url: "/adjustments", group: "Shop" },
  { key: "cash_drawer", label: "Cash Drawer", url: "/cash-drawer", group: "Shop" },
  { key: "reconciliation", label: "Drawer Reconciliation", url: "/reconciliation", group: "Shop" },
  { key: "receivables", label: "Customers", url: "/receivables", group: "Shop" },
  { key: "pending_bills", label: "Pending Bills", url: "/pending-bills", group: "Shop" },
  { key: "due_bills", label: "Due Bills", url: "/due-bills", group: "Shop" },
  { key: "deliveries", label: "Deliveries", url: "/deliveries", group: "Shop" },
  { key: "delivery_report", label: "Delivery Report", url: "/delivery-report", group: "Shop" },

  { key: "accounts", label: "Accounts", url: "/accounts", group: "Business" },
  { key: "business_report", label: "Business Report", url: "/business-report", group: "Business" },
  { key: "product_sales", label: "Product Sales", url: "/product-sales", group: "Business" },
  { key: "reports", label: "Reports", url: "/reports", group: "Business" },
  { key: "crm", label: "CRM", url: "/crm", group: "Business" },
  { key: "staff", label: "Staff & Permissions", url: "/staff", group: "Business" },
  { key: "settings", label: "Settings", url: "/settings", group: "Business" },
];

/** Permissions that are not a page (special actions). */
export const ACTION_PERMISSIONS: { key: string; label: string; hint: string }[] = [
  { key: "price_override", label: "Change prices in POS", hint: "B2B / wholesale bills. Below the minimum price still needs an admin." },
];

export const PERMISSION_KEYS = [...MODULES.map((m) => m.key), ...ACTION_PERMISSIONS.map((a) => a.key)];

/** Modules only an admin may ever access, regardless of granted permissions. */
export const ADMIN_ONLY_KEYS = ["staff"];

/** A permission that is also granted by another one (older users keep access). */
export const IMPLIED_BY: Record<string, string> = { delivery_report: "deliveries", clinic_bill: "appointments", product_sales: "reports" };

/** Map a pathname to the permission that guards it. */
export function permissionForPath(pathname: string): string | null {
  const match = MODULES.filter((m) => pathname === m.url || pathname.startsWith(m.url + "/")).sort(
    (a, b) => b.url.length - a.url.length,
  )[0];
  return match ? match.key : null;
}

/** Sensible starting permission sets per role, used when creating a user. */
export const ROLE_PRESETS: Record<string, string[]> = {
  admin: PERMISSION_KEYS,
  doctor: ["dashboard", "clinic_dashboard", "clinic_bill", "clinical_intelligence", "appointments", "appointment_history", "pets", "clinical_visit", "medical", "prescriptions"],
  reception: ["dashboard", "clinic_dashboard", "appointments", "clinic_bill", "appointment_history", "pets", "receivables", "crm", "pending_bills", "due_bills"],
  cashier: ["dashboard", "pos", "sales_history", "cash_drawer", "reconciliation", "receivables", "pending_bills", "due_bills", "deliveries", "delivery_report"],
  pharmacy: ["dashboard", "pos", "inventory", "prescriptions", "adjustments"],
  store_manager: ["dashboard", "inventory", "purchases", "adjustments", "reports", "product_sales"],
};
