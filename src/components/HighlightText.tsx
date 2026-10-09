import { highlightParts, type MatchRange } from "@/lib/fuzzy-search";

/** Renders text with fuzzy-search matches marked. */
export function HighlightText({
  text,
  ranges,
  className,
}: {
  text: string;
  ranges?: MatchRange[];
  className?: string;
}) {
  if (!ranges || ranges.length === 0) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {highlightParts(text, ranges).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded bg-warning/40 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
