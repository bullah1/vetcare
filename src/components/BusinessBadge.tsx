// Customer / supplier business: Pet Care Vet, Sasthya Seba or Both.
import { PROJECTS, type Project } from "@/lib/projects";

export type Biz = Project | "both";
export const asBiz = (v?: string | null): Biz => (v === "ss" || v === "both" ? v : "pcv");
/** Does a customer / supplier of `biz` belong to this business? Missing column = Pet Care Vet. */
export const bizMatches = (biz: string | null | undefined, project: Project) => {
  const b = asBiz(biz);
  return b === "both" || b === project;
};
export const bizLabel = (b?: string | null) => (asBiz(b) === "both" ? "Both" : PROJECTS.find((p) => p.key === asBiz(b))!.label);

export function BusinessBadge({ biz, className = "" }: { biz?: string | null; className?: string }) {
  const b = asBiz(biz);
  if (b === "both") {
    return (
      <span className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10px] font-semibold text-muted-foreground ${className}`}>
        {PROJECTS.map((p) => <span key={p.key} className="h-1.5 w-1.5 rounded-full" style={{ background: p.tone }} />)}
        Both
      </span>
    );
  }
  const p = PROJECTS.find((x) => x.key === b)!;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-semibold ${className}`} style={{ color: p.tone, borderColor: `${p.tone}55` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.tone }} />
      {p.short}
    </span>
  );
}
