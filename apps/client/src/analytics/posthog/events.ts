// apps/client/src/analytics/posthog/events.ts

export const EVENTS = {
  SIGNUP_PAGE_VIEWED: "signup_page_viewed",
  SIGNUP_BUTTON_CLICKED: "signup_button_clicked",
  SIGNUP_COMPLETED: "signup_completed",
  ONBOARDING_STEP_VIEWED: "onboarding_step_viewed",
  ONBOARDING_COMPLETED: "onboarding_completed",
  SUBSCRIPTION_PLAN_PAGE_VIEWED: "subscription_plan_page_viewed",
  SUBSCRIPTION_BUTTON_CLICKED: "subscription_button_clicked",
} as const;

export const ONBOARDING_STEPS = {
  1: "role",
  2: "tasks",
  3: "channels",
  4: "agents",
  5: "invite",
  6: "plan",
} as const;

export type OnboardingStepName =
  (typeof ONBOARDING_STEPS)[keyof typeof ONBOARDING_STEPS];

export type SubscriptionEntrySource = "home" | "onboarding" | "manage_credits";

export type SignupMethod = "email" | "google" | "apple";

// Events that should be pushed to window.dataLayer for GTM → ad platforms.
// Keys are PostHog event names, values are GTM-facing event names.
//
// Note: SIGNUP_COMPLETED's PostHog capture now happens server-side in
// AuthService. The client only pushes to GTM here (via pushGtmConversion)
// for Google Ads conversion tracking — it does NOT also capture to PostHog.
export const GTM_BRIDGE_EVENTS: Record<string, string> = {
  [EVENTS.SIGNUP_COMPLETED]: "conversion_signup_completed",
};
