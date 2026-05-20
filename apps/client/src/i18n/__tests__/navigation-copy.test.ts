import { describe, expect, it } from "vitest";

import zhCnNavigation from "../locales/zh-CN/navigation.json";

describe("zh-CN navigation copy", () => {
  it("uses 重命名 for the topic-session rename menu item", () => {
    expect(zhCnNavigation.renameTopicSession).toBe("重命名");
  });
});
