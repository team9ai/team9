import { createFileRoute } from "@tanstack/react-router";
import { SearchPage } from "@/components/search/SearchPage";

// Search params type for search route
export type SearchSearchParams = {
  q?: string;
  type?: "messages" | "channels" | "users" | "files";
};

export const Route = createFileRoute("/_authenticated/search")({
  component: SearchPageRoute,
  validateSearch: (search: Record<string, unknown>): SearchSearchParams => {
    return {
      q: search.q as string | undefined,
      type: search.type as SearchSearchParams["type"] | undefined,
    };
  },
});

function SearchPageRoute() {
  const { q, type } = Route.useSearch();
  return <SearchPage initialQuery={q} initialType={type} />;
}
