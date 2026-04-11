import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "./locales/en/common.json";
import enAuth from "./locales/en/auth.json";
import enNavigation from "./locales/en/navigation.json";
import enChannel from "./locales/en/channel.json";
import enMessage from "./locales/en/message.json";
import enSettings from "./locales/en/settings.json";
import enThread from "./locales/en/thread.json";
import enWorkspace from "./locales/en/workspace.json";
import enRoutines from "./locales/en/routines.json";
import enResources from "./locales/en/resources.json";
import enSkills from "./locales/en/skills.json";
import enOnboarding from "./locales/en/onboarding.json";

import { loadLanguage, NAMESPACES } from "./loadLanguage";

// Backward compat: remap legacy "zh" to "zh-CN"
if (typeof window !== "undefined" && window.localStorage) {
  const stored = localStorage.getItem("i18nextLng");
  if (stored === "zh") {
    localStorage.setItem("i18nextLng", "zh-CN");
  }
}

export const supportedLanguages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "zh-CN", name: "Chinese Simplified", nativeName: "简体中文" },
  { code: "zh-TW", name: "Chinese Traditional", nativeName: "繁體中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
];

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    navigation: enNavigation,
    channel: enChannel,
    message: enMessage,
    settings: enSettings,
    thread: enThread,
    workspace: enWorkspace,
    routines: enRoutines,
    resources: enResources,
    skills: enSkills,
    onboarding: enOnboarding,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: supportedLanguages.map((l) => l.code),
    defaultNS: "common",
    ns: [...NAMESPACES],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
      convertDetectedLanguage: (lng: string) => {
        // Normalize zh variants to zh-CN (e.g., "zh", "zh-Hans", "zh-Hans-CN")
        if (lng === "zh" || lng.startsWith("zh-Hans")) return "zh-CN";
        // Normalize zh-Hant to zh-TW
        if (lng.startsWith("zh-Hant")) return "zh-TW";
        return lng;
      },
    },
  });

// Load non-en language after init if needed
const detectedLng = i18n.language;
if (detectedLng && detectedLng !== "en") {
  loadLanguage(detectedLng).catch((err) => {
    console.error(`[i18n] Failed to load language "${detectedLng}":`, err);
  });
}

export default i18n;
