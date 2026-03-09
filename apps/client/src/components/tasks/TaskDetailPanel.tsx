import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tasksApi } from "@/services/api/tasks";
import { MessageInput } from "@/components/channel/MessageInput";
import { useSendMessage } from "@/hooks/useMessages";
import type { AttachmentDto } from "@/types/im";
import { TaskBasicInfoTab } from "./TaskBasicInfoTab";
import { TaskTriggersTab } from "./TaskTriggersTab";
import { TaskDocumentTab } from "./TaskDocumentTab";
import { TaskRunsTab } from "./TaskRunsTab";

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, onClose }: TaskDetailPanelProps) {
  const { t } = useTranslation("tasks");

  // Fetch task detail (includes current execution with steps, interventions, deliverables)
  const {
    data: task,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => tasksApi.getById(taskId),
    refetchInterval: 5000, // Poll while panel is open
  });

  // Derive execution channel for message input
  const executionChannelId =
    task?.currentExecution?.execution?.channelId ?? undefined;

  // Send message to the task execution channel
  const sendMessage = useSendMessage(executionChannelId ?? "");
  const handleSendMessage = useCallback(
    async (content: string, attachments?: AttachmentDto[]) => {
      if (!executionChannelId) return;
      if (!content.trim() && (!attachments || attachments.length === 0)) return;
      await sendMessage.mutateAsync({ content, attachments });
    },
    [sendMessage, executionChannelId],
  );

  // TODO: TaskCast SSE integration
  // When @taskcast/react is available, subscribe to real-time step/status updates
  // via SSE instead of polling. For now, we use refetchInterval above.

  return (
    <div className="border-l bg-background flex flex-col h-full w-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold truncate">{t("detail.title")}</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">
            {t("detail.loadError")}
          </p>
        </div>
      )}

      {task && !isLoading && (
        <Tabs
          defaultValue="info"
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="mx-4 mt-2 shrink-0">
            <TabsTrigger value="info">{t("tabs.info")}</TabsTrigger>
            <TabsTrigger value="triggers">{t("tabs.triggers")}</TabsTrigger>
            <TabsTrigger value="document">{t("tabs.document")}</TabsTrigger>
            <TabsTrigger value="runs">{t("tabs.runs")}</TabsTrigger>
          </TabsList>
          <ScrollArea className="flex-1">
            <TabsContent value="info" className="p-4 mt-0">
              <TaskBasicInfoTab task={task} onClose={onClose} />
            </TabsContent>
            <TabsContent value="triggers" className="p-4 mt-0">
              <TaskTriggersTab taskId={taskId} />
            </TabsContent>
            <TabsContent value="document" className="p-4 mt-0">
              <TaskDocumentTab task={task} />
            </TabsContent>
            <TabsContent value="runs" className="p-4 mt-0">
              <TaskRunsTab taskId={taskId} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      )}

      {/* Message input for the task execution channel */}
      {executionChannelId && (
        <div className="border-t shrink-0">
          <MessageInput
            channelId={executionChannelId}
            onSend={handleSendMessage}
            disabled={sendMessage.isPending}
            compact
            placeholder={t("detail.messageInputPlaceholder")}
          />
        </div>
      )}
    </div>
  );
}
