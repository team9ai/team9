import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zhCommon from "./locales/zh/common.json";
import zhAuth from "./locales/zh/auth.json";
import zhNavigation from "./locales/zh/navigation.json";
import zhChannel from "./locales/zh/channel.json";
import zhMessage from "./locales/zh/message.json";
import zhSettings from "./locales/zh/settings.json";
import zhThread from "./locales/zh/thread.json";
import zhWorkspace from "./locales/zh/workspace.json";
import zhRoutines from "./locales/zh/routines.json";
import zhResources from "./locales/zh/resources.json";
import zhSkills from "./locales/zh/skills.json";
import zhOnboarding from "./locales/zh/onboarding.json";

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

export const resources = {
  zh: {
    common: zhCommon,
    auth: zhAuth,
    navigation: zhNavigation,
    channel: zhChannel,
    message: zhMessage,
    settings: zhSettings,
    thread: zhThread,
    workspace: zhWorkspace,
    routines: zhRoutines,
    resources: zhResources,
    skills: zhSkills,
    onboarding: zhOnboarding,
  },
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

export const supportedLanguages = [
  { code: "zh", name: "中文", nativeName: "中文" },
  { code: "en", name: "English", nativeName: "English" },
];

i18n
  // .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: ["zh", "en"],
    defaultNS: "common",
    ns: [
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
    ],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      // Prioritize user-saved language, then browser language
      order: ["localStorage", "navigator", "htmlTag"],
      // Save to localStorage after user selects language
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  });

export default i18n;
