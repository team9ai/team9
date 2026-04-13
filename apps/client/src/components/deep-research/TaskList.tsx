import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { deepResearchApi, type Task } from "@/services/api/deep-research";
import { StatusBadge } from "./StatusBadge";

export interface TaskListProps {
  activeId?: string;
}

// Route /deep-research/$taskId will be registered in Task 13.
// Until then we need an escape hatch so the TS router doesn't reject the path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LinkAny = Link as React.ComponentType<any>;

export function TaskList({ activeId }: TaskListProps) {
  const { t } = useTranslation("deepResearch");
  const q = useInfiniteQuery({
    queryKey: ["deep-research", "tasks"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      deepResearchApi.listTasks({ limit: 20, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // Destructure stable query references so the dependency array is precise
  // and avoids triggering re-subscription on every render.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items: Task[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isLoading) {
    return <div className="p-4 text-sm text-zinc-500">…</div>;
  }
  if (items.length === 0) {
    return (
      <div className="p-4 text-sm text-zinc-500">{t("history.empty")}</div>
    );
  }
  return (
    <ul className="flex flex-col">
      {items.map((it) => (
        <li key={it.id}>
          <LinkAny
            to="/deep-research/$taskId"
            params={{ taskId: it.id }}
            className={`flex items-center justify-between px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
              activeId === it.id ? "bg-zinc-100 dark:bg-zinc-800" : ""
            }`}
          >
            <div className="min-w-0">
              <div className="truncate text-sm">{it.prompt ?? it.id}</div>
              <div className="text-xs text-zinc-500">
                {new Date(it.createdAt).toLocaleString()}
              </div>
            </div>
            <StatusBadge status={it.status} />
          </LinkAny>
        </li>
      ))}
      <div ref={sentinelRef} className="h-4" />
    </ul>
  );
}
