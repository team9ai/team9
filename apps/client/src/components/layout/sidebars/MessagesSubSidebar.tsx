import { Search, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const directMessages = [
  { id: "dm-1", name: "Alice Johnson", avatar: "A", status: "online" },
  { id: "dm-2", name: "Bob Smith", avatar: "B", status: "online" },
  { id: "dm-3", name: "Carol White", avatar: "C", status: "offline" },
  { id: "dm-4", name: "David Brown", avatar: "D", status: "online" },
  { id: "dm-5", name: "Eve Davis", avatar: "E", status: "offline" },
];

export function MessagesSubSidebar() {
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
          {directMessages.map((dm) => (
            <Button
              key={dm.id}
              variant="ghost"
              className="w-full justify-start gap-2 px-2 h-auto py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white"
            >
              <div className="relative">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="bg-purple-400 text-white text-sm">
                    {dm.avatar}
                  </AvatarFallback>
                </Avatar>
                {dm.status === "online" && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#5b2c6f]" />
                )}
              </div>
              <span className="truncate">{dm.name}</span>
            </Button>
          ))}
        </nav>
      </ScrollArea>

      {/* Add Button */}
      <div className="p-3 border-t border-white/10">
        <Button
          variant="ghost"
          className="w-full justify-center gap-2 px-2 h-10 text-sm text-white/90 hover:bg-white/10 hover:text-white rounded-full border border-white/20"
        >
          <Plus size={18} />
          <span>新消息</span>
        </Button>
      </div>
    </aside>
  );
}
