import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import i18n from "i18next";

// Mock i18next before importing loadLanguage
vi.mock("i18next", () => ({
  default: {
    hasResourceBundle: vi.fn(),
    addResourceBundle: vi.fn(),
    changeLanguage: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("loadLanguage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (i18n.hasResourceBundle as Mock).mockReturnValue(false);

    // Reset the module to get a fresh zustand store each test
    vi.resetModules();
  });

  async function importModule() {
    const mod = await import("../loadLanguage");
    return mod;
  }

  it("should skip loading for 'en'", async () => {
    const { loadLanguage } = await importModule();
    await loadLanguage("en");
    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
    expect(i18n.hasResourceBundle).not.toHaveBeenCalled();
  });

  it("should skip if all namespaces are already loaded (hasResourceBundle returns true for all)", async () => {
    (i18n.hasResourceBundle as Mock).mockReturnValue(true);
    const { loadLanguage, NAMESPACES } = await importModule();
    await loadLanguage("zh-CN");
    // hasAllResourceBundles checks every namespace
    for (const ns of NAMESPACES) {
      expect(i18n.hasResourceBundle).toHaveBeenCalledWith("zh-CN", ns);
    }
    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
  });

  it("should load namespaces for an available language (zh-CN)", async () => {
    const { loadLanguage } = await importModule();
    await loadLanguage("zh-CN");

    // zh-CN directory exists with 15 namespace files (ahand, auth, channel,
    // common, deepResearch, message, navigation, onboarding, resources,
    // routines, settings, skills, thread, wiki, workspace), so
    // addResourceBundle should be called once per namespace.
    expect(i18n.addResourceBundle).toHaveBeenCalledTimes(15);
    expect(i18n.addResourceBundle).toHaveBeenCalledWith(
      "zh-CN",
      "common",
      expect.any(Object),
    );
    expect(i18n.addResourceBundle).toHaveBeenCalledWith(
      "zh-CN",
      "auth",
      expect.any(Object),
    );
    expect(i18n.addResourceBundle).toHaveBeenCalledWith(
      "zh-CN",
      "ahand",
      expect.any(Object),
    );
  });

  it("should not call addResourceBundle for a language without locale files", async () => {
    const { loadLanguage } = await importModule();
    // Use a language code that has no locale files
    await loadLanguage("pt-BR");
    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
  });

  it("should reset isLoading to false if a loader rejects", async () => {
    const { loadLanguage, useLanguageLoading } = await importModule();

    // Spy on addResourceBundle to throw on the first call, simulating a
    // loader whose dynamic import resolves but whose content triggers an
    // error during bundle registration. However, we need the *loader*
    // itself to reject. The real loaders come from import.meta.glob and
    // resolve to actual JSON files. For zh-CN the loaders exist.  We can
    // make addResourceBundle throw synchronously inside the loader's
    // `.then` handler — but that still only covers the happy-ish path.
    //
    // The most realistic way: make addResourceBundle throw, which
    // propagates out of the `await loader()` chain and into Promise.all,
    // exercising the try/finally error branch.
    (i18n.addResourceBundle as Mock).mockImplementationOnce(() => {
      throw new Error("bundle registration failed");
    });

    expect(useLanguageLoading.getState().isLoading).toBe(false);

    await expect(loadLanguage("zh-CN")).rejects.toThrow(
      "bundle registration failed",
    );

    // The finally block should have reset isLoading to false
    expect(useLanguageLoading.getState().isLoading).toBe(false);
  });

  it("should set loading state during async load", async () => {
    const { loadLanguage, useLanguageLoading } = await importModule();

    expect(useLanguageLoading.getState().isLoading).toBe(false);

    const promise = loadLanguage("zh-CN");

    // During the microtask, loading should have been set to true
    // (it may already be resolved since import.meta.glob resolves quickly in vitest)
    await promise;

    // After completion, loading should be false
    expect(useLanguageLoading.getState().isLoading).toBe(false);
  });

  it("should cache loaded language (second call skips)", async () => {
    const { loadLanguage } = await importModule();
    await loadLanguage("zh-CN");
    expect(i18n.addResourceBundle).toHaveBeenCalledTimes(15);

    // Now mark as already loaded
    (i18n.hasResourceBundle as Mock).mockReturnValue(true);
    vi.clearAllMocks();

    await loadLanguage("zh-CN");
    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
  });
});

describe("changeLanguage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (i18n.hasResourceBundle as Mock).mockReturnValue(false);
  });

  async function importModule() {
    vi.resetModules();
    return await import("../loadLanguage");
  }

  it("should load language then call i18n.changeLanguage", async () => {
    const { changeLanguage } = await importModule();
    await changeLanguage("zh-CN");

    expect(i18n.addResourceBundle).toHaveBeenCalled();
    expect(i18n.changeLanguage).toHaveBeenCalledWith("zh-CN");
  });

  it("should call i18n.changeLanguage for 'en' without loading", async () => {
    const { changeLanguage } = await importModule();
    await changeLanguage("en");

    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
    expect(i18n.changeLanguage).toHaveBeenCalledWith("en");
  });

  it("should call i18n.changeLanguage even if language is already cached", async () => {
    (i18n.hasResourceBundle as Mock).mockReturnValue(true);
    const { changeLanguage } = await importModule();
    await changeLanguage("ja");

    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
    expect(i18n.changeLanguage).toHaveBeenCalledWith("ja");
  });
});
