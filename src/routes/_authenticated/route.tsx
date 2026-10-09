import { createFileRoute, Outlet, redirect, useRouterState, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { permissionForPath } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShiftStatusBadge } from "@/components/ShiftStatusBadge";
import { MobileBottomNav } from "@/components/MobileBottomNav";



export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // getSession() reads the locally cached session, so switching menus does not
    // pay for a network round-trip to the auth server on every navigation.
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) throw redirect({ to: "/auth" });
    return { user: data.session.user };
  },
  component: AuthenticatedLayout,
});

function PermissionGate() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { can, loading, permissions, roles } = useAuth();
  const required = permissionForPath(pathname);

  // wait until roles/permissions have loaded before judging access
  if (loading && permissions.length === 0 && roles.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (required && !can(required)) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="space-y-3 py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">Access denied</h2>
          <p className="text-sm text-muted-foreground">
            You don't have permission to open this module. Ask an admin to grant access from
            Staff &amp; Permissions.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <Outlet />;
}

function AuthenticatedLayout() {
  return (
    <AuthProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full min-w-0 max-w-full overflow-x-clip bg-background">
          <AppSidebar />
          <SidebarInset className="w-full min-w-0 flex-1 overflow-x-clip">

            <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/80 px-3 sm:px-4 backdrop-blur">
              <SidebarTrigger className="hidden md:flex" />
              <ShiftStatusBadge />
              <div className="ml-auto text-xs text-muted-foreground truncate">

                <span className="hidden sm:inline">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
                <span className="sm:hidden">{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </div>
            </header>
            <main className="min-w-0 flex-1 overflow-x-clip p-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:p-6 md:pb-6">
              <PermissionGate />
            </main>
            <MobileBottomNav />

          </SidebarInset>
        </div>
      </SidebarProvider>
    </AuthProvider>
  );
}

