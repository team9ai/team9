import { ChevronDown, Settings, HelpCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const moreItems = [
  { id: "settings", label: "Settings", icon: Settings },
  { id: "help", label: "Help", icon: HelpCircle },
  { id: "about", label: "About", icon: Info },
];

export function MoreSubSidebar() {
  return (
    <aside className="w-64 h-full overflow-hidden bg-[#5b2c6f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <Button
          variant="ghost"
          className="w-full justify-between text-white hover:bg-white/10 px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">More</span>
          <ChevronDown size={16} className="text-white/70" />
        </Button>
      </div>

      <Separator className="bg-white/10" />

      {/* More Items */}
      <ScrollArea className="flex-1 min-h-0 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {moreItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                variant="ghost"
                className="w-full justify-start gap-2 px-2 h-auto py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white"
              >
                <Icon size={16} />
                <span className="truncate">{item.label}</span>
              </Button>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
