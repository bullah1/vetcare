import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ShoppingCart,
  CalendarDays,
  PawPrint,
  Stethoscope,
  Pill,
  Package,
  Truck,
  Wallet,
  BarChart3,
  Users,
  LogOut,
  Settings,
  History,
  ClipboardEdit,
  HandCoins,
  ShieldCheck,
  ClipboardList,
  Bike,
  HeartPulse,
  Brain,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { MODULES } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

const ICONS: Record<string, typeof Users> = {
  dashboard: LayoutDashboard,
  clinic_dashboard: HeartPulse,
  clinical_intelligence: Brain,
  appointments: CalendarDays,
  appointment_history: History,
  pets: PawPrint,
  clinical_visit: Stethoscope,
  medical: ClipboardList,
  prescriptions: Pill,
  pos: ShoppingCart,
  sales_history: History,
  inventory: Package,
  purchases: Truck,
  adjustments: ClipboardEdit,
  cash_drawer: Wallet,
  receivables: HandCoins,
  pending_bills: ClipboardList,
  deliveries: Bike,
  accounts: Wallet,
  reports: BarChart3,
  crm: Users,
  staff: ShieldCheck,
  settings: Settings,
};

const GROUP_ORDER = ["Overview", "Clinic", "Shop", "Business"];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, roles, hasRole, can, signOut } = useAuth();
  const isAdmin = hasRole("admin");

  const visibleGroups = GROUP_ORDER.map((label) => ({
    label,
    items: MODULES.filter((m) => m.group === label && can(m.key)),
  })).filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white p-1">
            <img src="/logo-mark.png" alt="Pet Care Vet" className="h-full w-full object-contain" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold text-sidebar-foreground">Pet Care Vet</span>
            <span className="text-xs text-sidebar-foreground/60">
              {isAdmin ? "Admin" : roles[0] ? roles[0].replace(/_/g, " ") : "Staff"}
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const Icon = ICONS[item.key] ?? Users;
                  const active = pathname === item.url || pathname.startsWith(item.url + "/");
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link to={item.url}>
                          <Icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-xs font-semibold">
            {(user?.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-xs font-medium text-sidebar-foreground">{user?.email}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => signOut()}
        >
          <LogOut className="h-4 w-4" />
          <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
