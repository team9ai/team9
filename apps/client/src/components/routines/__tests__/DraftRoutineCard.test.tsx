import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Routine } from "@/types/routine";

const startCreationSession = vi.fn();
const deleteMutationFn = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("@/services/api", () => ({
  api: {
    routines: {
      startCreationSession: (...args: unknown[]) =>
        startCreationSession(...args),
      delete: (...args: unknown[]) => deleteMutationFn(...args),
    },
  },
}));

import { DraftRoutineCard } from "../DraftRoutineCard";

function renderCard(routineOverrides: Partial<Routine>, onOpen = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const routine = {
    id: "r-1",
    title: "Test Draft",
    status: "draft" as const,
    creationChannelId: null,
    ...routineOverrides,
  } as Routine;
  render(
    <QueryClientProvider client={qc}>
      <DraftRoutineCard routine={routine} onOpenCreationSession={onOpen} />
    </QueryClientProvider>,
  );
  return { onOpen };
}

describe("DraftRoutineCard", () => {
  beforeEach(() => {
    startCreationSession.mockReset();
    deleteMutationFn.mockReset();
  });

  it("with existing creationChannelId, clicking complete does NOT call API and opens session", async () => {
    const { onOpen } = renderCard({ creationChannelId: "ch-1" });

    const btn = screen.getByRole("button", { name: /draft\.completeCreation/ });
    fireEvent.click(btn);

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("r-1"));
    expect(startCreationSession).not.toHaveBeenCalled();
  });

  it("with null creationChannelId, clicking complete calls API then opens session", async () => {
    startCreationSession.mockResolvedValueOnce({
      creationChannelId: "new-ch",
      creationSessionId: "team9/t/a/dm/new-ch",
    });
    const { onOpen } = renderCard({ creationChannelId: null });

    const btn = screen.getByRole("button", { name: /draft\.completeCreation/ });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(startCreationSession).toHaveBeenCalledWith("r-1"),
    );
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("r-1"));
  });
});
