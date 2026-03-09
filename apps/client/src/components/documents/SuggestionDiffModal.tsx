import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSuggestionDetail, useReviewSuggestion } from "@/hooks/useDocuments";
import type { SuggestionResponse, DiffChange } from "@/types/document";
import { cn } from "@/lib/utils";

interface SuggestionDiffModalProps {
  documentId: string;
  suggestion: SuggestionResponse | null;
  onClose: () => void;
}

function DiffView({ changes }: { changes: DiffChange[] }) {
  return (
    <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono p-3 bg-muted/30 rounded-md overflow-auto max-h-[60vh]">
      {changes.map((change, i) => (
        <span
          key={i}
          className={cn(
            change.added &&
              "bg-green-500/20 text-green-700 dark:text-green-400",
            change.removed &&
              "bg-red-500/20 text-red-700 dark:text-red-400 line-through",
          )}
        >
          {change.value}
        </span>
      ))}
    </pre>
  );
}

export function SuggestionDiffModal({
  documentId,
  suggestion,
  onClose,
}: SuggestionDiffModalProps) {
  const { t } = useTranslation("tasks");

  const { data: detail, isLoading } = useSuggestionDetail(
    suggestion ? documentId : undefined,
    suggestion?.id,
  );

  const reviewMutation = useReviewSuggestion(documentId);

  const handleReview = async (action: "approve" | "reject") => {
    if (!suggestion) return;
    await reviewMutation.mutateAsync({ sugId: suggestion.id, action });
    onClose();
  };

  return (
    <Dialog open={!!suggestion} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">
            {suggestion?.summary || t("detail.document.suggestions.title")}
          </DialogTitle>
          {detail?.isOutdated && (
            <Badge
              variant="outline"
              className="w-fit text-amber-600 border-amber-300"
            >
              {t("detail.document.suggestions.outdated")}
            </Badge>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : detail ? (
            <DiffView changes={detail.diff} />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleReview("reject")}
            disabled={reviewMutation.isPending}
          >
            {t("detail.document.suggestions.reject")}
          </Button>
          <Button
            onClick={() => handleReview("approve")}
            disabled={reviewMutation.isPending}
          >
            {reviewMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : null}
            {t("detail.document.suggestions.approve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
