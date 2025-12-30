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
    <main className="flex-1 flex flex-col bg-white">
      {/* Content Header */}
      <header className="h-14 bg-white flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-lg text-slate-900">Files</h2>
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

      {/* Files List */}
      <ScrollArea className="flex-1 bg-slate-50">
        <div className="p-4">
          <div className="max-w-4xl space-y-2">
            {files.map((file) => {
              const FileIcon = file.icon;
              return (
                <Card
                  key={file.id}
                  className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                      <FileIcon className="w-6 h-6 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm text-slate-900 truncate">
                        {file.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-slate-500">
                          {file.size}
                        </span>
                        <span className="text-xs text-slate-400">•</span>
                        <span className="text-xs text-slate-500">
                          Uploaded by: {file.uploadedBy}
                        </span>
                        <span className="text-xs text-slate-400">•</span>
                        <span className="text-xs text-slate-500">
                          {file.uploadedAt}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:bg-purple-50"
                      >
                        <Download
                          size={16}
                          className="text-slate-600 hover:text-purple-600"
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:bg-purple-50"
                      >
                        <MoreVertical
                          size={16}
                          className="text-slate-600 hover:text-purple-600"
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
