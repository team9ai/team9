import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ListChecks, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RoutinesSidebar } from "@/components/routines/RoutinesSidebar";
import { AgenticAgentPicker } from "@/components/routines/AgenticAgentPicker";
import { CreateRoutineDialog } from "@/components/routines/CreateRoutineDialog";

export const Route = createFileRoute("/_authenticated/routines/")({
  component: RoutinesPage,
});

function RoutinesPage() {
  const { t } = useTranslation("routines");
  const navigate = useNavigate();
  const [agenticPickerOpen, setAgenticPickerOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <div className="flex h-full">
      <RoutinesSidebar
        selectedRoutineId={null}
        selectedExecutionId={null}
        onRequestCreate={() => setAgenticPickerOpen(true)}
      />
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <ListChecks size={40} className="text-muted-foreground/30" />
        <div className="space-y-2 max-w-sm">
          <h3 className="text-base font-medium text-foreground">
            {t("emptyState.title")}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
            {t("emptyState.description")}
          </p>
        </div>
        <Button
          size="sm"
          className="mt-2"
          onClick={() => setAgenticPickerOpen(true)}
        >
          <Sparkles size={14} className="mr-1.5" />
          {t("emptyState.createWithAI")}
        </Button>
      </div>
      <CreateRoutineDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
      <AgenticAgentPicker
        open={agenticPickerOpen}
        onClose={() => setAgenticPickerOpen(false)}
        onManualCreate={() => {
          setAgenticPickerOpen(false);
          setShowCreateDialog(true);
        }}
        onOpenCreationSession={(id) =>
          void navigate({
            to: "/routines/$routineId/runs/$executionId",
            params: { routineId: id, executionId: "creation" },
          })
        }
      />
    </div>
  );
}
