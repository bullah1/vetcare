import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — Pet Care Vet ERP" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/dashboard" });
  }

  async function handleGoogle() {
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    if (data.url) {
      window.location.href = data.url;
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-background">
      {/* Brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: "var(--color-primary)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--color-primary)" }}
        />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white p-1.5 shadow-lg">
            <img src="/logo-mark.png" alt="Pet Care Vet" className="h-full w-full object-contain" />
          </div>
          <div className="leading-tight">
            <span className="block text-xl font-semibold">Pet Care Vet</span>
            <span className="block text-xs text-sidebar-foreground/60">Clinic & POS management</span>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight">
            Complete clinic management,
            <span className="text-sidebar-primary"> from consult to counter.</span>
          </h1>
          <p className="max-w-md text-sm text-sidebar-foreground/70">
            POS, appointments, pet records, prescriptions, inventory and accounts — everything one vet clinic
            needs, in one fast workspace.
          </p>
          <ul className="grid max-w-md gap-2 sm:grid-cols-2">
            {[
              "Fast barcode POS",
              "Cash drawer & shifts",
              "Stock & expiry alerts",
              "Invoice & WhatsApp share",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-sidebar-foreground/80">
                <ShieldCheck className="h-4 w-4 text-sidebar-primary" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-sidebar-foreground/50">© {new Date().getFullYear()} Pet Care Vet ERP</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-5 sm:p-8 lg:p-12">
        <div className="w-full max-w-md space-y-6">
          {/* Mobile brand header */}
          <div className="flex flex-col items-center gap-3 lg:hidden">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white p-2 shadow-md">
              <img src="/logo-mark.png" alt="Pet Care Vet" className="h-full w-full object-contain" />
            </div>
            <div className="text-center">
              <h1 className="text-lg font-semibold tracking-tight">Pet Care Vet</h1>
              <p className="text-xs text-muted-foreground">Clinic & POS management</p>
            </div>
          </div>

          <Card className="border-border/80 shadow-[var(--shadow-soft)]">
            <CardHeader className="space-y-1.5">
              <CardTitle className="text-2xl">Staff sign in</CardTitle>
              <CardDescription>
                Accounts are created by the admin only. Ask your admin for login details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@clinic.com"
                      className="h-11 pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="h-11 pl-9 pr-11"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <Button variant="outline" className="h-11 w-full" onClick={handleGoogle} disabled={busy}>
                <GoogleIcon />
                Continue with Google
              </Button>

              <p className="mt-5 text-center text-xs text-muted-foreground">
                Self-registration is disabled. Only an admin can create staff accounts.
              </p>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground lg:hidden">
            © {new Date().getFullYear()} Pet Care Vet ERP
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z" />
    </svg>
  );
}
