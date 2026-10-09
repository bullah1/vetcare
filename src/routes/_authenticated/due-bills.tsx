import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { DueBillsList } from "@/components/DueBillsList";

export const Route = createFileRoute("/_authenticated/due-bills")({
  head: () => ({
    meta: [
      { title: "Due Bills — Delivered but Unpaid | Pet Care Vet ERP" },
      {
        name: "description",
        content:
          "Completed orders where the customer still owes money. Collect the remaining due by cash, bKash, card or bank and print the invoice.",
      },
      { property: "og:title", content: "Due Bills — Delivered but Unpaid | Pet Care Vet ERP" },
      {
        property: "og:description",
        content: "Outstanding customer dues from completed sales, with one-tap collection and receipt printing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DueBillsPage,
});

function DueBillsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Due Bills"
        description="Order completed & products handed over — payment still outstanding."
        icon={AlertCircle}
        actions={
          <Button asChild variant="outline">
            <Link to="/pending-bills">
              <ClipboardList className="h-4 w-4" /> Pending Bills
            </Link>
          </Button>
        }
      />
      <DueBillsList />
    </div>
  );
}
