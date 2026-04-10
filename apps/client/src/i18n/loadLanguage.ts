import i18n from "i18next";
import { create } from "zustand";

const NAMESPACES = [
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
] as const;

const modules = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/*/*.json",
);

interface LanguageLoadingState {
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
}

export const useLanguageLoading = create<LanguageLoadingState>((set) => ({
  isLoading: false,
  setLoading: (loading) => set({ isLoading: loading }),
}));

export async function loadLanguage(lang: string): Promise<void> {
  if (lang === "en") return;
  if (i18n.hasResourceBundle(lang, "common")) return;

  useLanguageLoading.getState().setLoading(true);

  try {
    const loadPromises = NAMESPACES.map(async (ns) => {
      const path = `./locales/${lang}/${ns}.json`;
      const loader = modules[path];
      if (loader) {
        const mod = await loader();
        i18n.addResourceBundle(lang, ns, mod.default || mod);
      }
    });
    await Promise.all(loadPromises);
  } finally {
    useLanguageLoading.getState().setLoading(false);
  }
}

export async function changeLanguage(lang: string): Promise<void> {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
}
