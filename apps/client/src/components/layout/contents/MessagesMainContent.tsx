import { MessageCircle } from "lucide-react";

export function MessagesMainContent() {
  return (
    <main className="flex-1 flex flex-col bg-background items-center justify-center">
      <div className="text-center max-w-md px-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <MessageCircle size={32} className="text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Select a conversation
        </h2>
        <p className="text-muted-foreground">
          Choose a direct message from the left sidebar, or click "New Message"
          to start a new conversation.
        </p>
      </div>
    </main>
  );
}
