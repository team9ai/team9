import { useState, useMemo } from "react";
import { ChevronDown, Search, X, Hash, Lock, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useChannels } from "@/hooks/useChannels";

interface SearchFilterInProps {
  selectedChannelIds: string[];
  onSelectionChange: (channelIds: string[]) => void;
}

export function SearchFilterIn({
  selectedChannelIds,
  onSelectionChange,
}: SearchFilterInProps) {
  const { t } = useTranslation("common");
  const [isOpen, setIsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");

  const { data: channels = [], isLoading } = useChannels();

  // Filter channels by search input
  const filteredChannels = useMemo(() => {
    if (!searchInput.trim()) return channels;
    const search = searchInput.toLowerCase();
    return channels.filter((channel) => {
      const name = channel.name?.toLowerCase() || "";
      return name.includes(search);
    });
  }, [channels, searchInput]);

  // Sort: selected first, then by type (public, private, direct)
  const sortedChannels = useMemo(() => {
    return [...filteredChannels].sort((a, b) => {
      const aIsSelected = selectedChannelIds.includes(a.id);
      const bIsSelected = selectedChannelIds.includes(b.id);

      if (aIsSelected && !bIsSelected) return -1;
      if (!aIsSelected && bIsSelected) return 1;

      // Sort by type: public first, then private, then direct
      const typeOrder = { public: 0, private: 1, direct: 2 };
      const aOrder = typeOrder[a.type as keyof typeof typeOrder] ?? 3;
      const bOrder = typeOrder[b.type as keyof typeof typeOrder] ?? 3;
      return aOrder - bOrder;
    });
  }, [filteredChannels, selectedChannelIds]);

  // Group channels by type for display
  const groupedChannels = useMemo(() => {
    const groups: {
      recent: typeof sortedChannels;
      suggestions: typeof sortedChannels;
    } = {
      recent: [],
      suggestions: [],
    };

    // Selected channels go to "recent"
    sortedChannels.forEach((channel) => {
      if (selectedChannelIds.includes(channel.id)) {
        groups.recent.push(channel);
      } else {
        groups.suggestions.push(channel);
      }
    });

    return groups;
  }, [sortedChannels, selectedChannelIds]);

  const handleToggleChannel = (channelId: string) => {
    if (selectedChannelIds.includes(channelId)) {
      onSelectionChange(selectedChannelIds.filter((id) => id !== channelId));
    } else {
      onSelectionChange([...selectedChannelIds, channelId]);
    }
  };

  const handleClear = () => {
    onSelectionChange([]);
    setIsOpen(false);
  };

  const hasSelection = selectedChannelIds.length > 0;

  const getChannelIcon = (type: string) => {
    switch (type) {
      case "private":
        return <Lock className="h-4 w-4" />;
      case "direct":
        return <User className="h-4 w-4" />;
      default:
        return <Hash className="h-4 w-4" />;
    }
  };

  const getChannelDisplayName = (channel: (typeof channels)[0]) => {
    if (channel.type === "direct") {
      // For DMs, show the other user's name
      return channel.name || t("directMessage", "Direct Message");
    }
    return channel.name;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-1",
            hasSelection && "bg-primary/10 border-primary",
          )}
        >
          In
          {hasSelection && (
            <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded">
              {selectedChannelIds.length}
            </span>
          )}
          <ChevronDown className="h-4 w-4 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {/* Search Input */}
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t(
                "searchChannelsPlaceholder",
                "e.g. #project-unicorn",
              )}
              className="pl-8 h-8"
            />
          </div>
        </div>

        {/* Clear Selection */}
        {hasSelection && (
          <button
            onClick={handleClear}
            className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent flex items-center gap-2 border-b"
          >
            <X className="h-4 w-4" />
            {t("clearSelection", "Clear selection")}
          </button>
        )}

        {/* Channels List */}
        <div className="max-h-64 overflow-y-auto py-1">
          {isLoading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t("loading", "Loading...")}
            </div>
          ) : sortedChannels.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t("noChannelsFound", "No channels found")}
            </div>
          ) : (
            <>
              {/* Recent (selected) channels */}
              {groupedChannels.recent.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                    {t("recent", "Recent")}
                  </div>
                  {groupedChannels.recent.map((channel) => (
                    <ChannelItem
                      key={channel.id}
                      channel={channel}
                      isSelected={true}
                      icon={getChannelIcon(channel.type)}
                      displayName={getChannelDisplayName(channel)}
                      onToggle={() => handleToggleChannel(channel.id)}
                    />
                  ))}
                </>
              )}

              {/* Suggestions */}
              {groupedChannels.suggestions.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                    {t("suggestions", "Suggestions")}
                  </div>
                  {groupedChannels.suggestions.map((channel) => (
                    <ChannelItem
                      key={channel.id}
                      channel={channel}
                      isSelected={false}
                      icon={getChannelIcon(channel.type)}
                      displayName={getChannelDisplayName(channel)}
                      onToggle={() => handleToggleChannel(channel.id)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ChannelItemProps {
  channel: { id: string; type: string };
  isSelected: boolean;
  icon: React.ReactNode;
  displayName: string | null;
  onToggle: () => void;
}

function ChannelItem({
  isSelected,
  icon,
  displayName,
  onToggle,
}: ChannelItemProps) {
  return (
    <button
      className={cn(
        "w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-3",
        isSelected && "bg-primary text-primary-foreground hover:bg-primary",
      )}
      onClick={onToggle}
    >
      <Checkbox
        checked={isSelected}
        className={cn(
          isSelected &&
            "border-primary-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary",
        )}
      />
      <span
        className={cn(
          "text-muted-foreground",
          isSelected && "text-primary-foreground/70",
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-sm">{displayName}</span>
    </button>
  );
}
