import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { routinesApi } from "@/services/api/routines";
import type { RoutineIntervention } from "@/types/routine";

interface InterventionCardProps {
  intervention: RoutineIntervention;
  routineId: string;
}

export function InterventionCard({
  intervention,
  routineId,
}: InterventionCardProps) {
  const { t } = useTranslation("routines");
  const queryClient = useQueryClient();
  const [customMessage, setCustomMessage] = useState("");

  const resolveMutation = useMutation({
    mutationFn: (params: { action: string; message?: string }) =>
      routinesApi.resolveIntervention(routineId, intervention.id, {
        action: params.action,
        message: params.message,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routine", routineId] });
    },
  });

  const isPending = intervention.status === "pending";
  const isResolved = intervention.status === "resolved";

  const handleActionClick = (actionValue: string) => {
    resolveMutation.mutate({ action: actionValue });
  };

  const handleCustomSubmit = () => {
    if (!customMessage.trim()) return;
    resolveMutation.mutate({
      action: "custom_response",
      message: customMessage.trim(),
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3",
        isPending
          ? "border-orange-500/50 bg-orange-500/5"
          : "border-border bg-card",
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        {isPending && (
          <AlertCircle size={16} className="text-orange-500 shrink-0 mt-0.5" />
        )}
        <p className="text-sm">{intervention.prompt}</p>
      </div>

      {/* Status for resolved / expired */}
      {!isPending && (
        <div className="text-xs text-muted-foreground">
          {isResolved
            ? t("detail.interventionResolved")
            : t("detail.interventionExpired")}
          {intervention.response && (
            <span className="ml-1">
              — {intervention.response.action}
              {intervention.response.message &&
                `: ${intervention.response.message}`}
            </span>
          )}
        </div>
      )}

      {/* Action buttons (only for pending) */}
      {isPending && (
        <>
          {intervention.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {intervention.actions.map((action) => (
                <Button
                  key={action.value}
                  variant="outline"
                  size="sm"
                  disabled={resolveMutation.isPending}
                  onClick={() => handleActionClick(action.value)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}

          {/* Custom response input */}
          <div className="flex gap-2">
            <Input
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder={t("detail.interventionPlaceholder")}
              className="text-sm h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleCustomSubmit();
                }
              }}
              disabled={resolveMutation.isPending}
            />
            <Button
              variant="default"
              size="icon-sm"
              disabled={!customMessage.trim() || resolveMutation.isPending}
              onClick={handleCustomSubmit}
            >
              <Send size={14} />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
