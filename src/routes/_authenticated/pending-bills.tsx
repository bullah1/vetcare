import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardList, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { PendingBillsList } from "@/components/PendingBillsList";

export const Route = createFileRoute("/_authenticated/pending-bills")({
  head: () => ({
    meta: [
      { title: "Pending Bills — Held & Online Orders | Pet Care Vet ERP" },
      {
        name: "description",
        content:
          "Bills that are not finalised yet: counter holds, online and delivery orders waiting to be completed at the POS counter.",
      },
      { property: "og:title", content: "Pending Bills — Held & Online Orders | Pet Care Vet ERP" },
      {
        property: "og:description",
        content: "Track unfinished bills, resume them at POS and see how many were completed today.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PendingBillsPage,
});

function PendingBillsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Pending Bills"
        description="Not finalised yet — counter holds, online & delivery orders the customer will collect later."
        icon={ClipboardList}
        actions={
          <Button asChild variant="outline">
            <Link to="/due-bills">
              <AlertCircle className="h-4 w-4" /> Due Bills
            </Link>
          </Button>
        }
      />
      <PendingBillsList />
    </div>
  );
}
