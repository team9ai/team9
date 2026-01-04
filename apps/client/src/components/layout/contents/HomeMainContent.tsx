import {
  Home,
  MessageSquare,
  Hash,
  Lock,
  ChevronRight,
  Users,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useChannelsByType } from "@/hooks/useChannels";
import { useUserWorkspaces } from "@/hooks/useWorkspace";
import { useSelectedWorkspaceId } from "@/stores";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function HomeMainContent() {
  const workspaceId = useSelectedWorkspaceId();
  const { data: workspaces } = useUserWorkspaces();
  const { publicChannels, privateChannels, directChannels, isLoading } =
    useChannelsByType();

  const currentWorkspace = workspaces?.find((w) => w.id === workspaceId);

  // Get channels with unread messages
  const unreadChannels = [
    ...publicChannels,
    ...privateChannels,
    ...directChannels,
  ].filter((ch) => ch.unreadCount > 0);

  // Get recent direct messages (top 5)
  const recentDMs = directChannels.slice(0, 5);

  // Get all channels (top 5)
  const recentChannels = [...publicChannels, ...privateChannels].slice(0, 5);

  return (
    <main className="flex-1 flex flex-col bg-slate-50">
      {/* Header */}
      <header className="h-14 bg-white flex items-center justify-between px-6 border-b">
        <div className="flex items-center gap-2">
          <Home size={20} className="text-purple-600" />
          <h2 className="font-semibold text-lg text-slate-900">Home</h2>
        </div>
      </header>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 max-w-4xl mx-auto">
          {/* Welcome Section */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Welcome back
              {currentWorkspace ? ` to ${currentWorkspace.name}` : ""}!
            </h1>
            <p className="text-slate-600">
              Here's what's happening in your workspace.
            </p>
          </div>

          {/* Unread Messages Section */}
          {unreadChannels.length > 0 && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Bell size={18} className="text-purple-600" />
                  Catch up
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    {unreadChannels.reduce(
                      (acc, ch) => acc + (ch.unreadCount || 0),
                      0,
                    )}{" "}
                    unread
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-1">
                  {unreadChannels.slice(0, 5).map((channel) => (
                    <ChannelItem
                      key={channel.id}
                      channel={channel}
                      showUnread
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recent Channels */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Hash size={18} className="text-slate-600" />
                  Channels
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {isLoading ? (
                  <p className="text-sm text-slate-500 py-4">Loading...</p>
                ) : recentChannels.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-slate-500 mb-3">
                      No channels yet
                    </p>
                    <Button variant="outline" size="sm">
                      Browse Channels
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentChannels.map((channel) => (
                      <ChannelItem key={channel.id} channel={channel} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Direct Messages */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare size={18} className="text-slate-600" />
                  Direct Messages
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {isLoading ? (
                  <p className="text-sm text-slate-500 py-4">Loading...</p>
                ) : recentDMs.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-slate-500 mb-3">
                      No conversations yet
                    </p>
                    <Button variant="outline" size="sm">
                      Start a Conversation
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentDMs.map((channel) => (
                      <DMItem key={channel.id} channel={channel} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <QuickActionButton
                  icon={<Hash size={20} />}
                  label="Browse Channels"
                />
                <QuickActionButton
                  icon={<MessageSquare size={20} />}
                  label="New Message"
                />
                <QuickActionButton
                  icon={<Users size={20} />}
                  label="View Members"
                />
                <QuickActionButton
                  icon={<Bell size={20} />}
                  label="Notifications"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </main>
  );
}

// Channel list item
interface ChannelItemProps {
  channel: {
    id: string;
    name: string;
    type: string;
    unreadCount?: number;
    otherUser?: {
      id: string;
      displayName?: string;
      username?: string;
      avatarUrl?: string;
    };
  };
  showUnread?: boolean;
}

function ChannelItem({ channel, showUnread }: ChannelItemProps) {
  // For direct channels, show as DM
  if (channel.type === "direct") {
    return <DMItem channel={channel} showUnread={showUnread} />;
  }

  const Icon = channel.type === "private" ? Lock : Hash;

  return (
    <Link to="/channels/$channelId" params={{ channelId: channel.id }}>
      <div className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-slate-100 transition-colors cursor-pointer group">
        <Icon size={16} className="text-slate-500" />
        <span className="flex-1 text-sm text-slate-700 truncate">
          {channel.name}
        </span>
        {showUnread && channel.unreadCount && channel.unreadCount > 0 && (
          <span className="bg-purple-600 text-white text-xs rounded-full px-2 py-0.5 min-w-5 text-center">
            {channel.unreadCount}
          </span>
        )}
        <ChevronRight
          size={16}
          className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </div>
    </Link>
  );
}

// DM list item
interface DMItemProps {
  channel: {
    id: string;
    otherUser?: {
      id: string;
      displayName?: string;
      username?: string;
      avatarUrl?: string;
    };
    unreadCount?: number;
  };
  showUnread?: boolean;
}

function DMItem({ channel, showUnread }: DMItemProps) {
  const otherUser = channel.otherUser;
  const displayName =
    otherUser?.displayName || otherUser?.username || "Direct Message";
  const avatarText =
    otherUser?.displayName?.[0] || otherUser?.username?.[0] || "D";

  return (
    <Link to="/channels/$channelId" params={{ channelId: channel.id }}>
      <div className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-slate-100 transition-colors cursor-pointer group">
        <Avatar className="w-6 h-6">
          {otherUser?.avatarUrl && (
            <AvatarImage src={otherUser.avatarUrl} alt={displayName} />
          )}
          <AvatarFallback className="bg-purple-500 text-white text-xs">
            {avatarText}
          </AvatarFallback>
        </Avatar>
        <span className="flex-1 text-sm text-slate-700 truncate">
          {displayName}
        </span>
        {showUnread && channel.unreadCount && channel.unreadCount > 0 && (
          <span className="bg-purple-600 text-white text-xs rounded-full px-2 py-0.5 min-w-5 text-center">
            {channel.unreadCount}
          </span>
        )}
        <ChevronRight
          size={16}
          className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </div>
    </Link>
  );
}

// Quick action button
interface QuickActionButtonProps {
  icon: React.ReactNode;
  label: string;
}

function QuickActionButton({ icon, label }: QuickActionButtonProps) {
  return (
    <button
      className={cn(
        "flex flex-col items-center gap-2 p-4 rounded-lg border border-slate-200",
        "hover:bg-purple-50 hover:border-purple-200 transition-colors",
        "text-slate-600 hover:text-purple-600",
      )}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
