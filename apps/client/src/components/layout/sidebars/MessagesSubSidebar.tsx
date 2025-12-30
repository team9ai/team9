import { Search, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useChannelsByType } from "@/hooks/useChannels";
import { useOnlineUsers } from "@/hooks/useIMUsers";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { NewMessageDialog } from "@/components/dialog/NewMessageDialog";

export function MessagesSubSidebar() {
  const { directChannels = [], isLoading } = useChannelsByType();
  const { data: onlineUsers = {} } = useOnlineUsers();
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);

  // Extract users from direct channels
  const directMessageUsers = directChannels.map((channel) => {
    return {
      id: channel.id,
      channelId: channel.id,
      name: channel.name || "Direct Message",
      avatar: channel.name?.[0]?.toUpperCase() || "D",
      unreadCount: channel.unreadCount || 0,
    };
  });

  return (
    <aside className="w-64 bg-[#5b2c6f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4">
        <Button
          variant="ghost"
          className="w-full justify-between text-white hover:bg-white/10 px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">Direct Messages</span>
          <ChevronDown size={16} className="text-white/70" />
        </Button>
      </div>

      {/* Search Bar */}
      <div className="px-3 pb-3">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-white/50 z-10"
          />
          <Input
            type="text"
            placeholder="Search messages..."
            className="pl-8 h-9 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:bg-white/15"
          />
        </div>
      </div>

      <Separator className="bg-white/10" />

      {/* Messages List */}
      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {isLoading ? (
            <p className="text-xs text-white/50 px-2 py-2">Loading...</p>
          ) : directMessageUsers.length === 0 ? (
            <p className="text-xs text-white/50 px-2 py-2">No messages</p>
          ) : (
            directMessageUsers.map((dm) => {
              const isOnline = dm.channelId in onlineUsers;
              return (
                <Link
                  key={dm.id}
                  to="/channels/$channelId"
                  params={{ channelId: dm.channelId }}
                >
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-2 px-2 h-auto py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white"
                  >
                    <div className="relative">
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-purple-400 text-white text-sm">
                          {dm.avatar}
                        </AvatarFallback>
                      </Avatar>
                      {isOnline && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#5b2c6f]" />
                      )}
                    </div>
                    <span className="truncate flex-1 text-left">{dm.name}</span>
                    {dm.unreadCount > 0 && (
                      <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-5 text-center">
                        {dm.unreadCount}
                      </span>
                    )}
                  </Button>
                </Link>
              );
            })
          )}
        </nav>
      </ScrollArea>

      {/* Add Button */}
      <div className="p-3 border-t border-white/10">
        <Button
          variant="ghost"
          onClick={() => setIsNewMessageOpen(true)}
          className="w-full justify-center gap-2 px-2 h-10 text-sm text-white/90 hover:bg-white/10 hover:text-white rounded-full border border-white/20"
        >
          <Plus size={18} />
          <span>New Message</span>
        </Button>
      </div>

      {/* New Message Dialog */}
      <NewMessageDialog
        isOpen={isNewMessageOpen}
        onClose={() => setIsNewMessageOpen(false)}
      />
    </aside>
  );
}
