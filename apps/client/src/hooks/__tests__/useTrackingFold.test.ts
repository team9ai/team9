import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTrackingFold } from "../useTrackingFold";

describe("useTrackingFold", () => {
  describe("initial state", () => {
    it("returns isFolded=false for unset roundId", () => {
      const { result } = renderHook(() => useTrackingFold());

      expect(result.current.isFolded("round-1")).toBe(false);
    });

    it("returns stepCount=0 for unset roundId", () => {
      const { result } = renderHook(() => useTrackingFold());

      expect(result.current.getStepCount("round-1")).toBe(0);
    });

    it("handles any arbitrary roundId in initial state", () => {
      const { result } = renderHook(() => useTrackingFold());

      expect(result.current.isFolded("nonexistent")).toBe(false);
      expect(result.current.getStepCount("nonexistent")).toBe(0);
    });
  });

  describe("setFolded", () => {
    it("sets isFolded to true for a roundId", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", true, 5);
      });

      expect(result.current.isFolded("round-1")).toBe(true);
      expect(result.current.getStepCount("round-1")).toBe(5);
    });

    it("sets isFolded to false for a roundId", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", false, 3);
      });

      expect(result.current.isFolded("round-1")).toBe(false);
      expect(result.current.getStepCount("round-1")).toBe(3);
    });

    it("defaults stepCount to 0 when not provided", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", true);
      });

      expect(result.current.isFolded("round-1")).toBe(true);
      expect(result.current.getStepCount("round-1")).toBe(0);
    });

    it("allows multiple updates to the same roundId", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", true, 2);
      });
      expect(result.current.isFolded("round-1")).toBe(true);
      expect(result.current.getStepCount("round-1")).toBe(2);

      act(() => {
        result.current.setFolded("round-1", false, 7);
      });
      expect(result.current.isFolded("round-1")).toBe(false);
      expect(result.current.getStepCount("round-1")).toBe(7);
    });

    it("tracks multiple independent rounds", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", true, 3);
        result.current.setFolded("round-2", false, 5);
        result.current.setFolded("round-3", true, 1);
      });

      expect(result.current.isFolded("round-1")).toBe(true);
      expect(result.current.getStepCount("round-1")).toBe(3);
      expect(result.current.isFolded("round-2")).toBe(false);
      expect(result.current.getStepCount("round-2")).toBe(5);
      expect(result.current.isFolded("round-3")).toBe(true);
      expect(result.current.getStepCount("round-3")).toBe(1);
    });
  });

  describe("autoFoldPrevious", () => {
    it("does nothing when there are no tracked rounds", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.autoFoldPrevious("round-latest");
      });

      expect(result.current.isFolded("round-latest")).toBe(false);
    });

    it("does not fold the only round when it is the latest", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", false, 4);
      });
      act(() => {
        result.current.autoFoldPrevious("round-1");
      });

      expect(result.current.isFolded("round-1")).toBe(false);
      expect(result.current.getStepCount("round-1")).toBe(4);
    });

    it("folds all previous rounds except the latest", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", false, 2);
        result.current.setFolded("round-2", false, 3);
        result.current.setFolded("round-3", false, 4);
      });
      act(() => {
        result.current.autoFoldPrevious("round-3");
      });

      expect(result.current.isFolded("round-1")).toBe(true);
      expect(result.current.isFolded("round-2")).toBe(true);
      expect(result.current.isFolded("round-3")).toBe(false);
    });

    it("preserves the stepCount when auto-folding", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", false, 7);
        result.current.setFolded("round-2", false, 9);
      });
      act(() => {
        result.current.autoFoldPrevious("round-2");
      });

      expect(result.current.getStepCount("round-1")).toBe(7);
      expect(result.current.getStepCount("round-2")).toBe(9);
    });

    it("leaves the latestRoundId entry unchanged", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", false, 2);
        result.current.setFolded("round-2", false, 3);
      });
      act(() => {
        result.current.autoFoldPrevious("round-2");
      });

      // round-2 should stay in its existing state (not folded, stepCount 3)
      expect(result.current.isFolded("round-2")).toBe(false);
      expect(result.current.getStepCount("round-2")).toBe(3);
    });

    it("is idempotent across multiple calls", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", false, 2);
        result.current.setFolded("round-2", false, 3);
        result.current.setFolded("round-3", false, 4);
      });
      act(() => {
        result.current.autoFoldPrevious("round-3");
      });
      act(() => {
        result.current.autoFoldPrevious("round-3");
      });
      act(() => {
        result.current.autoFoldPrevious("round-3");
      });

      expect(result.current.isFolded("round-1")).toBe(true);
      expect(result.current.isFolded("round-2")).toBe(true);
      expect(result.current.isFolded("round-3")).toBe(false);
      expect(result.current.getStepCount("round-1")).toBe(2);
      expect(result.current.getStepCount("round-2")).toBe(3);
      expect(result.current.getStepCount("round-3")).toBe(4);
    });

    it("does not affect untracked latestRoundId state", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", false, 2);
      });
      act(() => {
        result.current.autoFoldPrevious("round-unknown");
      });

      // Existing tracked round should be folded
      expect(result.current.isFolded("round-1")).toBe(true);
      // Unknown round has no entry, so defaults
      expect(result.current.isFolded("round-unknown")).toBe(false);
      expect(result.current.getStepCount("round-unknown")).toBe(0);
    });

    it("re-folds rounds that were previously unfolded", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("round-1", true, 2);
        result.current.setFolded("round-2", false, 3);
      });
      // User manually unfolds round-1
      act(() => {
        result.current.setFolded("round-1", false, 2);
      });
      expect(result.current.isFolded("round-1")).toBe(false);

      // A new latest round comes in, auto-folding all previous
      act(() => {
        result.current.autoFoldPrevious("round-2");
      });
      expect(result.current.isFolded("round-1")).toBe(true);
      expect(result.current.isFolded("round-2")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("works with an empty string roundId", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("", true, 5);
      });

      expect(result.current.isFolded("")).toBe(true);
      expect(result.current.getStepCount("")).toBe(5);
    });

    it("empty-string roundId can be folded via autoFoldPrevious", () => {
      const { result } = renderHook(() => useTrackingFold());

      act(() => {
        result.current.setFolded("", false, 1);
        result.current.setFolded("round-latest", false, 2);
      });
      act(() => {
        result.current.autoFoldPrevious("round-latest");
      });

      expect(result.current.isFolded("")).toBe(true);
      expect(result.current.getStepCount("")).toBe(1);
      expect(result.current.isFolded("round-latest")).toBe(false);
    });
  });

  describe("function reference stability", () => {
    it("keeps setFolded reference stable across renders", () => {
      const { result, rerender } = renderHook(() => useTrackingFold());
      const initialSetFolded = result.current.setFolded;

      rerender();
      expect(result.current.setFolded).toBe(initialSetFolded);

      act(() => {
        result.current.setFolded("round-1", true, 1);
      });
      expect(result.current.setFolded).toBe(initialSetFolded);
    });

    it("keeps autoFoldPrevious reference stable across renders", () => {
      const { result, rerender } = renderHook(() => useTrackingFold());
      const initialAutoFold = result.current.autoFoldPrevious;

      rerender();
      expect(result.current.autoFoldPrevious).toBe(initialAutoFold);

      act(() => {
        result.current.setFolded("round-1", true, 1);
      });
      expect(result.current.autoFoldPrevious).toBe(initialAutoFold);
    });

    it("isFolded and getStepCount return updated values after state change", () => {
      const { result } = renderHook(() => useTrackingFold());

      expect(result.current.isFolded("round-1")).toBe(false);
      expect(result.current.getStepCount("round-1")).toBe(0);

      act(() => {
        result.current.setFolded("round-1", true, 8);
      });

      expect(result.current.isFolded("round-1")).toBe(true);
      expect(result.current.getStepCount("round-1")).toBe(8);
    });
  });
});
