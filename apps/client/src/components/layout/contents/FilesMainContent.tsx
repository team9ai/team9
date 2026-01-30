import {
  Filter,
  Search,
  FileText,
  Image as ImageIcon,
  File,
  Download,
  MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";

const files = [
  {
    id: 1,
    name: "Project Proposal.pdf",
    type: "PDF",
    size: "2.4 MB",
    uploadedBy: "Alice Johnson",
    uploadedAt: "2h ago",
    icon: FileText,
  },
  {
    id: 2,
    name: "Design Mockup.fig",
    type: "Figma",
    size: "5.1 MB",
    uploadedBy: "Carol White",
    uploadedAt: "Yesterday",
    icon: ImageIcon,
  },
  {
    id: 3,
    name: "Meeting Notes.docx",
    type: "Word",
    size: "234 KB",
    uploadedBy: "Bob Smith",
    uploadedAt: "2d ago",
    icon: File,
  },
  {
    id: 4,
    name: "Team Photo.jpg",
    type: "Image",
    size: "1.8 MB",
    uploadedBy: "David Brown",
    uploadedAt: "3d ago",
    icon: ImageIcon,
  },
];

export function FilesMainContent() {
  return (
    <main className="flex-1 flex flex-col bg-background dark:bg-background">
      {/* Content Header */}
      <header className="h-14 bg-background dark:bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-lg text-foreground dark:text-foreground">
            Files
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" className="hover:bg-primary/5">
            <Filter
              size={18}
              className="text-muted-foreground hover:text-primary"
            />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hover:bg-primary/5">
            <Search
              size={18}
              className="text-muted-foreground hover:text-primary"
            />
          </Button>
        </div>
      </header>

      <Separator />

      {/* Files List */}
      <ScrollArea className="flex-1 bg-muted dark:bg-background">
        <div className="p-4">
          <div className="space-y-2">
            {files.map((file) => {
              const FileIcon = file.icon;
              return (
                <Card
                  key={file.id}
                  className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <FileIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm text-foreground dark:text-foreground truncate">
                        {file.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                          {file.size}
                        </span>
                        <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                          •
                        </span>
                        <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                          Uploaded by: {file.uploadedBy}
                        </span>
                        <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                          •
                        </span>
                        <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                          {file.uploadedAt}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:bg-primary/5"
                      >
                        <Download
                          size={16}
                          className="text-muted-foreground hover:text-primary"
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:bg-primary/5"
                      >
                        <MoreVertical
                          size={16}
                          className="text-muted-foreground hover:text-primary"
                        />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </main>
  );
}
