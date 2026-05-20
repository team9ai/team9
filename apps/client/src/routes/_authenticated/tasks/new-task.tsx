import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { tasksApi } from "@/services/api/tasks";

export const Route = createFileRoute("/_authenticated/tasks/new-task")({
  component: TaskNewTaskPage,
});

function deriveTaskTitle(title: string, description: string) {
  const explicitTitle = title.trim();
  if (explicitTitle) return explicitTitle;

  return (
    description
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 80) || "新任务"
  );
}

function TaskNewTaskPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createTask = useMutation({
    mutationFn: () =>
      tasksApi.create({
        title: deriveTaskTitle(title, description),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void navigate({
        to: "/tasks/$taskId",
        params: { taskId: task.id },
      });
    },
    onError: () => {
      setError("创建失败，请稍后重试。");
    },
  });

  const close = () => {
    void navigate({ to: "/tasks" });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    createTask.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>创建新任务</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="任务标题"
            maxLength={500}
            aria-label="任务标题"
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="描述任务目标、对象、约束和交付物"
            rows={5}
            aria-label="任务描述"
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              取消
            </Button>
            <Button type="submit" disabled={createTask.isPending}>
              {createTask.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
