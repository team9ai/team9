import { beforeEach, describe, expect, it } from "vitest";
import {
  useForwardSelectionStore,
  FORWARD_SELECTION_MAX,
} from "../useForwardSelectionStore";

beforeEach(() => {
  useForwardSelectionStore.getState().exit();
});

describe("useForwardSelectionStore", () => {
  it("enters mode for a channel", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    const s = useForwardSelectionStore.getState();
    expect(s.active).toBe(true);
    expect(s.channelId).toBe("ch-1");
    expect(s.selectedIds.size).toBe(0);
  });

  it("exit resets state", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    useForwardSelectionStore.getState().toggle("m-1");
    useForwardSelectionStore.getState().exit();
    const s = useForwardSelectionStore.getState();
    expect(s.active).toBe(false);
    expect(s.channelId).toBe(null);
    expect(s.selectedIds.size).toBe(0);
  });

  it("toggle adds and removes ids", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    expect(useForwardSelectionStore.getState().toggle("m-1")).toBe(true);
    expect(useForwardSelectionStore.getState().isSelected("m-1")).toBe(true);
    expect(useForwardSelectionStore.getState().toggle("m-1")).toBe(true);
    expect(useForwardSelectionStore.getState().isSelected("m-1")).toBe(false);
  });

  it("toggle returns false when inactive", () => {
    expect(useForwardSelectionStore.getState().toggle("m-1")).toBe(false);
  });

  it("toggle enforces cap", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    for (let i = 0; i < FORWARD_SELECTION_MAX; i += 1) {
      useForwardSelectionStore.getState().toggle(`m-${i}`);
    }
    expect(useForwardSelectionStore.getState().toggle("overflow")).toBe(false);
    expect(useForwardSelectionStore.getState().selectedIds.size).toBe(
      FORWARD_SELECTION_MAX,
    );
  });

  it("addRange respects cap and returns added count", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    const ids = Array.from({ length: 150 }, (_, i) => `m-${i}`);
    const added = useForwardSelectionStore.getState().addRange(ids);
    expect(added).toBe(FORWARD_SELECTION_MAX);
    expect(useForwardSelectionStore.getState().selectedIds.size).toBe(
      FORWARD_SELECTION_MAX,
    );
  });

  it("addRange returns 0 when inactive", () => {
    expect(useForwardSelectionStore.getState().addRange(["m-1"])).toBe(0);
  });

  it("addRange skips already-selected ids", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    useForwardSelectionStore.getState().toggle("m-1");
    const added = useForwardSelectionStore.getState().addRange(["m-1", "m-2"]);
    expect(added).toBe(1);
  });

  it("clear empties selection without exiting", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    useForwardSelectionStore.getState().toggle("m-1");
    useForwardSelectionStore.getState().clear();
    const s = useForwardSelectionStore.getState();
    expect(s.selectedIds.size).toBe(0);
    expect(s.active).toBe(true);
  });

  it("entering a different channel clears selection", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    useForwardSelectionStore.getState().toggle("m-1");
    useForwardSelectionStore.getState().enter("ch-2");
    const s = useForwardSelectionStore.getState();
    expect(s.channelId).toBe("ch-2");
    expect(s.selectedIds.size).toBe(0);
  });

  it("addRange does not mutate state when nothing new is added", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    useForwardSelectionStore.getState().toggle("m-1");
    const sizeBefore = useForwardSelectionStore.getState().selectedIds.size;
    const added = useForwardSelectionStore.getState().addRange(["m-1"]);
    expect(added).toBe(0);
    expect(useForwardSelectionStore.getState().selectedIds.size).toBe(
      sizeBefore,
    );
  });

  it("isSelected returns false for unselected message", () => {
    useForwardSelectionStore.getState().enter("ch-1");
    expect(
      useForwardSelectionStore.getState().isSelected("m-not-selected"),
    ).toBe(false);
  });

  it("FORWARD_SELECTION_MAX is 100", () => {
    expect(FORWARD_SELECTION_MAX).toBe(100);
  });
});
