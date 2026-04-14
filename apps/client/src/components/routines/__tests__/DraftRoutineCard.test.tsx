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

function renderCard(
  routineOverrides: Partial<Routine>,
  onOpen = vi.fn(),
  onDeleted?: (id: string) => void,
) {
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
    // Drafts without a bot are tested separately; default to having one.
    botId: "bot-1",
    ...routineOverrides,
  } as Routine;
  const removeSpy = vi.spyOn(qc, "removeQueries");
  render(
    <QueryClientProvider client={qc}>
      <DraftRoutineCard
        routine={routine}
        onOpenCreationSession={onOpen}
        onDeleted={onDeleted}
      />
    </QueryClientProvider>,
  );
  return { onOpen, removeSpy };
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

  it("when startCreationSession rejects, does not call onOpen and leaves the button usable", async () => {
    startCreationSession.mockRejectedValueOnce(new Error("boom"));
    const { onOpen } = renderCard({ creationChannelId: null });

    const btn = screen.getByRole("button", {
      name: /draft\.completeCreation/,
    });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(startCreationSession).toHaveBeenCalledWith("r-1"),
    );
    // onOpen must not be called when the mutation rejects
    expect(onOpen).not.toHaveBeenCalled();
    // Button remains in the DOM and is not stuck in pending state after the
    // mutation settles — clicking it again should trigger another API call.
    await waitFor(() => {
      const btnAfter = screen.getByRole("button", {
        name: /draft\.completeCreation/,
      });
      expect((btnAfter as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("delete mutation success invokes onDeleted and removes routine detail query", async () => {
    deleteMutationFn.mockResolvedValueOnce({ success: true });
    const onDeleted = vi.fn();
    const { removeSpy } = renderCard(
      { creationChannelId: null },
      vi.fn(),
      onDeleted,
    );

    // Click delete once (arms confirmation), then click again to fire
    const deleteBtn = screen.getAllByRole("button").find((b) => {
      const svg = b.querySelector("svg");
      return svg?.classList.contains("lucide-trash-2");
    });
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);

    // Now the confirm button exists
    const confirmBtn = screen.getByRole("button", {
      name: /draft\.delete/,
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(deleteMutationFn).toHaveBeenCalled());
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("r-1"));
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ["routine", "r-1"] });
  });

  it("disables Complete Creation button when draft has no botId", () => {
    // Botless drafts (e.g. saved via CreateRoutineDialog with no agent
    // picked) would otherwise hit `Draft routine has no botId` on the
    // server. The button should be disabled up front so users can
    // reassign the bot instead of hitting a dead-end error.
    const onOpen = vi.fn();
    renderCard({ creationChannelId: null, botId: null }, onOpen);

    const btn = screen.getByRole("button", {
      name: /draft\.completeCreation/,
    });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
    expect(startCreationSession).not.toHaveBeenCalled();
  });
});
