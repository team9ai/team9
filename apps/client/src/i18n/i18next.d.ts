import "i18next";

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
import enWiki from "./locales/en/wiki.json";
import enDeepResearch from "./locales/en/deepResearch.json";
import enAhand from "./locales/en/ahand.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof enCommon;
      auth: typeof enAuth;
      navigation: typeof enNavigation;
      channel: typeof enChannel;
      message: typeof enMessage;
      settings: typeof enSettings;
      thread: typeof enThread;
      workspace: typeof enWorkspace;
      routines: typeof enRoutines;
      resources: typeof enResources;
      skills: typeof enSkills;
      onboarding: typeof enOnboarding;
      wiki: typeof enWiki;
      deepResearch: typeof enDeepResearch;
      ahand: typeof enAhand;
    };
  }
}
