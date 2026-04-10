import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OnlineStatusDot } from "@/components/ui/online-status-dot";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useSearchUsers } from "@/hooks/useIMUsers";
import { useCreateDirectChannel } from "@/hooks/useChannels";
import type { IMUser } from "@/types/im";

interface NewMessageDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewMessageDialog({ isOpen, onClose }: NewMessageDialogProps) {
  const { t } = useTranslation("message");
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const { data: users = [], isLoading } = useSearchUsers(
    searchQuery,
    searchQuery.length > 0,
  );
  const createDirectChannel = useCreateDirectChannel();

  const handleSelectUser = async (user: IMUser) => {
    try {
      const channel = await createDirectChannel.mutateAsync(user.id);
      onClose();
      setSearchQuery("");
      // Navigate to the new channel
      navigate({
        to: "/channels/$channelId",
        params: { channelId: channel.id },
      });
    } catch (error) {
      console.error("Failed to create direct channel:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-foreground">
            {t("newMessage")}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X size={18} />
          </Button>
        </div>

        {/* Search */}
        <div className="p-4 border-b">
          <div className="relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              placeholder={t("searchUsers")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>
        </div>

        {/* User List */}
        <ScrollArea className="max-h-96">
          <div className="p-2">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("searching")}
              </div>
            ) : searchQuery.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("enterToSearch")}
              </div>
            ) : users.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("noUsersFound")}
              </div>
            ) : (
              <div className="space-y-1">
                {users.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    disabled={createDirectChannel.isPending}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-left disabled:opacity-50"
                  >
                    <UserAvatar
                      userId={user.id}
                      name={user.displayName || user.username}
                      username={user.username}
                      avatarUrl={user.avatarUrl}
                      isBot={user.userType === "bot"}
                      className="w-10 h-10"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">
                        {user.displayName || user.username}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        @{user.username}
                      </p>
                    </div>
                    <OnlineStatusDot userId={user.id} className="w-2 h-2" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="p-4 border-t bg-muted rounded-b-lg">
          <p className="text-xs text-muted-foreground text-center">
            {t("selectUserToChat")}
          </p>
        </div>
      </div>
    </div>
  );
}
