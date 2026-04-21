import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { MessageSquare, Search, X, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { searchApi, type MessageSearchResultData } from "@/services/api/search";
import type { PropertyDefinition, MessageRefConfig } from "@/types/properties";

interface MessageRefPickerProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /** The channel the message belongs to — used when scope === 'same_channel' */
  channelId?: string;
  /** The message being edited — excluded from search suggestions */
  currentMessageId?: string;
}

export function MessageRefPicker({
  definition,
  value,
  onChange,
  disabled,
  channelId,
  currentMessageId,
}: MessageRefPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [rawResults, setRawResults] = useState<MessageSearchResultData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedPreviews, setSelectedPreviews] = useState<
    Record<string, string>
  >({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cfg = useMemo(
    () => (definition.config ?? {}) as Partial<MessageRefConfig>,
    [definition.config],
  );
  const cardinality = cfg.cardinality ?? "single";
  const scopeChannelId =
    cfg.scope === "same_channel"
      ? (channelId ?? definition.channelId)
      : undefined;

  // Normalise value: single → string, multi → string[]
  const selectedIds: string[] = useMemo(() => {
    if (cardinality === "single") {
      return typeof value === "string" && value ? [value] : [];
    }
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === "string");
    }
    return [];
  }, [cardinality, value]);

  // Filter out self from results
  const results = useMemo(
    () =>
      rawResults.filter(
        (m) => m.id !== currentMessageId && !selectedIds.includes(m.id),
      ),
    [rawResults, currentMessageId, selectedIds],
  );

  // Search messages with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim()) {
      setRawResults([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchApi.searchMessages(searchQuery, {
          limit: 10,
          channelId: scopeChannelId,
        });
        setRawResults(searchResults.items.map((item) => item.data));
        setShowDropdown(true);
      } catch {
        setRawResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, scopeChannelId]);

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

  const getPreview = useCallback((msg: MessageSearchResultData) => {
    return msg.content.replace(/<[^>]+>/g, "").slice(0, 60) || "Message";
  }, []);

  const handleSelect = useCallback(
    (msg: MessageSearchResultData) => {
      const preview = getPreview(msg);
      if (cardinality === "single") {
        onChange(msg.id);
        setSelectedPreviews({ [msg.id]: preview });
        setSearchQuery("");
        setShowDropdown(false);
      } else {
        const next = [...selectedIds, msg.id];
        onChange(next);
        setSelectedPreviews((prev) => ({ ...prev, [msg.id]: preview }));
        setSearchQuery("");
        // Keep dropdown open for multi-select; re-trigger with same query
        setShowDropdown(false);
      }
    },
    [cardinality, onChange, selectedIds, getPreview],
  );

  const handleRemove = useCallback(
    (id: string) => {
      if (cardinality === "single") {
        onChange(null);
        setSelectedPreviews({});
      } else {
        const next = selectedIds.filter((v) => v !== id);
        onChange(next.length > 0 ? next : null);
        setSelectedPreviews((prev) => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      }
    },
    [cardinality, onChange, selectedIds],
  );

  // Render selected chips for multi; single value display for single
  const renderSelected = () => {
    if (selectedIds.length === 0) return null;

    if (cardinality === "single") {
      const id = selectedIds[0];
      return (
        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {selectedPreviews[id] ?? id}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={() => handleRemove(id)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      );
    }

    // Multi: chips + search input below
    return (
      <div className="flex flex-wrap gap-1.5 pb-1.5">
        {selectedIds.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-muted px-2 py-0.5 text-xs"
          >
            <MessageSquare className="h-3 w-3 text-muted-foreground" />
            <span className="max-w-[120px] truncate">
              {selectedPreviews[id] ?? id}
            </span>
            {!disabled && (
              <button
                type="button"
                onClick={() => handleRemove(id)}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
    );
  };

  const showSearchInput = cardinality === "multi" || selectedIds.length === 0;

  return (
    <div className="relative" ref={dropdownRef}>
      {renderSelected()}

      {showSearchInput && (
        <div className="flex items-center gap-1.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            role="combobox"
            aria-expanded={showDropdown}
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
            // Disable self (belt-and-suspenders in case filter races)
            const isSelf = msg.id === currentMessageId;
            return (
              <button
                key={msg.id}
                disabled={isSelf}
                className="w-full px-3 py-2 text-left hover:bg-muted transition-colors border-b border-border last:border-0 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => !isSelf && handleSelect(msg)}
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
