import { Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";

const activities = [
  {
    id: 1,
    type: "mention",
    user: "Alice Johnson",
    avatar: "A",
    channel: "#general",
    message: "@You Great work on the presentation!",
    time: "10m ago",
  },
  {
    id: 2,
    type: "reply",
    user: "Bob Smith",
    avatar: "B",
    channel: "#dev-team",
    message: "Replied to your thread about the API changes",
    time: "1h ago",
  },
  {
    id: 3,
    type: "mention",
    user: "Carol White",
    avatar: "C",
    channel: "#design",
    message: "@You Can you review the new mockups?",
    time: "2h ago",
  },
  {
    id: 4,
    type: "reaction",
    user: "David Brown",
    avatar: "D",
    channel: "#general",
    message: "Reacted to your message with 👍",
    time: "Yesterday",
  },
];

export function ActivityMainContent() {
  return (
    <main className="flex-1 flex flex-col bg-white dark:bg-background">
      {/* Content Header */}
      <header className="h-14 bg-white dark:bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-lg text-slate-900 dark:text-foreground">
            Activity
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" className="hover:bg-purple-50">
            <Filter
              size={18}
              className="text-slate-600 hover:text-purple-600"
            />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hover:bg-purple-50">
            <Search
              size={18}
              className="text-slate-600 hover:text-purple-600"
            />
          </Button>
        </div>
      </header>

      <Separator />

      {/* Activity Feed */}
      <ScrollArea className="flex-1 bg-slate-50 dark:bg-background">
        <div className="p-4">
          <div className="space-y-3">
            {activities.map((activity) => (
              <Card
                key={activity.id}
                className="p-4 hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex gap-3">
                  <Avatar className="w-10 h-10 shrink-0">
                    <AvatarFallback className="bg-purple-600 text-white font-medium">
                      {activity.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-semibold text-sm text-slate-900 dark:text-foreground">
                        {activity.user}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-muted-foreground">
                        {activity.channel}
                      </span>
                      <span className="text-xs text-slate-400 dark:text-muted-foreground ml-auto">
                        {activity.time}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-foreground/80">
                      {activity.message}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </ScrollArea>
    </main>
  );
}
