// Typo-tolerant product search.
// Matches whole substrings first, then falls back to per-word fuzzy matching so
// slightly misspelled queries ("smrt hart" -> "SmartHeart") still find products.

export type MatchRange = { start: number; end: number };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const compact = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** Bounded Levenshtein distance; returns max+1 when it exceeds the budget. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

/** How many typos we tolerate for a query word of this length. */
function budget(len: number): number {
  if (len <= 2) return 0;
  if (len <= 4) return 1;
  if (len <= 7) return 2;
  return 3;
}

function wordSpans(text: string): MatchRange[] {
  const spans: MatchRange[] = [];
  const re = /[^\s,./\-()]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length });
  return spans;
}

export type FuzzyResult = { score: number; ranges: MatchRange[] };

/**
 * Score `text` against `query`.
 * Returns null when nothing matches. Higher score = better match.
 */
export function fuzzyMatch(text: string, query: string): FuzzyResult | null {
  const t = norm(text);
  const q = norm(query);
  if (!q) return { score: 0, ranges: [] };

  // 1. Exact substring — strongest signal.
  const idx = t.indexOf(q);
  if (idx >= 0) {
    const boundary = idx === 0 || /[\s,./\-()]/.test(t[idx - 1]);
    return { score: 1000 - idx + (boundary ? 200 : 0), ranges: [{ start: idx, end: idx + q.length }] };
  }

  // 2. All query words matched (exact prefix or near-miss) somewhere in the text.
  const qWords = q.split(" ").filter(Boolean);
  const spans = wordSpans(t);
  const ranges: MatchRange[] = [];
  let score = 0;

  for (const qw of qWords) {
    let best: { span: MatchRange; gain: number } | null = null;
    for (const span of spans) {
      const w = t.slice(span.start, span.end);
      let gain = -1;
      if (w.startsWith(qw)) gain = 500 - (w.length - qw.length);
      else if (w.includes(qw)) gain = 350;
      else {
        const max = budget(qw.length);
        if (max > 0) {
          // Slide a window across the word so a typo'd fragment of a long
          // compound name (e.g. "hart" inside "smartheart") still matches.
          let d = editDistance(qw, w, max);
          const win = qw.length + max;
          for (let i = 0; d > max && i + 1 < w.length; i++) {
            d = Math.min(d, editDistance(qw, w.slice(i, i + win), max));
          }
          if (d <= max) gain = 260 - d * 60;
        }
      }

      if (gain > 0 && (!best || gain > best.gain)) best = { span, gain };
    }
    if (!best) return null;
    score += best.gain;
    ranges.push(best.span);
  }

  return { score: score / qWords.length, ranges: mergeRanges(ranges) };
}

/** Compact (space-insensitive) containment for SKU / barcode fields. */
export function codeMatch(code: string | null | undefined, query: string): boolean {
  if (!code) return false;
  const q = compact(query);
  return q.length > 0 && compact(code).includes(q);
}

export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: MatchRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Split original text into highlighted / plain segments using match ranges. */
export function highlightParts(text: string, ranges: MatchRange[]): { text: string; hit: boolean }[] {
  if (!ranges.length) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const r of mergeRanges(ranges)) {
    const start = Math.max(0, Math.min(r.start, text.length));
    const end = Math.max(start, Math.min(r.end, text.length));
    if (start > pos) parts.push({ text: text.slice(pos, start), hit: false });
    if (end > start) parts.push({ text: text.slice(start, end), hit: true });
    pos = end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
  return parts;
}
