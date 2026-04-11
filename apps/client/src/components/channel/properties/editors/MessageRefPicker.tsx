import { useCallback, useState, useRef, useEffect } from "react";
import { MessageSquare, Search, X, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { searchApi, type MessageSearchResultData } from "@/services/api/search";
import type { PropertyDefinition } from "@/types/properties";

interface MessageRefPickerProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  channelId?: string;
}

export function MessageRefPicker({
  value,
  onChange,
  disabled,
}: MessageRefPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<MessageSearchResultData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentValue = typeof value === "string" ? value : "";

  // Search messages with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim()) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchApi.searchMessages(searchQuery, {
          limit: 10,
        });
        setResults(searchResults.items.map((item) => item.data));
        setShowDropdown(true);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (msg: MessageSearchResultData) => {
      onChange(msg.id);
      setSelectedPreview(
        msg.content.replace(/<[^>]+>/g, "").slice(0, 60) || "Message",
      );
      setSearchQuery("");
      setShowDropdown(false);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
    setSelectedPreview(null);
    setSearchQuery("");
  }, [onChange]);

  return (
    <div className="relative" ref={dropdownRef}>
      {currentValue ? (
        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {selectedPreview || currentValue}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              if (results.length > 0) setShowDropdown(true);
            }}
            disabled={disabled}
            placeholder="Search messages..."
          />
          {isSearching && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          )}
        </div>
      )}

      {/* Search results dropdown */}
      {showDropdown && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-popover shadow-md">
          {results.map((msg) => {
            const preview = msg.content.replace(/<[^>]+>/g, "");
            const truncated =
              preview.length > 80 ? preview.slice(0, 80) + "..." : preview;
            return (
              <button
                key={msg.id}
                className="w-full px-3 py-2 text-left hover:bg-muted transition-colors border-b border-border last:border-0"
                onClick={() => handleSelect(msg)}
              >
                <div className="text-sm line-clamp-2">
                  {truncated || "Empty message"}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <span>{msg.senderDisplayName || msg.senderUsername}</span>
                  <span>{new Date(msg.createdAt).toLocaleDateString()}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
