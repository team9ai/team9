import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEffectOncePerKey } from "../useEffectOncePerKey";

describe("useEffectOncePerKey", () => {
  it("runs once for the first enabled key and not again for the same key", () => {
    const effect = vi.fn();
    const { rerender } = renderHook(
      ({
        keyValue,
        enabled,
      }: {
        keyValue: string | null | undefined;
        enabled: boolean;
      }) => useEffectOncePerKey(keyValue, enabled, effect),
      {
        initialProps: {
          keyValue: "workspace-1",
          enabled: true,
        },
      },
    );

    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledWith("workspace-1");

    rerender({
      keyValue: "workspace-1",
      enabled: true,
    });

    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("runs again when the key changes", () => {
    const effect = vi.fn();
    const { rerender } = renderHook(
      ({
        keyValue,
        enabled,
      }: {
        keyValue: string | null | undefined;
        enabled: boolean;
      }) => useEffectOncePerKey(keyValue, enabled, effect),
      {
        initialProps: {
          keyValue: "workspace-1",
          enabled: true,
        },
      },
    );

    rerender({
      keyValue: "workspace-2",
      enabled: true,
    });

    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenNthCalledWith(2, "workspace-2");
  });

  it("resets after being disabled so the same key can run again", () => {
    const effect = vi.fn();
    const { rerender } = renderHook(
      ({
        keyValue,
        enabled,
      }: {
        keyValue: string | null | undefined;
        enabled: boolean;
      }) => useEffectOncePerKey(keyValue, enabled, effect),
      {
        initialProps: {
          keyValue: "invite-1",
          enabled: true,
        },
      },
    );

    rerender({
      keyValue: "invite-1",
      enabled: false,
    });
    rerender({
      keyValue: "invite-1",
      enabled: true,
    });

    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenNthCalledWith(2, "invite-1");
  });

  it("uses the latest callback for a new key without rerunning the same key", () => {
    const firstEffect = vi.fn();
    const secondEffect = vi.fn();
    const { rerender } = renderHook(
      ({
        keyValue,
        effect,
      }: {
        keyValue: string | null | undefined;
        effect: (key: string) => void;
      }) => useEffectOncePerKey(keyValue, true, effect),
      {
        initialProps: {
          keyValue: "token-1",
          effect: firstEffect,
        },
      },
    );

    rerender({
      keyValue: "token-1",
      effect: secondEffect,
    });
    rerender({
      keyValue: "token-2",
      effect: secondEffect,
    });

    expect(firstEffect).toHaveBeenCalledTimes(1);
    expect(secondEffect).toHaveBeenCalledTimes(1);
    expect(secondEffect).toHaveBeenCalledWith("token-2");
  });
});
