import { describe, it, expect, beforeEach } from "vitest";
import { useDeepResearchStore } from "./useDeepResearchStore";

describe("useDeepResearchStore", () => {
  beforeEach(() => useDeepResearchStore.getState().reset());

  it("appends thought_summary to thoughts array", () => {
    const { ingest } = useDeepResearchStore.getState();
    ingest("T1", {
      seq: "1",
      event: "content.delta",
      data: '{"type":"thought_summary","text":"A"}',
    });
    ingest("T1", {
      seq: "2",
      event: "content.delta",
      data: '{"type":"thought_summary","text":"B"}',
    });
    const s = useDeepResearchStore.getState().byTaskId["T1"];
    expect(s.thoughts).toEqual([
      { seq: "1", text: "A" },
      { seq: "2", text: "B" },
    ]);
    expect(s.lastSeq).toBe("2");
  });

  it("merges content.delta text into markdownAccum without keeping per-delta nodes", () => {
    const { ingest } = useDeepResearchStore.getState();
    ingest("T1", {
      seq: "1",
      event: "content.delta",
      data: '{"type":"text","text":"# Hi\\n"}',
    });
    ingest("T1", {
      seq: "2",
      event: "content.delta",
      data: '{"type":"text","text":"body"}',
    });
    const s = useDeepResearchStore.getState().byTaskId["T1"];
    expect(s.markdownAccum).toBe("# Hi\nbody");
  });

  it("caps thoughts at 200 and sets truncatedThoughts", () => {
    const { ingest } = useDeepResearchStore.getState();
    for (let i = 0; i < 205; i++) {
      ingest("T1", {
        seq: String(i + 1),
        event: "content.delta",
        data: JSON.stringify({ type: "thought_summary", text: "t" + i }),
      });
    }
    const s = useDeepResearchStore.getState().byTaskId["T1"];
    expect(s.thoughts.length).toBe(200);
    expect(s.truncatedThoughts).toBe(5);
    expect(s.thoughts[0].text).toBe("t5");
  });

  it("records interaction.complete and error", () => {
    const { ingest } = useDeepResearchStore.getState();
    ingest("T1", {
      seq: "9",
      event: "interaction.complete",
      data: '{"reportUrl":"http://x/r.md"}',
    });
    ingest("T2", {
      seq: "1",
      event: "error",
      data: '{"code":"X","message":"y"}',
    });
    expect(useDeepResearchStore.getState().byTaskId["T1"].status).toBe(
      "completed",
    );
    expect(useDeepResearchStore.getState().byTaskId["T1"].reportUrl).toBe(
      "http://x/r.md",
    );
    expect(useDeepResearchStore.getState().byTaskId["T2"].status).toBe(
      "failed",
    );
    expect(useDeepResearchStore.getState().byTaskId["T2"].error).toEqual({
      code: "X",
      message: "y",
    });
  });

  it("counts unknown events", () => {
    const { ingest } = useDeepResearchStore.getState();
    ingest("T1", { seq: "1", event: "something_new", data: "{}" });
    expect(useDeepResearchStore.getState().byTaskId["T1"].unknownCount).toBe(1);
  });
});
