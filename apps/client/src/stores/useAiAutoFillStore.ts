import { create } from "zustand";
import { aiAutoFillApi } from "@/services/api/properties";

export type AiAutoFillStatus = "loading" | "error" | "info";

export interface AiAutoFillEntry {
  status: AiAutoFillStatus;
  message?: string;
  settledAt?: number;
  promise?: Promise<void>;
}

interface AiAutoFillState {
  entries: Map<string, AiAutoFillEntry>;
  getEntry: (messageId: string) => AiAutoFillEntry | undefined;
  run: (
    messageId: string,
    opts?: { fields?: string[]; preserveExisting?: boolean },
  ) => Promise<void>;
  dismiss: (messageId: string) => void;
}

function setEntry(
  state: AiAutoFillState,
  messageId: string,
  entry: AiAutoFillEntry | null,
): Partial<AiAutoFillState> {
  const next = new Map(state.entries);
  if (entry === null) {
    next.delete(messageId);
  } else {
    next.set(messageId, entry);
  }
  return { entries: next };
}

export const useAiAutoFillStore = create<AiAutoFillState>((set, get) => ({
  entries: new Map(),

  getEntry: (messageId) => get().entries.get(messageId),

  dismiss: (messageId) => {
    set((state) => setEntry(state, messageId, null));
  },

  run: (messageId, opts) => {
    const existing = get().entries.get(messageId);
    if (existing?.status === "loading" && existing.promise) {
      return existing.promise;
    }

    const promise = (async () => {
      try {
        const result = await aiAutoFillApi.autoFill(messageId, {
          fields: opts?.fields,
          preserveExisting: opts?.preserveExisting ?? true,
        });
        const filledCount = Object.keys(result.filled).length;
        set((state) =>
          setEntry(
            state,
            messageId,
            filledCount === 0
              ? {
                  status: "info",
                  message: "Nothing to fill",
                  settledAt: Date.now(),
                }
              : null,
          ),
        );
      } catch {
        set((state) =>
          setEntry(state, messageId, {
            status: "error",
            message: "AI failed",
            settledAt: Date.now(),
          }),
        );
      }
    })();

    set((state) => setEntry(state, messageId, { status: "loading", promise }));

    return promise;
  },
}));
