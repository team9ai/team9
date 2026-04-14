import { describe, expect, it } from "vitest";
import { getHttpErrorMessage } from "./http-error";

describe("getHttpErrorMessage", () => {
  it("reads nested error.message from structured API envelopes", () => {
    const error = Object.assign(new Error("Request failed with status 429"), {
      response: {
        status: 429,
        data: {
          success: false,
          error: {
            code: "DEEP_RESEARCH_CONCURRENCY_LIMIT_REACHED",
            message: "Concurrency limit reached.",
            details: { retryAfterSeconds: 42 },
          },
        },
      },
    });

    expect(getHttpErrorMessage(error)).toBe("Concurrency limit reached.");
  });
});
