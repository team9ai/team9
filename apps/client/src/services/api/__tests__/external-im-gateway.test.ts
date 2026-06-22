import { describe, expect, it } from "vitest";
import { createWeixinQrImageSrc } from "../external-im-gateway";

describe("createWeixinQrImageSrc", () => {
  it("returns existing image data URLs unchanged", async () => {
    await expect(
      createWeixinQrImageSrc("data:image/png;base64,abc"),
    ).resolves.toBe("data:image/png;base64,abc");
  });

  it("wraps known base64 image payloads with their MIME type", async () => {
    await expect(createWeixinQrImageSrc("iVBORw0KGgoAAA")).resolves.toBe(
      "data:image/png;base64,iVBORw0KGgoAAA",
    );
    await expect(createWeixinQrImageSrc("R0lGODlhAQABAAAA")).resolves.toBe(
      "data:image/gif;base64,R0lGODlhAQABAAAA",
    );
  });

  it("rejects unknown base64 payloads instead of turning them into QR text", async () => {
    await expect(
      createWeixinQrImageSrc("VGhpcyBpcyBiYXNlNjQgYnV0IG5vdCBhbiBpbWFnZQ=="),
    ).rejects.toThrow("Unsupported Weixin QR image payload format.");
  });

  it("renders plain QR content as a generated data URL", async () => {
    await expect(createWeixinQrImageSrc("weixin-login-token")).resolves.toMatch(
      /^data:image\/png;base64,/,
    );
  });
});
