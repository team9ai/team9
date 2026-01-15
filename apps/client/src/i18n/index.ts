import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import zhCommon from "./locales/zh/common.json";
import zhAuth from "./locales/zh/auth.json";
import zhNavigation from "./locales/zh/navigation.json";
import zhChannel from "./locales/zh/channel.json";
import zhMessage from "./locales/zh/message.json";
import zhSettings from "./locales/zh/settings.json";

import enCommon from "./locales/en/common.json";
import enAuth from "./locales/en/auth.json";
import enNavigation from "./locales/en/navigation.json";
import enChannel from "./locales/en/channel.json";
import enMessage from "./locales/en/message.json";
import enSettings from "./locales/en/settings.json";

export const resources = {
  zh: {
    common: zhCommon,
    auth: zhAuth,
    navigation: zhNavigation,
    channel: zhChannel,
    message: zhMessage,
    settings: zhSettings,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    navigation: enNavigation,
    channel: enChannel,
    message: enMessage,
    settings: enSettings,
  },
};

export const supportedLanguages = [
  { code: "zh", name: "中文", nativeName: "中文" },
  { code: "en", name: "English", nativeName: "English" },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "zh",
    defaultNS: "common",
    ns: ["common", "auth", "navigation", "channel", "message", "settings"],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  });

export default i18n;
