import { useState } from "react";
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
  Settings,
  History,
  ClipboardEdit,
  HandCoins,
  ShieldCheck,
  LogOut,
  LayoutGrid,
  ClipboardList,
  Bike,
  PackageCheck,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { MODULES } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Users> = {
  dashboard: LayoutDashboard,
  appointments: CalendarDays,
  pets: PawPrint,
  medical: Stethoscope,
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
  delivery_report: PackageCheck,
  accounts: Wallet,
  reports: BarChart3,
  crm: Users,
  staff: ShieldCheck,
  settings: Settings,
};

/** Primary tabs, in order of preference — first 4 the user can access are shown. */
const PRIMARY = ["pos", "dashboard", "inventory", "sales_history", "receivables", "appointments"];
const GROUP_ORDER = ["Overview", "Clinic", "Shop", "Business"];

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { can, user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const tabs = PRIMARY.map((key) => MODULES.find((m) => m.key === key))
    .filter((m): m is (typeof MODULES)[number] => !!m && can(m.key))
    .slice(0, 4);

  const groups = GROUP_ORDER.map((label) => ({
    label,
    items: MODULES.filter((m) => m.group === label && can(m.key)),
  })).filter((g) => g.items.length > 0);

  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="flex items-stretch">
          {tabs.map((m) => {
            const Icon = ICONS[m.key] ?? Users;
            const active = isActive(m.url);
            return (
              <Link
                key={m.url}
                to={m.url}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "scale-110")} />
                <span className="max-w-full truncate px-1">{m.label.split(" ")[0]}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium text-muted-foreground"
          >
            <LayoutGrid className="h-5 w-5" />
            <span>More</span>
          </button>
        </div>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>All modules</SheetTitle>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-4">
            {groups.map((g) => (
              <div key={g.label} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {g.items.map((m) => {
                    const Icon = ICONS[m.key] ?? Users;
                    const active = isActive(m.url);
                    return (
                      <Link
                        key={m.url}
                        to={m.url}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center text-[11px] font-medium",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card text-foreground",
                        )}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="leading-tight">{m.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <span className="min-w-0 truncate text-xs text-muted-foreground">{user?.email}</span>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => signOut()}>
                <LogOut className="mr-1 h-4 w-4" /> Sign out
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
