import { useState, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchApi } from "@/services/api/search";
import type { UserSearchResultData } from "@/services/api/search";

export interface UserOption {
  userId: string;
  displayName: string;
}

export interface MultiUserPickerProps {
  value: UserOption[];
  onChange: (next: UserOption[]) => void;
  disabled?: boolean;
  maxItems?: number;
}

export function MultiUserPicker({
  value,
  onChange,
  disabled = false,
  maxItems = 50,
}: MultiUserPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const atCap = value.length >= maxItems;

  const handleQueryChange = (q: string) => {
    setQuery(q);

    if (searchTimeout.current !== null) {
      clearTimeout(searchTimeout.current);
    }

    if (!q.trim()) {
      setResults([]);
      setDropdownOpen(false);
      return;
    }

    searchTimeout.current = setTimeout(() => {
      setSearching(true);
      searchApi
        .searchUsers(q, { limit: 10 })
        .then((res) => {
          const selectedIds = new Set(value.map((u) => u.userId));
          const mapped: UserOption[] = res.items
            .map((item) => ({
              userId: item.data.id,
              displayName:
                (item.data as UserSearchResultData).displayName ||
                (item.data as UserSearchResultData).username ||
                item.id,
            }))
            .filter((u) => !selectedIds.has(u.userId));
          setResults(mapped);
          setDropdownOpen(mapped.length > 0);
        })
        .catch(() => {
          setResults([]);
          setDropdownOpen(false);
        })
        .finally(() => {
          setSearching(false);
        });
    }, 200);
  };

  const handleSelect = (user: UserOption) => {
    if (atCap) return;
    onChange([...value, user]);
    setQuery("");
    setResults([]);
    setDropdownOpen(false);
  };

  const handleRemove = (userId: string) => {
    onChange(value.filter((u) => u.userId !== userId));
  };

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((user) => (
            <span
              key={user.userId}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {user.displayName}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${user.displayName}`}
                  className="ml-0.5 rounded-full text-primary/70 hover:text-primary focus:outline-none"
                  onClick={() => handleRemove(user.userId)}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Cap error */}
      {atCap && (
        <p className="text-xs text-destructive">
          Maximum of {maxItems} users reached.
        </p>
      )}

      {/* Search input */}
      {!atCap && (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onBlur={() => {
              // Delay close so click on result fires first
              setTimeout(() => setDropdownOpen(false), 150);
            }}
            disabled={disabled}
            placeholder="Search users…"
            className={cn(
              "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            )}
            aria-label="Search users"
          />
          {searching && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              …
            </span>
          )}

          {/* Dropdown */}
          {dropdownOpen && results.length > 0 && (
            <ul className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-md">
              {results.map((user) => (
                <li key={user.userId}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-primary/5 focus:bg-primary/5 focus:outline-none"
                    onMouseDown={() => handleSelect(user)}
                  >
                    {user.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
