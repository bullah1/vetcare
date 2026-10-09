import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Pet Care Vet — Clinic Workspace" },
    { name: "description", content: "Pet Care Vet clinic workspace for appointments, sales, inventory and accounts." },
    { property: "og:title", content: "Pet Care Vet — Clinic Workspace" },
    { property: "og:description", content: "Pet Care Vet clinic workspace for appointments, sales, inventory and accounts." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
  component: () => null,
});
