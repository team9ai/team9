import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffView } from "./DiffView";
import { useSuggestionDetail, useReviewSuggestion } from "@/hooks/useDocuments";

interface SuggestionReviewProps {
  documentId: string;
  suggestionId: string;
  onBack?: () => void;
}

export function SuggestionReview({
  documentId,
  suggestionId,
  onBack,
}: SuggestionReviewProps) {
  const { data, isLoading, error } = useSuggestionDetail(
    documentId,
    suggestionId,
  );
  const reviewMutation = useReviewSuggestion(documentId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <AlertCircle size={24} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Failed to load suggestion
        </p>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft size={14} className="mr-1" />
            Back
          </Button>
        )}
      </div>
    );
  }

  const { suggestion, diff, isOutdated } = data;
  const isPending = suggestion.status === "pending";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onBack}
          >
            <ArrowLeft size={14} />
          </Button>
        )}
        <span className="text-sm font-medium text-foreground flex-1 truncate">
          {suggestion.summary || "Suggestion"}
        </span>
        <Badge
          variant={
            suggestion.status === "approved"
              ? "default"
              : suggestion.status === "rejected"
                ? "destructive"
                : "outline"
          }
          className="text-[10px]"
        >
          {suggestion.status}
        </Badge>
      </div>

      {/* Outdated warning */}
      {isOutdated && isPending && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20">
          <AlertTriangle
            size={12}
            className="text-yellow-600 dark:text-yellow-400 shrink-0"
          />
          <span className="text-xs text-yellow-700 dark:text-yellow-300">
            This suggestion was based on an older version. The document has been
            updated since.
          </span>
        </div>
      )}

      {/* Diff content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          <DiffView changes={diff} />
        </div>
      </ScrollArea>

      {/* Action buttons */}
      {isPending && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border shrink-0">
          <Button
            variant="outline"
            size="sm"
            disabled={reviewMutation.isPending}
            onClick={() =>
              reviewMutation.mutate({ sugId: suggestionId, action: "reject" })
            }
          >
            {reviewMutation.isPending ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <X size={14} className="mr-1" />
            )}
            Reject
          </Button>
          <Button
            size="sm"
            disabled={reviewMutation.isPending}
            onClick={() =>
              reviewMutation.mutate({ sugId: suggestionId, action: "approve" })
            }
          >
            {reviewMutation.isPending ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Check size={14} className="mr-1" />
            )}
            Approve
          </Button>
        </div>
      )}
    </div>
  );
}
