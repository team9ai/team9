import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { deepResearchApi, type Task } from "@/services/api/deep-research";

export interface NewTaskFormProps {
  onCreated?: (task: Task) => void;
}

export function NewTaskForm({ onCreated }: NewTaskFormProps) {
  const { t } = useTranslation("deepResearch");
  const [text, setText] = useState("");
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => deepResearchApi.createTask({ input: text }),
    onSuccess: (task) => {
      void qc.invalidateQueries({ queryKey: ["deep-research", "tasks"] });
      onCreated?.(task);
      setText("");
    },
  });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) m.mutate();
      }}
    >
      <textarea
        className="min-h-24 w-full rounded border p-2 text-sm"
        placeholder={t("promptPlaceholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-red-600">
          {m.isError ? (m.error as Error).message : ""}
        </span>
        <button
          type="submit"
          disabled={!text.trim() || m.isPending}
          className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {t("start")}
        </button>
      </div>
    </form>
  );
}
