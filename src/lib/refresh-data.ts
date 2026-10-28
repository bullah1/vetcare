import type { QueryClient } from "@tanstack/react-query";

// Writes made outside useMutation (plain async handlers, helper libs) call
// refreshAppData() so every screen re-reads the changed rows, exactly like a
// mutation does through the global MutationCache in router.tsx.
let client: QueryClient | null = null;

export function setAppQueryClient(qc: QueryClient) {
  client = qc;
}

/** After a write: refetch what is on screen, except big lists marked
 *  meta.manualRefresh — those are only marked stale (reload on next visit). */
export function invalidateAfterWrite(qc: QueryClient) {
  void qc.invalidateQueries({ predicate: (q) => !q.meta?.manualRefresh });
  void qc.invalidateQueries({ predicate: (q) => !!q.meta?.manualRefresh, refetchType: "none" });
}

export function refreshAppData() {
  if (client) invalidateAfterWrite(client);
}
