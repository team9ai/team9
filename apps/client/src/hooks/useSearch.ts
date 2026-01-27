import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import searchApi from "@/services/api/search";
import type {
  CombinedSearchResponse,
  SearchOptions,
} from "@/services/api/search";

interface UseSearchOptions extends SearchOptions {
  enabled?: boolean;
  debounceMs?: number;
}

/**
 * Hook for unified search across messages, channels, users, and files
 */
export function useSearch(query: string, options: UseSearchOptions = {}) {
  const { enabled = true, limit = 10, offset = 0 } = options;

  // Only search if query is not empty
  const shouldSearch = enabled && query.trim().length > 0;

  return useQuery({
    queryKey: ["search", query, limit, offset],
    queryFn: () => searchApi.search(query, { limit, offset }),
    enabled: shouldSearch,
    staleTime: 30000, // Cache for 30 seconds
    placeholderData: (previousData) => previousData, // Keep previous data while loading
  });
}

/**
 * Hook for searching messages only
 */
export function useSearchMessages(
  query: string,
  options: Omit<UseSearchOptions, "type"> = {},
) {
  const { enabled = true, limit = 20, offset = 0 } = options;
  const shouldSearch = enabled && query.trim().length > 0;

  return useQuery({
    queryKey: ["search", "messages", query, limit, offset],
    queryFn: () => searchApi.searchMessages(query, { limit, offset }),
    enabled: shouldSearch,
    staleTime: 30000,
  });
}

/**
 * Hook for searching channels only
 */
export function useSearchChannels(
  query: string,
  options: Omit<UseSearchOptions, "type"> = {},
) {
  const { enabled = true, limit = 20, offset = 0 } = options;
  const shouldSearch = enabled && query.trim().length > 0;

  return useQuery({
    queryKey: ["search", "channels", query, limit, offset],
    queryFn: () => searchApi.searchChannels(query, { limit, offset }),
    enabled: shouldSearch,
    staleTime: 30000,
  });
}

/**
 * Hook for searching users only
 */
export function useSearchUsers(
  query: string,
  options: Omit<UseSearchOptions, "type"> = {},
) {
  const { enabled = true, limit = 20, offset = 0 } = options;
  const shouldSearch = enabled && query.trim().length > 0;

  return useQuery({
    queryKey: ["search", "users", query, limit, offset],
    queryFn: () => searchApi.searchUsers(query, { limit, offset }),
    enabled: shouldSearch,
    staleTime: 30000,
  });
}

/**
 * Hook for searching files only
 */
export function useSearchFiles(
  query: string,
  options: Omit<UseSearchOptions, "type"> = {},
) {
  const { enabled = true, limit = 20, offset = 0 } = options;
  const shouldSearch = enabled && query.trim().length > 0;

  return useQuery({
    queryKey: ["search", "files", query, limit, offset],
    queryFn: () => searchApi.searchFiles(query, { limit, offset }),
    enabled: shouldSearch,
    staleTime: 30000,
  });
}

/**
 * Hook for debounced search with local state management
 */
export function useDebouncedSearch(debounceMs: number = 300) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(
    null,
  );

  const updateQuery = useCallback(
    (value: string) => {
      setSearchQuery(value);

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      const timer = setTimeout(() => {
        setDebouncedQuery(value);
      }, debounceMs);

      setDebounceTimer(timer);
    },
    [debounceMs, debounceTimer],
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setDebouncedQuery("");
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  }, [debounceTimer]);

  const searchResults = useSearch(debouncedQuery, {
    enabled: debouncedQuery.trim().length > 0,
  });

  // Calculate total results count
  const totalResults = useMemo(() => {
    if (!searchResults.data) return 0;
    const data = searchResults.data;
    return (
      data.messages.total +
      data.channels.total +
      data.users.total +
      data.files.total
    );
  }, [searchResults.data]);

  // Check if there are any results
  const hasResults = useMemo(() => {
    if (!searchResults.data) return false;
    const data = searchResults.data;
    return (
      data.messages.items.length > 0 ||
      data.channels.items.length > 0 ||
      data.users.items.length > 0 ||
      data.files.items.length > 0
    );
  }, [searchResults.data]);

  return {
    searchQuery,
    debouncedQuery,
    updateQuery,
    clearSearch,
    ...searchResults,
    totalResults,
    hasResults,
  };
}

export type { CombinedSearchResponse };
