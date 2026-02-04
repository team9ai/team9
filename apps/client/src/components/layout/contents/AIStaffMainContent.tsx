import { Bot } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";

export function AIStaffMainContent() {
  return (
    <main className="flex-1 flex flex-col bg-background">
      {/* Content Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">AI Staff</h2>
        </div>
      </header>

      <Separator />

      {/* Content */}
      <ScrollArea className="flex-1 bg-secondary/50">
        <div className="p-4">
          <Card className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
              <Bot size={32} className="text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2 text-foreground">
              AI Staff
            </h3>
            <p className="text-sm text-muted-foreground">
              Manage your AI assistants and create custom AI staff members.
            </p>
          </Card>
        </div>
      </ScrollArea>
    </main>
  );
}
