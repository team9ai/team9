import { useState } from "react";
import { Loader2, MessageSquarePlus, Bot, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useDocumentSuggestions } from "@/hooks/useDocuments";
import type {
  DocumentIdentity,
  DocumentSuggestionStatus,
  SuggestionResponse,
} from "@/types/document";

interface SuggestionListProps {
  documentId: string;
  onSelectSuggestion?: (sugId: string) => void;
}

const STATUS_TABS: {
  label: string;
  value: DocumentSuggestionStatus | undefined;
}[] = [
  { label: "All", value: undefined },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

function statusBadgeVariant(status: DocumentSuggestionStatus) {
  switch (status) {
    case "pending":
      return "outline" as const;
    case "approved":
      return "default" as const;
    case "rejected":
      return "destructive" as const;
  }
}

function formatIdentity(identity: DocumentIdentity): string {
  if (identity.type === "bot") return "Bot";
  if (identity.type === "workspace") return "Workspace";
  return "User";
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString();
}

function SuggestionItem({
  suggestion,
  onClick,
}: {
  suggestion: SuggestionResponse;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 border-b border-border last:border-0 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {suggestion.suggestedBy.type === "bot" ? (
            <Bot size={12} className="shrink-0 text-primary" />
          ) : (
            <User size={12} className="shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground truncate">
            {formatIdentity(suggestion.suggestedBy)}
          </span>
        </div>
        <Badge
          variant={statusBadgeVariant(suggestion.status)}
          className="text-[10px] shrink-0"
        >
          {suggestion.status}
        </Badge>
      </div>
      {suggestion.summary && (
        <p className="text-sm text-foreground mt-1 truncate">
          {suggestion.summary}
        </p>
      )}
      {!suggestion.summary && (
        <p className="text-sm text-muted-foreground mt-1 italic">
          No description
        </p>
      )}
      <span className="text-[10px] text-muted-foreground/60 mt-1 block">
        {formatDate(suggestion.createdAt)}
      </span>
    </button>
  );
}

export function SuggestionList({
  documentId,
  onSelectSuggestion,
}: SuggestionListProps) {
  const [statusFilter, setStatusFilter] = useState<
    DocumentSuggestionStatus | undefined
  >(undefined);

  const { data: suggestions, isLoading } = useDocumentSuggestions(
    documentId,
    statusFilter,
  );

  return (
    <div className="flex flex-col h-full">
      {/* Status filter tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-border">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              "px-2 py-0.5 rounded text-xs font-medium transition-colors",
              statusFilter === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && !suggestions?.length && (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <MessageSquarePlus size={24} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No suggestions</p>
        </div>
      )}

      {!isLoading && suggestions && suggestions.length > 0 && (
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col">
            {suggestions.map((sug) => (
              <SuggestionItem
                key={sug.id}
                suggestion={sug}
                onClick={() => onSelectSuggestion?.(sug.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
