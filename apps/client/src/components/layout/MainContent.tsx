import { Hash, Star, Users, Phone, Info, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";

interface MainContentProps {
  activeSection: string;
}

export function MainContent({ activeSection }: MainContentProps) {
  return (
    <main className="flex-1 flex flex-col bg-white">
      {/* Content Header */}
      <header className="h-14 bg-white flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Hash size={18} className="text-indigo-600" />
          <h2 className="font-semibold text-lg text-slate-900">general</h2>
          <Button variant="ghost" size="icon-sm" className="hover:bg-slate-100">
            <Star size={16} className="text-slate-400 hover:text-amber-500" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" className="hover:bg-indigo-50">
            <Phone size={18} className="text-slate-600 hover:text-indigo-600" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hover:bg-indigo-50">
            <Users size={18} className="text-slate-600 hover:text-indigo-600" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hover:bg-indigo-50">
            <Search
              size={18}
              className="text-slate-600 hover:text-indigo-600"
            />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hover:bg-indigo-50">
            <Info size={18} className="text-slate-600 hover:text-indigo-600" />
          </Button>
        </div>
      </header>

      <Separator />

      {/* Messages Area */}
      <ScrollArea className="flex-1 bg-slate-50">
        <div className="p-4">
          <div className="max-w-4xl">
            {/* Welcome Message */}
            <Card className="mb-8 p-6 border-0 shadow-none bg-transparent">
              <Avatar className="w-16 h-16 mb-4">
                <AvatarFallback className="bg-linear-to-br from-indigo-600 to-blue-600 text-white shadow-lg">
                  <Hash size={32} />
                </AvatarFallback>
              </Avatar>
              <h3 className="text-2xl font-bold mb-2 text-slate-900">
                Welcome to #general
              </h3>
              <p className="text-slate-600 text-sm">
                This is the beginning of the #general channel. This channel is
                for team-wide communication and announcements.
              </p>
            </Card>

            {/* Sample Messages */}
            <div className="space-y-4">
              <MessageItem
                author="Alice Johnson"
                timestamp="9:42 AM"
                avatar="A"
                message="Hey team! Welcome to our new workspace 🎉"
              />
              <MessageItem
                author="Bob Smith"
                timestamp="9:45 AM"
                avatar="B"
                message="This looks great! Excited to get started."
              />
              <MessageItem
                author="Carol White"
                timestamp="10:03 AM"
                avatar="C"
                message="Let's make something amazing together!"
              />
            </div>
          </div>
        </div>
      </ScrollArea>

      <Separator />

      {/* Message Input */}
      <div className="p-4 bg-white">
        <div className="max-w-4xl">
          <Card className="p-3 focus-within:border-indigo-600 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
            <Textarea
              placeholder="Message #general"
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
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
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
}

function MessageItem({ author, timestamp, avatar, message }: MessageItemProps) {
  return (
    <div className="flex gap-3 hover:bg-white -mx-2 px-2 py-1.5 rounded transition-colors">
      <Avatar className="w-9 h-9 shrink-0">
        <AvatarFallback className="bg-linear-to-br from-indigo-600 to-blue-600 text-white font-medium text-sm shadow-sm">
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
