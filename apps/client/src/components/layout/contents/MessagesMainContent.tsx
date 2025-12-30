import { Phone, Video, Info, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";

export function MessagesMainContent() {
  return (
    <main className="flex-1 flex flex-col bg-white">
      {/* Content Header */}
      <header className="h-14 bg-white flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Avatar className="w-8 h-8">
            <AvatarFallback className="bg-purple-600 text-white text-sm">
              A
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="font-semibold text-base text-slate-900">
              Alice Johnson
            </h2>
            <p className="text-xs text-green-600">在线</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" className="hover:bg-purple-50">
            <Phone size={18} className="text-slate-600 hover:text-purple-600" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hover:bg-purple-50">
            <Video size={18} className="text-slate-600 hover:text-purple-600" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hover:bg-purple-50">
            <Search
              size={18}
              className="text-slate-600 hover:text-purple-600"
            />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hover:bg-purple-50">
            <Info size={18} className="text-slate-600 hover:text-purple-600" />
          </Button>
        </div>
      </header>

      <Separator />

      {/* Messages Area */}
      <ScrollArea className="flex-1 bg-slate-50">
        <div className="p-4">
          <div className="max-w-4xl">
            {/* Welcome to DM */}
            <Card className="mb-8 p-6 border-0 shadow-none bg-transparent">
              <Avatar className="w-16 h-16 mb-4">
                <AvatarFallback className="bg-purple-600 text-white text-2xl">
                  A
                </AvatarFallback>
              </Avatar>
              <h3 className="text-2xl font-bold mb-2 text-slate-900">
                Alice Johnson
              </h3>
              <p className="text-slate-600 text-sm">
                This is the beginning of your direct message history with Alice.
              </p>
            </Card>

            {/* Sample DM Messages */}
            <div className="space-y-4">
              <MessageItem
                author="Alice Johnson"
                timestamp="昨天 2:34 PM"
                avatar="A"
                message="Hi! How's the project coming along?"
              />
              <MessageItem
                author="You"
                timestamp="昨天 2:45 PM"
                avatar="Y"
                message="Going well! I should have the mockups ready by tomorrow."
                isCurrentUser
              />
              <MessageItem
                author="Alice Johnson"
                timestamp="今天 9:12 AM"
                avatar="A"
                message="That's great! Looking forward to seeing them."
              />
            </div>
          </div>
        </div>
      </ScrollArea>

      <Separator />

      {/* Message Input */}
      <div className="p-4 bg-white">
        <div className="max-w-4xl">
          <Card className="p-3 focus-within:border-purple-600 focus-within:ring-2 focus-within:ring-purple-100 transition-all">
            <Textarea
              placeholder="Message Alice Johnson"
              className="min-h-0 resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm p-0"
              rows={1}
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" className="h-7 w-7">
                  <span className="text-sm font-bold">B</span>
                </Button>
                <Button variant="ghost" size="icon-sm" className="h-7 w-7">
                  <span className="text-sm italic">I</span>
                </Button>
                <Button variant="ghost" size="icon-sm" className="h-7 w-7">
                  <span className="text-sm">≡</span>
                </Button>
              </div>
              <Button size="sm" className="bg-purple-600 hover:bg-purple-700">
                Send
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}

// Helper component for message items
interface MessageItemProps {
  author: string;
  timestamp: string;
  avatar: string;
  message: string;
  isCurrentUser?: boolean;
}

function MessageItem({
  author,
  timestamp,
  avatar,
  message,
  isCurrentUser = false,
}: MessageItemProps) {
  return (
    <div className="flex gap-3 hover:bg-white -mx-2 px-2 py-1.5 rounded transition-colors">
      <Avatar className="w-9 h-9 shrink-0">
        <AvatarFallback
          className={`${
            isCurrentUser
              ? "bg-slate-500"
              : "bg-linear-to-br from-purple-600 to-purple-700"
          } text-white font-medium text-sm shadow-sm`}
        >
          {avatar}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-sm text-slate-900">{author}</span>
          <span className="text-xs text-slate-500">{timestamp}</span>
        </div>
        <p className="text-sm text-slate-700">{message}</p>
      </div>
    </div>
  );
}
