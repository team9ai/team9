import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  SafeSessionComponentItem,
  SafeSessionComponentsResponse,
} from "@/types/im";

type TodoStatus = "pending" | "in_progress" | "completed";

export interface SessionTodoItem {
  id?: string;
  content: string;
  activeForm?: string;
  status: TodoStatus;
}

const statusLabel: Record<TodoStatus, string> = {
  pending: "未完成",
  in_progress: "正在进行",
  completed: "完成",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return (
    value === "pending" || value === "in_progress" || value === "completed"
  );
}

function findTodoComponent(
  components: SafeSessionComponentsResponse | undefined,
): SafeSessionComponentItem | undefined {
  const rows = components?.components ?? [];
  return (
    rows.find(
      (component) => parseTodos(component.latestData?.data).length > 0,
    ) ??
    rows.find(
      (component) => component.id === "todo" || component.typeKey === "todo",
    )
  );
}

function parseTodos(data: unknown): SessionTodoItem[] {
  if (!isRecord(data) || !Array.isArray(data.todos)) return [];

  return data.todos
    .map((item): SessionTodoItem | null => {
      if (!isRecord(item)) return null;
      const content = item.content;
      const activeForm = item.activeForm;
      if (typeof content !== "string" || !isTodoStatus(item.status)) {
        return null;
      }
      return {
        id: typeof item.id === "string" ? item.id : undefined,
        content,
        activeForm: typeof activeForm === "string" ? activeForm : undefined,
        status: item.status,
      };
    })
    .filter((item): item is SessionTodoItem => item !== null);
}

export function getSessionTodos(
  components: SafeSessionComponentsResponse | undefined,
): SessionTodoItem[] {
  return parseTodos(findTodoComponent(components)?.latestData?.data);
}

function TodoStatusIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") {
    return <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />;
  }
  if (status === "in_progress") {
    return <Loader2 className="mt-0.5 size-4 animate-spin text-amber-600" />;
  }
  return <Circle className="mt-0.5 size-4 text-muted-foreground" />;
}

export function SessionTodoSection({
  components,
}: {
  components: SafeSessionComponentsResponse | undefined;
}) {
  const todos = getSessionTodos(components);
  if (todos.length === 0) return null;

  return (
    <section className="border-b border-border px-3 py-3">
      <div className="mb-2 text-sm font-semibold">TODO</div>
      <div className="space-y-2">
        {todos.map((todo, index) => (
          <div
            key={todo.id ?? `${todo.content}-${index}`}
            className="flex min-w-0 gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2"
          >
            <TodoStatusIcon status={todo.status} />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "break-words text-sm leading-5",
                  todo.status === "completed" &&
                    "text-muted-foreground line-through",
                )}
              >
                {todo.content}
              </div>
              {todo.activeForm && todo.activeForm !== todo.content && (
                <div className="mt-0.5 break-words text-xs text-muted-foreground">
                  {todo.activeForm}
                </div>
              )}
            </div>
            <Badge
              variant={todo.status === "completed" ? "secondary" : "outline"}
              className="shrink-0"
            >
              {statusLabel[todo.status]}
            </Badge>
          </div>
        ))}
      </div>
    </section>
  );
}
