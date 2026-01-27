import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, Hash, User, FileText, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { CombinedSearchResponse } from "@/hooks/useSearch";

interface SearchResultsProps {
  data: CombinedSearchResponse | undefined;
  isLoading: boolean;
  searchQuery: string;
  onSelect?: () => void;
}

export function SearchResults({
  data,
  isLoading,
  searchQuery,
  onSelect,
}: SearchResultsProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || searchQuery.length < 2) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t("searchHint", "Type at least 2 characters to search")}
      </div>
    );
  }

  const { messages, channels, users, files } = data;
  const hasResults =
    messages.items.length > 0 ||
    channels.items.length > 0 ||
    users.items.length > 0 ||
    files.items.length > 0;

  if (!hasResults) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t("noSearchResults", "No results found for")} "{searchQuery}"
      </div>
    );
  }

  const handleMessageClick = (channelId: string, messageId: string) => {
    navigate({
      to: "/im/$channelId",
      params: { channelId },
      search: { messageId },
    });
    onSelect?.();
  };

  const handleChannelClick = (channelId: string) => {
    navigate({
      to: "/im/$channelId",
      params: { channelId },
    });
    onSelect?.();
  };

  const handleUserClick = (userId: string) => {
    // Navigate to direct message with user
    navigate({
      to: "/im/user/$userId",
      params: { userId },
    });
    onSelect?.();
  };

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      {/* Messages Section */}
      {messages.items.length > 0 && (
        <ResultSection
          title={t("messages", "Messages")}
          icon={<MessageSquare className="h-4 w-4" />}
          count={messages.total}
        >
          {messages.items.map((item) => (
            <button
              key={item.id}
              className="w-full px-3 py-2 text-left hover:bg-accent rounded-md transition-colors"
              onClick={() =>
                handleMessageClick(item.data.channelId, item.data.id)
              }
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <span className="font-medium">
                  {item.data.senderDisplayName || item.data.senderUsername}
                </span>
                <span>in</span>
                <span className="font-medium">#{item.data.channelName}</span>
              </div>
              <div
                className="text-sm line-clamp-2"
                dangerouslySetInnerHTML={{ __html: item.highlight }}
              />
            </button>
          ))}
        </ResultSection>
      )}

      {/* Channels Section */}
      {channels.items.length > 0 && (
        <ResultSection
          title={t("channels", "Channels")}
          icon={<Hash className="h-4 w-4" />}
          count={channels.total}
        >
          {channels.items.map((item) => (
            <button
              key={item.id}
              className="w-full px-3 py-2 text-left hover:bg-accent rounded-md transition-colors"
              onClick={() => handleChannelClick(item.data.id)}
            >
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{item.data.name}</span>
                <span className="text-xs text-muted-foreground">
                  {item.data.memberCount} members
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
      {users.items.length > 0 && (
        <ResultSection
          title={t("users", "Users")}
          icon={<User className="h-4 w-4" />}
          count={users.total}
        >
          {users.items.map((item) => (
            <button
              key={item.id}
              className="w-full px-3 py-2 text-left hover:bg-accent rounded-md transition-colors"
              onClick={() => handleUserClick(item.data.id)}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-2 w-2 rounded-full",
                    item.data.status === "online"
                      ? "bg-green-500"
                      : "bg-gray-400",
                  )}
                />
                <span className="font-medium">
                  {item.data.displayName || item.data.username}
                </span>
                <span className="text-xs text-muted-foreground">
                  @{item.data.username}
                </span>
              </div>
            </button>
          ))}
        </ResultSection>
      )}

      {/* Files Section */}
      {files.items.length > 0 && (
        <ResultSection
          title={t("files", "Files")}
          icon={<FileText className="h-4 w-4" />}
          count={files.total}
        >
          {files.items.map((item) => (
            <button
              key={item.id}
              className="w-full px-3 py-2 text-left hover:bg-accent rounded-md transition-colors"
              onClick={() =>
                handleMessageClick(item.data.channelId, item.data.id)
              }
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium truncate">
                  {item.data.fileName}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1 pl-6">
                {t("uploadedBy", "Uploaded by")} {item.data.uploaderUsername} in
                #{item.data.channelName}
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
  count: number;
  children: React.ReactNode;
}

function ResultSection({ title, icon, count, children }: ResultSectionProps) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {icon}
        <span>{title}</span>
        <span className="ml-auto bg-muted px-1.5 py-0.5 rounded text-[10px]">
          {count}
        </span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
