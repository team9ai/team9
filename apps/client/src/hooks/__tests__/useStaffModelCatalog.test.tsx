import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getStaffModelCatalog = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({
  api: {
    applications: { getStaffModelCatalog },
  },
}));

import {
  staffModelCatalogVersionQueryKey,
  useStaffModelCatalog,
} from "../useStaffModelCatalog";

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

describe("useStaffModelCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes enabled models/default and caches the versioned ETag snapshot", async () => {
    const catalog = {
      catalogVersion: "2026-07-16.1",
      etag: '"2026-07-16.1"',
      runtimeReady: true,
      models: [
        {
          provider: "openrouter",
          id: "anthropic/claude-sonnet-4.6",
          displayKey: "staff-model.anthropic/claude-sonnet-4.6",
          label: "Claude Sonnet 4.6",
          family: "anthropic",
          enabled: true,
          capabilities: ["staff"],
          minimumResolverCapabilityVersion: "1.0.0",
          default: true,
        },
        {
          provider: "openrouter",
          id: "disabled/model",
          displayKey: "staff-model.disabled/model",
          label: "Disabled",
          family: "other",
          enabled: false,
          capabilities: ["staff"],
          minimumResolverCapabilityVersion: "1.0.0",
        },
      ],
    };
    getStaffModelCatalog.mockResolvedValue(catalog);
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(useStaffModelCatalog, { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.models).toHaveLength(1);
    expect(result.current.defaultModel?.id).toBe("anthropic/claude-sonnet-4.6");
    expect(result.current.canMutate).toBe(true);
    expect(
      queryClient.getQueryData(staffModelCatalogVersionQueryKey(catalog)),
    ).toEqual(catalog);
  });

  it("fails closed without a local model fallback when runtime is not ready", async () => {
    getStaffModelCatalog.mockResolvedValue({
      catalogVersion: "2026-07-16.1",
      runtimeReady: false,
      models: [],
    });
    const { wrapper } = setup();

    const { result } = renderHook(useStaffModelCatalog, { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.models).toEqual([]);
    expect(result.current.defaultModel).toBeNull();
    expect(result.current.canMutate).toBe(false);
  });

  it("fails closed when the catalog request errors", async () => {
    getStaffModelCatalog.mockRejectedValue(new Error("offline"));
    const { wrapper } = setup();

    const { result } = renderHook(useStaffModelCatalog, { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.models).toEqual([]);
    expect(result.current.defaultModel).toBeNull();
    expect(result.current.canMutate).toBe(false);
  });
});
