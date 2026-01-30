import { useNavigate } from "@tanstack/react-router";
import { Search, Hash, User, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useCreateDirectChannel } from "@/hooks/useChannels";
import type { QuickSearchResponse } from "@/hooks/useSearch";

interface QuickSearchResultsProps {
  data: QuickSearchResponse | undefined;
  isLoading: boolean;
  searchQuery: string;
  onSelect?: () => void;
  onDeepSearch?: () => void;
}

export function QuickSearchResults({
  data,
  isLoading,
  searchQuery,
  onSelect,
  onDeepSearch,
}: QuickSearchResultsProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const createDirectChannel = useCreateDirectChannel();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!searchQuery.trim()) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t("searchHint", "Type to search")}
      </div>
    );
  }

  const channels = data?.channels;
  const users = data?.users;
  const hasResults =
    (channels?.items.length ?? 0) > 0 || (users?.items.length ?? 0) > 0;

  // Navigate to channel
  const handleChannelClick = (channelId: string) => {
    navigate({
      to: "/channels/$channelId",
      params: { channelId },
    });
    onSelect?.();
  };

  // Create or get DM channel with user, then navigate
  const handleUserClick = async (userId: string) => {
    try {
      const channel = await createDirectChannel.mutateAsync(userId);
      navigate({
        to: "/messages/$channelId",
        params: { channelId: channel.id },
      });
      onSelect?.();
    } catch (error) {
      console.error("Failed to create direct channel:", error);
    }
  };

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      {/* Deep Search Entry - Always show at top when there's a query */}
      <button
        className="w-full px-3 py-2.5 text-left hover:bg-accent rounded-md transition-colors flex items-center gap-3 border-b mb-2"
        onClick={onDeepSearch}
      >
        <Search className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{searchQuery}</span>
        <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
          Enter
        </span>
      </button>

      {/* No results message */}
      {!hasResults && (
        <div className="py-4 text-center text-sm text-muted-foreground">
          {t("noQuickResults", "No channels or users found")}
        </div>
      )}

      {/* Channels Section */}
      {channels && channels.items.length > 0 && (
        <ResultSection
          title={t("channels", "Channels")}
          icon={<Hash className="h-4 w-4" />}
        >
          {channels.items.map((item) => (
            <button
              key={item.id}
              className="w-full px-3 py-2 text-left hover:bg-accent rounded-md transition-colors"
              onClick={() => handleChannelClick(item.data.id)}
            >
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <span
                  className="font-medium [&>mark]:bg-yellow-200 [&>mark]:text-yellow-900 dark:[&>mark]:bg-yellow-800 dark:[&>mark]:text-yellow-100"
                  dangerouslySetInnerHTML={{ __html: item.highlight }}
                />
                <span className="text-xs text-muted-foreground">
                  {item.data.memberCount}{" "}
                  {item.data.memberCount === 1 ? "member" : "members"}
                </span>
              </div>
              {item.data.description && (
                <div className="text-sm text-muted-foreground line-clamp-1 mt-1 pl-6">
                  {item.data.description}
                </div>
              )}
            </button>
          ))}
        </ResultSection>
      )}

      {/* Users Section */}
      {users && users.items.length > 0 && (
        <ResultSection
          title={t("users", "Users")}
          icon={<User className="h-4 w-4" />}
        >
          {users.items.map((item) => (
            <button
              key={item.id}
              className="w-full px-3 py-2 text-left hover:bg-accent rounded-md transition-colors disabled:opacity-50"
              onClick={() => handleUserClick(item.data.id)}
              disabled={createDirectChannel.isPending}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-2 w-2 rounded-full",
                    item.data.status === "online"
                      ? "bg-success"
                      : "bg-muted-foreground",
                  )}
                />
                <span
                  className="font-medium [&>mark]:bg-yellow-200 [&>mark]:text-yellow-900 dark:[&>mark]:bg-yellow-800 dark:[&>mark]:text-yellow-100"
                  dangerouslySetInnerHTML={{ __html: item.highlight }}
                />
                <span className="text-xs text-muted-foreground">
                  @{item.data.username}
                </span>
              </div>
            </button>
          ))}
        </ResultSection>
      )}
    </div>
  );
}

interface ResultSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function ResultSection({ title, icon, children }: ResultSectionProps) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
