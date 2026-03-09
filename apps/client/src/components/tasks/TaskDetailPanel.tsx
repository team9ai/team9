import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { tasksApi } from "@/services/api/tasks";
import { TaskBasicInfoTab } from "./TaskBasicInfoTab";
import { TaskDocumentTab } from "./TaskDocumentTab";
import { TaskRunsTab } from "./TaskRunsTab";
import type { AgentTaskStatus } from "@/types/task";

const ACTIVE_STATUSES: AgentTaskStatus[] = [
  "in_progress",
  "pending_action",
  "paused",
];

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

  // Track whether we're viewing an active run (for showing message input)
  const [viewingActiveRun, setViewingActiveRun] = useState(false);

  // Show message input when task itself is active or viewing an active run
  const taskIsActive = task ? ACTIVE_STATUSES.includes(task.status) : false;
  const showMessageInput = taskIsActive || viewingActiveRun;

  // Message input state
  const [message, setMessage] = useState("");
  const sendMutation = useMutation({
    mutationFn: (content: string) => tasksApi.resume(taskId, content),
  });

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed, {
      onSuccess: () => setMessage(""),
    });
  }, [message, sendMutation, taskId]);

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
            <TabsTrigger value="document">{t("tabs.document")}</TabsTrigger>
            <TabsTrigger value="runs">{t("tabs.runs")}</TabsTrigger>
          </TabsList>
          <ScrollArea className="flex-1 min-h-0">
            <TabsContent value="info" className="p-4 mt-0">
              <TaskBasicInfoTab task={task} onClose={onClose} />
            </TabsContent>
            <TabsContent value="document" className="p-4 mt-0">
              <TaskDocumentTab task={task} />
            </TabsContent>
            <TabsContent value="runs" className="p-4 mt-0">
              <TaskRunsTab
                taskId={taskId}
                onViewingChannelChange={(ch) =>
                  setViewingActiveRun(ch !== null)
                }
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      )}

      {/* Message input for guiding the task */}
      {showMessageInput && (
        <div className="border-t shrink-0 p-3 flex gap-2 items-end">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("detail.messageInputPlaceholder")}
            rows={1}
            className="min-h-[36px] max-h-[120px] resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            size="icon-sm"
            onClick={handleSend}
            disabled={!message.trim() || sendMutation.isPending}
          >
            {sendMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
