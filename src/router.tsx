import { MutationCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { setAppQueryClient } from "./lib/refresh-data";

export const getRouter = () => {
  const queryClient: QueryClient = new QueryClient({
    // Every write (sale, payment, return, purchase, cash entry, stock change…)
    // touches several screens at once. Pages used to invalidate only a few
    // hand-picked keys, so Dashboard / Cash Drawer / Due lists / POS shift
    // status kept showing old numbers for up to 10 minutes after a save.
    // Marking every cached query stale after any mutation fixes that; only
    // the queries on screen refetch immediately, the rest refetch on next view.
    mutationCache: new MutationCache({
      onSettled: () => {
        void queryClient.invalidateQueries();
      },
    }),
    defaultOptions: {
      queries: {
        // Menu-to-menu navigation should reuse cached data instead of refetching
        // the same rows on every mount.
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });
  setAppQueryClient(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Prefetch route chunks on hover/touch so switching menus feels instant.
    defaultPreload: "intent",
    defaultPreloadDelay: 30,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
