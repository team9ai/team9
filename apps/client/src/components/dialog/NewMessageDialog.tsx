import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSearchUsers } from "@/hooks/useIMUsers";
import { useCreateDirectChannel } from "@/hooks/useChannels";
import type { IMUser } from "@/types/im";

interface NewMessageDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewMessageDialog({ isOpen, onClose }: NewMessageDialogProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-slate-900">New Message</h2>
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
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              type="text"
              placeholder="Search by username or email..."
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
              <div className="py-8 text-center text-sm text-slate-500">
                Searching...
              </div>
            ) : searchQuery.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                Enter username or email to search
              </div>
            ) : users.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                No users found
              </div>
            ) : (
              <div className="space-y-1">
                {users.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    disabled={createDirectChannel.isPending}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors text-left disabled:opacity-50"
                  >
                    <Avatar className="w-10 h-10">
                      <AvatarFallback className="bg-linear-to-br from-purple-400 to-purple-600 text-white">
                        {(user.displayName || user.username)[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-slate-900 truncate">
                        {user.displayName || user.username}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        @{user.username}
                      </p>
                    </div>
                    {user.status === "online" && (
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="p-4 border-t bg-slate-50 rounded-b-lg">
          <p className="text-xs text-slate-500 text-center">
            Select a user to start a direct conversation
          </p>
        </div>
      </div>
    </div>
  );
}
