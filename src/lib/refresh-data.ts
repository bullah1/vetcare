import type { QueryClient } from "@tanstack/react-query";

// Writes made outside useMutation (plain async handlers, helper libs) call
// refreshAppData() so every screen re-reads the changed rows, exactly like a
// mutation does through the global MutationCache in router.tsx.
let client: QueryClient | null = null;

export function setAppQueryClient(qc: QueryClient) {
  client = qc;
}

export function refreshAppData() {
  if (client) void client.invalidateQueries();
}
