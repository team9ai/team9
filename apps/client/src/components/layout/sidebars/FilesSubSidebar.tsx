import { Search, ChevronDown, FileText, Image, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const fileCategories = [
  { id: "all-files", label: "All files", icon: FileText },
  { id: "images", label: "Images", icon: Image },
  { id: "documents", label: "Documents", icon: File },
];

export function FilesSubSidebar() {
  return (
    <aside className="w-64 h-full overflow-hidden bg-[#5b2c6f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4">
        <Button
          variant="ghost"
          className="w-full justify-between text-white hover:bg-white/10 px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">Files</span>
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
            placeholder="Search files..."
            className="pl-8 h-9 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:bg-white/15"
          />
        </div>
      </div>

      <Separator className="bg-white/10" />

      {/* File Categories */}
      <ScrollArea className="flex-1 min-h-0 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {fileCategories.map((item) => {
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
