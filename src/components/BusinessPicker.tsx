// Business buttons: Pet Care Vet / Sasthya Seba, plus an optional third choice
// (Shared for expenses, Oldest first for due collection).
import { PROJECTS } from "@/lib/projects";

export function BusinessPicker<T extends string>({
  value,
  onChange,
  extra,
  label = "Business",
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  /** Third option shown after the two businesses, e.g. { value: "shared", label: "Shared" }. */
  extra?: { value: T; label: string; hint?: string };
  label?: string;
  disabled?: boolean;
}) {
  const opts: { value: T; label: string; tone?: string }[] = [
    ...PROJECTS.map((p) => ({ value: p.key as T, label: p.label, tone: p.tone })),
    ...(extra ? [{ value: extra.value, label: extra.label }] : []),
  ];
  return (
    <div className={`grid gap-1.5 ${opts.length === 3 ? "grid-cols-3" : "grid-cols-2"}`} role="radiogroup" aria-label={label}>
      {opts.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={o.value === extra?.value ? extra?.hint : undefined}
            onClick={() => onChange(o.value)}
            className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              on ? (o.tone ? "border-transparent text-white" : "border-transparent bg-foreground text-background") : "text-muted-foreground hover:text-foreground"
            }`}
            style={on && o.tone ? { background: o.tone } : undefined}
          >
            {o.tone && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: on ? "#fff" : o.tone }} />}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
