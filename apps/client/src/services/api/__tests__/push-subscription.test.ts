import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHttp = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../http", () => ({
  default: mockHttp,
}));

import {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
} from "../push-subscription";

describe("push-subscription API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getVapidPublicKey", () => {
    it("fetches the VAPID public key", async () => {
      const publicKey = "BNhJk...test-key";
      mockHttp.get.mockResolvedValue({ data: { publicKey } });

      const result = await getVapidPublicKey();

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/v1/push-subscriptions/vapid-public-key",
      );
      expect(result).toEqual({ publicKey });
    });

    it("propagates errors from http client", async () => {
      const error = new Error("Service unavailable");
      mockHttp.get.mockRejectedValue(error);

      await expect(getVapidPublicKey()).rejects.toThrow("Service unavailable");
    });
  });

  describe("subscribe", () => {
    it("sends push subscription to server", async () => {
      const subscription: PushSubscriptionJSON = {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        keys: {
          p256dh: "test-p256dh-key",
          auth: "test-auth-key",
        },
      };
      mockHttp.post.mockResolvedValue({ data: { id: "sub-1" } });

      const result = await subscribe(subscription);

      expect(mockHttp.post).toHaveBeenCalledWith("/v1/push-subscriptions", {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        keys: {
          p256dh: "test-p256dh-key",
          auth: "test-auth-key",
        },
      });
      expect(result).toEqual({ id: "sub-1" });
    });

    it("handles subscription with undefined keys gracefully", async () => {
      const subscription: PushSubscriptionJSON = {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      };
      mockHttp.post.mockResolvedValue({ data: { id: "sub-2" } });

      const result = await subscribe(subscription);

      expect(mockHttp.post).toHaveBeenCalledWith("/v1/push-subscriptions", {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        keys: undefined,
      });
      expect(result).toEqual({ id: "sub-2" });
    });

    it("propagates errors from http client", async () => {
      const error = new Error("Unauthorized");
      mockHttp.post.mockRejectedValue(error);

      const subscription: PushSubscriptionJSON = {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        keys: { p256dh: "key", auth: "auth" },
      };

      await expect(subscribe(subscription)).rejects.toThrow("Unauthorized");
    });
  });

  describe("unsubscribe", () => {
    it("sends unsubscribe request to server", async () => {
      const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";
      mockHttp.delete.mockResolvedValue({ data: { success: true } });

      const result = await unsubscribe(endpoint);

      expect(mockHttp.delete).toHaveBeenCalledWith("/v1/push-subscriptions", {
        data: { endpoint },
      });
      expect(result).toEqual({ success: true });
    });

    it("propagates errors from http client", async () => {
      const error = new Error("Not found");
      mockHttp.delete.mockRejectedValue(error);

      await expect(
        unsubscribe("https://fcm.googleapis.com/fcm/send/abc123"),
      ).rejects.toThrow("Not found");
    });
  });
});
