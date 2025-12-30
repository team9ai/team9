import { MessageCircle } from "lucide-react";

export function MessagesMainContent() {
  return (
    <main className="flex-1 flex flex-col bg-white items-center justify-center">
      <div className="text-center max-w-md px-4">
        <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-4">
          <MessageCircle size={32} className="text-purple-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Select a conversation
        </h2>
        <p className="text-slate-600">
          Choose a direct message from the left sidebar, or click "New Message"
          to start a new conversation.
        </p>
      </div>
    </main>
  );
}
