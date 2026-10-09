// The Data API caps every response at 1000 rows no matter what `.limit()` says.
// Reports/dashboards read far more line items than that, and a silent cut makes
// COGS and profit numbers wrong. Always page through with .range().
const PAGE = 1000;

type Pageable = { range: (a: number, b: number) => any };

export async function fetchAll<T = any>(build: () => Pageable, max = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < max; start += PAGE) {
    const { data, error } = await build().range(start, start + PAGE - 1);
    if (error) throw error;
    const rows: T[] = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Paged read for an `.in(column, ids)` filter. Hundreds of ids in one request
 * make the URL too long and the request fails, so ids go in chunks.
 */
export async function fetchAllIn<T = any>(
  ids: string[],
  build: (chunk: string[]) => Pageable,
  chunkSize = 150,
): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    out.push(...(await fetchAll<T>(() => build(chunk))));
  }
  return out;
}
