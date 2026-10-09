import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// On Vercel (Vercel sets VERCEL=1 during its build) the server is built for
// Vercel Functions. Lovable and local builds are unchanged.
const onVercel = !!process.env.VERCEL;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  ...(onVercel ? { nitro: { preset: "vercel" } } : {}),
});
