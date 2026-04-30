import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the index module's side effects by mocking dependencies
// and re-importing the module with different localStorage states.

vi.mock("i18next", () => {
  const instance = {
    use: vi.fn().mockReturnThis(),
    init: vi.fn().mockReturnThis(),
    language: "en",
    hasResourceBundle: vi.fn().mockReturnValue(false),
    addResourceBundle: vi.fn(),
    changeLanguage: vi.fn().mockResolvedValue(undefined),
  };
  return { default: instance };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("i18next-browser-languagedetector", () => {
  return { default: class MockDetector {} };
});

vi.mock("../loadLanguage", () => ({
  loadLanguage: vi.fn().mockResolvedValue(undefined),
  NAMESPACES: [
    "common",
    "auth",
    "navigation",
    "channel",
    "message",
    "settings",
    "thread",
    "workspace",
    "routines",
    "resources",
    "skills",
    "onboarding",
    "wiki",
    "ahand",
  ],
}));

describe("i18n/index", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("remaps 'zh' to 'zh-CN' in localStorage on init", async () => {
    localStorage.setItem("i18nextLng", "zh");

    await import("../index");

    expect(localStorage.getItem("i18nextLng")).toBe("zh-CN");
  });

  it("does not modify localStorage if language is not 'zh'", async () => {
    localStorage.setItem("i18nextLng", "en");

    await import("../index");

    expect(localStorage.getItem("i18nextLng")).toBe("en");
  });

  it("does not modify localStorage if no language is stored", async () => {
    await import("../index");

    // localStorage may have been set by LanguageDetector mock, but not to "zh-CN" by our code
    // The key check: our code only sets "zh-CN" when stored was "zh"
    expect(localStorage.getItem("i18nextLng")).not.toBe("zh-CN");
  });

  it("calls loadLanguage for non-en detected language", async () => {
    const i18n = (await import("i18next")).default;
    // Set detected language to zh-CN
    Object.defineProperty(i18n, "language", {
      value: "zh-CN",
      writable: true,
      configurable: true,
    });

    await import("../index");
    const { loadLanguage } = await import("../loadLanguage");

    expect(loadLanguage).toHaveBeenCalledWith("zh-CN");

    // Restore
    Object.defineProperty(i18n, "language", {
      value: "en",
      writable: true,
      configurable: true,
    });
  });

  it("does not call loadLanguage when detected language is 'en'", async () => {
    const i18n = (await import("i18next")).default;
    Object.defineProperty(i18n, "language", {
      value: "en",
      writable: true,
      configurable: true,
    });

    await import("../index");
    const { loadLanguage } = await import("../loadLanguage");

    expect(loadLanguage).not.toHaveBeenCalled();
  });

  it("exports supportedLanguages with 12 languages", async () => {
    const { supportedLanguages } = await import("../index");
    expect(supportedLanguages).toHaveLength(12);
    expect(supportedLanguages.map((l) => l.code)).toEqual([
      "en",
      "zh-CN",
      "zh-TW",
      "ja",
      "ko",
      "es",
      "pt",
      "fr",
      "de",
      "it",
      "nl",
      "ru",
    ]);
  });

  it("supportedLanguages entries have name and nativeName", async () => {
    const { supportedLanguages } = await import("../index");
    for (const lang of supportedLanguages) {
      expect(lang).toHaveProperty("code");
      expect(lang).toHaveProperty("name");
      expect(lang).toHaveProperty("nativeName");
      expect(typeof lang.code).toBe("string");
      expect(typeof lang.name).toBe("string");
      expect(typeof lang.nativeName).toBe("string");
    }
  });
});
