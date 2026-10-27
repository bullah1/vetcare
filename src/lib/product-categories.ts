// Product categories. Each category belongs to one project (Pet Care Vet or
// Sasthya Seba) — picking a category puts the product in that project.
// Works before the projects SQL is run: then `available` is false and the
// older fixed category list is used.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Project } from "@/lib/projects";

export type ProductCategory = {
  id: string;
  name: string;
  project: Project;
  legacy_category: string;
  sort: number;
  is_active: boolean;
};

export const LEGACY_CATEGORIES = ["medicine", "pet_food", "accessory", "service", "other"] as const;
export const LEGACY_LABEL: Record<string, string> = {
  medicine: "Medicine",
  pet_food: "Food",
  accessory: "Accessory",
  service: "Service",
  other: "Other",
};

export function useProductCategories() {
  const q = useQuery({
    queryKey: ["product-categories"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_categories")
        .select("id, name, project, legacy_category, sort, is_active")
        .order("project")
        .order("sort")
        .order("name");
      if (error) return { available: false, cats: [] as ProductCategory[] };
      return { available: true, cats: (data ?? []) as ProductCategory[] };
    },
  });
  const cats = q.data?.cats ?? [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  return { available: !!q.data?.available, cats, byId, isLoading: q.isLoading };
}
