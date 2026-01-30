import { ChevronDown, FileText, Image, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const fileCategories = [
  { id: "all-files", label: "All files", icon: FileText },
  { id: "images", label: "Images", icon: Image },
  { id: "documents", label: "Documents", icon: File },
];

export function FilesSubSidebar() {
  return (
    <aside className="w-64 h-full overflow-hidden bg-nav-sub-bg text-primary-foreground flex flex-col">
      {/* Header */}
      <div className="p-4 pb-2">
        <Button
          variant="ghost"
          className="w-full justify-between text-nav-foreground hover:bg-nav-hover px-2 h-auto py-1.5"
        >
          <span className="font-semibold text-lg">Files</span>
          <ChevronDown size={16} className="text-nav-foreground-subtle" />
        </Button>
      </div>

      <Separator className="bg-nav-border" />

      {/* File Categories */}
      <ScrollArea className="flex-1 min-h-0 px-3">
        <nav className="space-y-0.5 pb-3 pt-2">
          {fileCategories.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                variant="ghost"
                className="w-full justify-start gap-2 px-2 h-auto py-2 text-sm text-nav-foreground-muted hover:bg-nav-hover hover:text-nav-foreground"
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
