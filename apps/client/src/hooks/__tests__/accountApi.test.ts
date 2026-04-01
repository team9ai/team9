import { beforeEach, describe, expect, it, vi } from "vitest";
import http from "@/services/http";
import api from "@/services/api";

describe("accountApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("gets the pending email change for the signed-in user", async () => {
    vi.spyOn(http, "get").mockResolvedValueOnce({
      data: {
        pendingEmailChange: {
          id: "req-1",
          currentEmail: "alice@example.com",
          newEmail: "alice+new@example.com",
          expiresAt: "2026-04-01T10:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
        },
      },
    } as never);

    const result = await api.account.getPendingEmailChange();

    expect(http.get).toHaveBeenCalledWith("/v1/account/email-change");
    expect(result.pendingEmailChange?.newEmail).toBe("alice+new@example.com");
  });

  it("starts an email change request", async () => {
    vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        message: "Confirmation email sent.",
        pendingEmailChange: {
          id: "req-1",
          currentEmail: "alice@example.com",
          newEmail: "alice+new@example.com",
        },
      },
    } as never);

    const result = await api.account.startEmailChange({
      newEmail: "alice+new@example.com",
    });

    expect(http.post).toHaveBeenCalledWith("/v1/account/email-change", {
      newEmail: "alice+new@example.com",
    });
    expect(result.message).toBe("Confirmation email sent.");
  });

  it("resends an email change confirmation", async () => {
    vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        message: "Confirmation email resent.",
        pendingEmailChange: {
          id: "req-1",
          currentEmail: "alice@example.com",
          newEmail: "alice+new@example.com",
        },
      },
    } as never);

    const result = await api.account.resendEmailChange();

    expect(http.post).toHaveBeenCalledWith("/v1/account/email-change/resend");
    expect(result.message).toBe("Confirmation email resent.");
  });

  it("cancels an email change request", async () => {
    vi.spyOn(http, "delete").mockResolvedValueOnce({
      data: { message: "Pending email change cancelled." },
    } as never);

    const result = await api.account.cancelEmailChange();

    expect(http.delete).toHaveBeenCalledWith("/v1/account/email-change");
    expect(result.message).toBe("Pending email change cancelled.");
  });
});
