import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  MessageSquare,
  Hash,
  User,
  FileText,
  Loader2,
  Check,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { OnlineStatusDot } from "@/components/ui/online-status-dot";
import { useSearch } from "@/hooks/useSearch";
import { useCreateDirectChannel, useChannels } from "@/hooks/useChannels";
import { useWorkspaceMembers } from "@/hooks/useWorkspace";
import { useSelectedWorkspaceId } from "@/stores";
import { SearchFilterFrom } from "./SearchFilterFrom";
import { SearchFilterIn } from "./SearchFilterIn";
import type { SearchSearchParams } from "@/routes/_authenticated/search";

interface SearchPageProps {
  initialQuery?: string;
  initialType?: SearchSearchParams["type"];
}

type FilterType = "messages" | "channels" | "users" | "files";

const filterOptions: {
  value: FilterType;
  labelKey: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "messages",
    labelKey: "messages",
    icon: <MessageSquare className="h-4 w-4" />,
  },
  { value: "files", labelKey: "files", icon: <FileText className="h-4 w-4" /> },
  { value: "users", labelKey: "people", icon: <User className="h-4 w-4" /> },
  {
    value: "channels",
    labelKey: "channels",
    icon: <Hash className="h-4 w-4" />,
  },
];

export function SearchPage({
  initialQuery = "",
  initialType,
}: SearchPageProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const createDirectChannel = useCreateDirectChannel();
  const workspaceId = useSelectedWorkspaceId();

  const [query] = useState(initialQuery);
  const [activeFilter, setActiveFilter] = useState<FilterType>(
    (initialType as FilterType) || "messages",
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Filter states
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);

  // Get members and channels data for building filter query
  const { data: membersData } = useWorkspaceMembers(workspaceId ?? undefined, {
    limit: 100,
  });
  const { data: channelsData = [] } = useChannels();

  // Build the full query with filters
  const fullQuery = useMemo(() => {
    let q = query;

    // Add from: filters
    if (selectedUserIds.length > 0 && membersData?.pages) {
      const members = membersData.pages.flatMap((page) => page.members);
      selectedUserIds.forEach((userId) => {
        const member = members.find((m) => m.userId === userId);
        if (member?.username) {
          q += ` from:@${member.username}`;
        }
      });
    }

    // Add in: filters
    if (selectedChannelIds.length > 0) {
      selectedChannelIds.forEach((channelId) => {
        const channel = channelsData.find((c) => c.id === channelId);
        if (channel?.name) {
          q += ` in:#${channel.name}`;
        }
      });
    }

    return q.trim();
  }, [query, selectedUserIds, selectedChannelIds, membersData, channelsData]);

  const { data, isLoading } = useSearch(fullQuery, {
    enabled: fullQuery.trim().length > 0,
    limit: 50,
  });

  // Update URL when filter changes
  const handleFilterChange = useCallback(
    (filter: FilterType) => {
      setActiveFilter(filter);
      setIsFilterOpen(false);
      navigate({
        to: "/search",
        search: { q: query, type: filter },
        replace: true,
      });
    },
    [navigate, query],
  );

  // Navigation handlers
  const handleMessageClick = useCallback(
    (channelId: string, messageId: string) => {
      navigate({
        to: "/channels/$channelId",
        params: { channelId },
        search: { message: messageId },
      });
    },
    [navigate],
  );

  const handleChannelClick = useCallback(
    (channelId: string) => {
      navigate({
        to: "/channels/$channelId",
        params: { channelId },
      });
    },
    [navigate],
  );

  const handleUserClick = useCallback(
    async (userId: string) => {
      try {
        const channel = await createDirectChannel.mutateAsync(userId);
        navigate({
          to: "/messages/$channelId",
          params: { channelId: channel.id },
        });
      } catch (error) {
        console.error("Failed to create direct channel:", error);
      }
    },
    [createDirectChannel, navigate],
  );

  const handleFileClick = useCallback(
    (channelId: string) => {
      navigate({
        to: "/channels/$channelId",
        params: { channelId },
      });
    },
    [navigate],
  );

  // Calculate totals for filters
  const totals = {
    messages: data?.messages.total || 0,
    channels: data?.channels.total || 0,
    users: data?.users.total || 0,
    files: data?.files.total || 0,
  };

  // Get current filter option
  const currentFilterOption = filterOptions.find(
    (o) => o.value === activeFilter,
  );
  const currentTotal = totals[activeFilter];

  // Get results for current filter
  const getResults = () => {
    if (!data) return [];
    switch (activeFilter) {
      case "messages":
        return data.messages.items;
      case "channels":
        return data.channels.items;
      case "users":
        return data.users.items;
      case "files":
        return data.files.items;
    }
  };

  const results = getResults();

  if (!query) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">
          {t("enterSearchQuery", "Enter a search query")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <h1 className="text-xl font-semibold mb-4">
          {t("search", "Search")}:{" "}
          <span className="text-foreground">{query}</span>
        </h1>

        {/* Filter buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type filter dropdown */}
          <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                {currentFilterOption?.icon}
                {t(
                  currentFilterOption?.labelKey || "messages",
                  currentFilterOption?.labelKey || "Messages",
                )}
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0" align="start">
              <div className="py-1">
                {filterOptions.map((option) => (
                  <button
                    key={option.value}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors",
                      activeFilter === option.value &&
                        "bg-primary text-primary-foreground hover:bg-primary",
                    )}
                    onClick={() => handleFilterChange(option.value)}
                  >
                    <div className="flex items-center gap-2">
                      {activeFilter === option.value && (
                        <Check className="h-4 w-4" />
                      )}
                      {activeFilter !== option.value && (
                        <span className="w-4" />
                      )}
                      {option.icon}
                      <span>{t(option.labelKey, option.labelKey)}</span>
                    </div>
                    <span
                      className={cn(
                        "text-xs",
                        activeFilter === option.value
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground",
                      )}
                    >
                      {totals[option.value]}
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* From filter - only show for messages and files */}
          {(activeFilter === "messages" || activeFilter === "files") && (
            <SearchFilterFrom
              selectedUserIds={selectedUserIds}
              onSelectionChange={setSelectedUserIds}
            />
          )}

          {/* In filter - only show for messages and files */}
          {(activeFilter === "messages" || activeFilter === "files") && (
            <SearchFilterIn
              selectedChannelIds={selectedChannelIds}
              onSelectionChange={setSelectedChannelIds}
            />
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <h2 className="text-lg font-semibold mb-2">
              {t("noSearchResults", "No results found")}
            </h2>
            <p className="text-muted-foreground max-w-md">
              {t(
                "noSearchResultsHint",
                "Try using different keywords, check for typos, or adjust filters.",
              )}
            </p>
          </div>
        ) : (
          <div className="px-6 py-4">
            <p className="text-sm text-muted-foreground mb-4">
              {currentTotal}{" "}
              {currentTotal === 1
                ? t("result", "result")
                : t("results", "results")}
            </p>

            <div className="space-y-2">
              {/* Messages */}
              {activeFilter === "messages" &&
                data?.messages.items.map((item) => (
                  <button
                    key={item.id}
                    className="w-full p-4 text-left bg-card hover:bg-accent rounded-lg border transition-colors"
                    onClick={() =>
                      handleMessageClick(item.data.channelId, item.data.id)
                    }
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium shrink-0">
                        {(item.data.senderDisplayName ||
                          item.data.senderUsername)?.[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <span className="font-semibold">
                            {item.data.senderDisplayName ||
                              item.data.senderUsername}
                          </span>
                          <span className="text-muted-foreground">
                            #{item.data.channelName}
                          </span>
                          <span className="text-muted-foreground ml-auto text-xs">
                            {new Date(item.data.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div
                          className="mt-1 text-sm line-clamp-2 [&>mark]:bg-yellow-200 [&>mark]:text-yellow-900 dark:[&>mark]:bg-yellow-800 dark:[&>mark]:text-yellow-100"
                          dangerouslySetInnerHTML={{ __html: item.highlight }}
                        />
                        {item.data.hasAttachment && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                            <FileText className="h-3 w-3" />
                            {t("hasAttachment", "Has attachment")}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}

              {/* Channels */}
              {activeFilter === "channels" &&
                data?.channels.items.map((item) => (
                  <button
                    key={item.id}
                    className="w-full p-4 text-left bg-card hover:bg-accent rounded-lg border transition-colors"
                    onClick={() => handleChannelClick(item.data.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Hash className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="font-semibold [&>mark]:bg-yellow-200 [&>mark]:text-yellow-900 dark:[&>mark]:bg-yellow-800 dark:[&>mark]:text-yellow-100"
                            dangerouslySetInnerHTML={{ __html: item.highlight }}
                          />
                          <span className="text-xs text-muted-foreground">
                            {item.data.memberCount}{" "}
                            {item.data.memberCount === 1 ? "member" : "members"}
                          </span>
                        </div>
                        {item.data.description && (
                          <p className="mt-1 text-sm text-muted-foreground line-clamp-1">
                            {item.data.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}

              {/* Users */}
              {activeFilter === "users" &&
                data?.users.items.map((item) => (
                  <button
                    key={item.id}
                    className="w-full p-4 text-left bg-card hover:bg-accent rounded-lg border transition-colors disabled:opacity-50"
                    onClick={() => handleUserClick(item.data.id)}
                    disabled={createDirectChannel.isPending}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                          {(item.data.displayName ||
                            item.data.username)?.[0]?.toUpperCase() || "?"}
                        </div>
                        <OnlineStatusDot
                          userId={item.data.id}
                          showOffline
                          className="absolute bottom-0 right-0 h-3 w-3 border-2 border-background"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="font-semibold [&>mark]:bg-yellow-200 [&>mark]:text-yellow-900 dark:[&>mark]:bg-yellow-800 dark:[&>mark]:text-yellow-100"
                            dangerouslySetInnerHTML={{ __html: item.highlight }}
                          />
                          <span className="text-sm text-muted-foreground">
                            @{item.data.username}
                          </span>
                        </div>
                        {item.data.email && (
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {item.data.email}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}

              {/* Files */}
              {activeFilter === "files" &&
                data?.files.items.map((item) => (
                  <button
                    key={item.id}
                    className="w-full p-4 text-left bg-card hover:bg-accent rounded-lg border transition-colors"
                    onClick={() => handleFileClick(item.data.channelId)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className="font-semibold truncate [&>mark]:bg-yellow-200 [&>mark]:text-yellow-900 dark:[&>mark]:bg-yellow-800 dark:[&>mark]:text-yellow-100"
                          dangerouslySetInnerHTML={{ __html: item.highlight }}
                        />
                        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                          <span>
                            {t("uploadedBy", "Uploaded by")}{" "}
                            {item.data.uploaderUsername}
                          </span>
                          <span>#{item.data.channelName}</span>
                          <span className="ml-auto text-xs">
                            {new Date(item.data.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
