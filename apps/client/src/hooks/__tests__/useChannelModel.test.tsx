import { createElement } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateChannelModel = vi.hoisted(() => vi.fn());
const getAttempt = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({
  api: {
    im: {
      channels: {
        getChannelModel: vi.fn(),
        updateChannelModel,
      },
      modelChanges: { getAttempt },
    },
  },
}));
vi.mock("@/services/websocket", () => ({
  default: {
    onChannelModelChanged: vi.fn(),
    off: vi.fn(),
  },
}));
vi.mock("@/services/auth-session", () => ({
  getValidAccessToken: vi.fn(),
}));

import { useChannelModel } from "../useChannelModel";
import { STAFF_MODEL_CATALOG_QUERY_KEY } from "../useStaffModelCatalog";

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(
    () => useChannelModel("channel-1", { enabled: false }),
    { wrapper },
  );
  return { ...hook, queryClient };
}

describe("useChannelModel durable mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the mutation pending until a 202 attempt is dispatched", async () => {
    updateChannelModel.mockResolvedValue({
      state: "pending",
      attemptId: "attempt-1",
      idempotencyKey: "request-1",
      statusUrl: "/api/v1/model-changes/attempt-1",
    });
    getAttempt
      .mockResolvedValueOnce({
        attemptId: "attempt-1",
        state: "pending",
      })
      .mockResolvedValueOnce({
        attemptId: "attempt-1",
        state: "dispatched",
      });
    const { result } = setup();
    const model = {
      provider: "openrouter",
      id: "anthropic/claude-sonnet-4.6",
    };

    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.updateModel(model);
    });
    await waitFor(() => expect(getAttempt).toHaveBeenCalledTimes(1));
    expect(result.current.isUpdating).toBe(true);

    await act(async () => mutation);

    expect(getAttempt).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(result.current.isUpdating).toBe(false);
      expect(result.current.data).toEqual({
        model,
        source: "dynamic",
        override: model,
      });
    });
  });

  it("invalidates the server catalog after unsupported_model", async () => {
    const error = {
      response: { data: { code: "unsupported_model" } },
    };
    updateChannelModel.mockRejectedValue(error);
    const { result, queryClient } = setup();
    queryClient.setQueryData(STAFF_MODEL_CATALOG_QUERY_KEY, {
      catalogVersion: "old",
    });

    await act(async () => {
      await expect(
        result.current.updateModel({
          provider: "openrouter",
          id: "removed/model",
        }),
      ).rejects.toBe(error);
    });

    expect(
      queryClient.getQueryState(STAFF_MODEL_CATALOG_QUERY_KEY)?.isInvalidated,
    ).toBe(true);
  });
});
