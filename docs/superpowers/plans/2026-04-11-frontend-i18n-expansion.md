# Frontend i18n Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Team9's frontend from 2 languages (en, zh) to 8 languages with full component coverage, unified date formatting, and lazy loading.

**Architecture:** Refactor i18n to use Vite dynamic imports for non-English languages. Migrate zh→zh-CN, add zh-TW/ja/ko/es/fr/de. Convert ~87 un-i18n-ized components. Create locale-aware date utilities with `<RelativeTime />` component.

**Tech Stack:** i18next, react-i18next, i18next-browser-languagedetector, Vite import.meta.glob, Intl APIs

**Spec:** `docs/superpowers/specs/2026-04-10-frontend-i18n-expansion-design.md`

---

### Task 1: i18n Infrastructure Refactor

**Goal:** Migrate zh→zh-CN, refactor i18n/index.ts for 8-language dynamic loading, enable LanguageDetector

**Files:**

- Rename: `apps/client/src/i18n/locales/zh/` → `apps/client/src/i18n/locales/zh-CN/`
- Modify: `apps/client/src/i18n/index.ts`
- Create: `apps/client/src/i18n/loadLanguage.ts`
- Modify: `apps/client/src/i18n/i18next.d.ts`
- Modify: `apps/client/src/main.tsx`
- Test: `apps/client/src/i18n/__tests__/loadLanguage.test.ts`

**Acceptance Criteria:**

- [ ] `locales/zh/` renamed to `locales/zh-CN/`, all imports updated
- [ ] `supportedLanguages` exports 8 languages with correct codes and native names
- [ ] `en` statically imported, other languages lazy-loaded via `import.meta.glob`
- [ ] `loadLanguage()` loads all 12 namespaces for a given language and caches them
- [ ] `LanguageDetector` enabled with order: localStorage → navigator → htmlTag
- [ ] localStorage `"zh"` automatically remapped to `"zh-CN"` on init
- [ ] `useLanguageLoading()` hook exposes loading state during language switch

**Verify:** `cd apps/client && npx vitest run src/i18n` → all tests pass

**Steps:**

- [ ] **Step 1: Rename zh directory to zh-CN**

```bash
cd apps/client/src/i18n/locales
mv zh zh-CN
```

- [ ] **Step 2: Rewrite `i18n/index.ts`**

Replace the entire file. Key changes: only statically import `en/*`, define `supportedLanguages` with 8 entries, enable `LanguageDetector`, add zh compat.

```typescript
// apps/client/src/i18n/index.ts
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

import { loadLanguage } from "./loadLanguage";

// Backward compat: remap legacy "zh" to "zh-CN"
const stored = localStorage.getItem("i18nextLng");
if (stored === "zh") {
  localStorage.setItem("i18nextLng", "zh-CN");
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
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  });

// Load non-en language after init if needed
const detectedLng = i18n.language;
if (detectedLng && detectedLng !== "en") {
  loadLanguage(detectedLng);
}

export default i18n;
```

- [ ] **Step 3: Create `i18n/loadLanguage.ts`**

```typescript
// apps/client/src/i18n/loadLanguage.ts
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
```

- [ ] **Step 4: Update `i18next.d.ts`**

```typescript
// apps/client/src/i18n/i18next.d.ts
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
    };
  }
}
```

- [ ] **Step 5: Write tests for loadLanguage**

```typescript
// apps/client/src/i18n/__tests__/loadLanguage.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock import.meta.glob before importing the module
vi.mock("i18next", () => ({
  default: {
    hasResourceBundle: vi.fn().mockReturnValue(false),
    addResourceBundle: vi.fn(),
    changeLanguage: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("loadLanguage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips loading for en", async () => {
    const { loadLanguage } = await import("../loadLanguage");
    const i18n = (await import("i18next")).default;
    await loadLanguage("en");
    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
  });

  it("skips loading if already loaded", async () => {
    const i18n = (await import("i18next")).default;
    vi.mocked(i18n.hasResourceBundle).mockReturnValue(true);
    const { loadLanguage } = await import("../loadLanguage");
    await loadLanguage("zh-CN");
    expect(i18n.addResourceBundle).not.toHaveBeenCalled();
  });

  it("sets loading state during load", async () => {
    const { loadLanguage, useLanguageLoading } =
      await import("../loadLanguage");
    const states: boolean[] = [];
    useLanguageLoading.subscribe((s) => states.push(s.isLoading));
    await loadLanguage("ja");
    expect(states).toContain(true);
    expect(useLanguageLoading.getState().isLoading).toBe(false);
  });
});
```

- [ ] **Step 6: Update all files that import from `@/i18n` referencing `zh`**

Search for imports of `zhCommon`, `zhAuth`, etc. and remove them. The `resources` object no longer has a `zh` key. Any test files mocking `supportedLanguages` with `code: "zh"` must update to `code: "zh-CN"`.

Key files to check:

- `apps/client/src/components/layout/__tests__/MainSidebar.user-menu.test.tsx`
- Any test using `i18n.changeLanguage("zh")` → change to `"zh-CN"`

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/i18n/ apps/client/src/main.tsx
git commit -m "refactor(i18n): migrate zh→zh-CN, add dynamic loading for 8 languages"
```

---

### Task 2: Date/Time Formatting Utilities

**Goal:** Create locale-aware date/time formatting functions that follow the current i18n language

**Files:**

- Create: `apps/client/src/lib/date-format.ts`
- Modify: `apps/client/src/i18n/locales/en/common.json` (add `justNow`, `today`, `yesterday` keys)
- Modify: `apps/client/src/i18n/locales/zh-CN/common.json` (same keys)
- Test: `apps/client/src/lib/__tests__/date-format.test.ts`

**Acceptance Criteria:**

- [ ] `formatDate()`, `formatTime()`, `formatDateTime()` use `Intl.DateTimeFormat` with current locale
- [ ] `formatRelative()` returns locale-appropriate relative time strings
- [ ] `formatNumber()` uses `Intl.NumberFormat` with current locale
- [ ] `"justNow"` key added to common namespace for < 1 minute case
- [ ] All functions auto-track `i18n.language` changes

**Verify:** `cd apps/client && npx vitest run src/lib/__tests__/date-format` → all pass

**Steps:**

- [ ] **Step 1: Add time-related keys to common.json (en)**

Add to `apps/client/src/i18n/locales/en/common.json`:

```json
{
  "justNow": "just now",
  "today": "Today",
  "yesterday": "Yesterday"
}
```

Add to `apps/client/src/i18n/locales/zh-CN/common.json`:

```json
{
  "justNow": "刚刚",
  "today": "今天",
  "yesterday": "昨天"
}
```

- [ ] **Step 2: Create `date-format.ts`**

```typescript
// apps/client/src/lib/date-format.ts
import i18n from "@/i18n";

const localeMap: Record<string, string> = {
  en: "en-US",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  ja: "ja-JP",
  ko: "ko-KR",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
};

export function getCurrentLocale(): string {
  return localeMap[i18n.language] || "en-US";
}

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

export function formatDate(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  const opts: Intl.DateTimeFormatOptions = options ?? {
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  return new Intl.DateTimeFormat(getCurrentLocale(), opts).format(date);
}

export function formatTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  const opts: Intl.DateTimeFormatOptions = options ?? {
    hour: "2-digit",
    minute: "2-digit",
  };
  return new Intl.DateTimeFormat(getCurrentLocale(), opts).format(date);
}

export function formatDateTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  const opts: Intl.DateTimeFormatOptions = options ?? {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  return new Intl.DateTimeFormat(getCurrentLocale(), opts).format(date);
}

export function formatRelative(value: Date | string | number): string {
  const date = toDate(value);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return i18n.t("common:justNow");
  }

  const locale = getCurrentLocale();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return rtf.format(-diffMin, "minute");
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return rtf.format(-diffHours, "hour");
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return rtf.format(-diffDays, "day");
  }

  return formatDate(date);
}

export function formatNumber(
  num: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getCurrentLocale(), options).format(num);
}

/**
 * Format a date for grouping headers: "Today", "Yesterday", or locale date+weekday.
 * Replaces the hardcoded zh/en formatDateGroup in date-utils.ts.
 */
export function formatDateGroup(date: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, now)) return i18n.t("common:today");
  if (sameDay(date, yesterday)) return i18n.t("common:yesterday");

  return new Intl.DateTimeFormat(getCurrentLocale(), {
    month: "short",
    day: "numeric",
    weekday: "long",
  }).format(date);
}
```

- [ ] **Step 3: Write tests**

```typescript
// apps/client/src/lib/__tests__/date-format.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/i18n", () => ({
  default: {
    language: "en",
    t: (key: string) => {
      const map: Record<string, string> = {
        "common:justNow": "just now",
        "common:today": "Today",
        "common:yesterday": "Yesterday",
      };
      return map[key] ?? key;
    },
  },
}));

import {
  getCurrentLocale,
  formatDate,
  formatTime,
  formatDateTime,
  formatRelative,
  formatNumber,
  formatDateGroup,
} from "../date-format";

describe("date-format", () => {
  it("getCurrentLocale returns en-US for en", () => {
    expect(getCurrentLocale()).toBe("en-US");
  });

  it("formatDate formats a date", () => {
    const result = formatDate(new Date("2026-04-10T00:00:00Z"));
    expect(result).toContain("2026");
    expect(result).toContain("April");
  });

  it("formatTime formats time", () => {
    const result = formatTime(new Date("2026-04-10T14:30:00Z"));
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("formatRelative returns 'just now' for recent times", () => {
    const result = formatRelative(new Date(Date.now() - 10_000));
    expect(result).toBe("just now");
  });

  it("formatRelative returns minutes for < 1 hour", () => {
    const result = formatRelative(new Date(Date.now() - 5 * 60_000));
    expect(result).toContain("5");
    expect(result).toContain("minute");
  });

  it("formatNumber formats numbers", () => {
    const result = formatNumber(1234567.89);
    expect(result).toContain("1,234,567");
  });

  it("formatDateGroup returns 'Today' for today", () => {
    expect(formatDateGroup(new Date())).toBe("Today");
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/lib/date-format.ts apps/client/src/lib/__tests__/date-format.test.ts apps/client/src/i18n/locales/en/common.json apps/client/src/i18n/locales/zh-CN/common.json
git commit -m "feat(i18n): add locale-aware date/time formatting utilities"
```

---

### Task 3: RelativeTime Component

**Goal:** Create a `<RelativeTime />` component with hover tooltip and click-to-toggle between relative and absolute time

**Files:**

- Create: `apps/client/src/components/ui/RelativeTime.tsx`
- Test: `apps/client/src/components/ui/__tests__/RelativeTime.test.tsx`

**Acceptance Criteria:**

- [ ] Displays relative time by default (e.g., "3 minutes ago")
- [ ] Hover shows tooltip with full absolute datetime
- [ ] Click toggles between relative and absolute display
- [ ] Auto-updates relative time (30s interval for < 1h, 60s for < 24h)
- [ ] Respects current i18n language for both formats

**Verify:** `cd apps/client && npx vitest run src/components/ui/__tests__/RelativeTime` → all pass

**Steps:**

- [ ] **Step 1: Create RelativeTime.tsx**

```tsx
// apps/client/src/components/ui/RelativeTime.tsx
import { useState, useEffect, useCallback } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRelative, formatDateTime } from "@/lib/date-format";

interface RelativeTimeProps {
  date: Date | string | number;
  className?: string;
}

function getUpdateInterval(date: Date): number {
  const diffMs = Date.now() - date.getTime();
  const diffMin = diffMs / 60_000;
  if (diffMin < 60) return 30_000; // every 30s
  if (diffMin < 1440) return 60_000; // every 1m
  return 0; // no auto-update for > 24h
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const dateObj = date instanceof Date ? date : new Date(date);
  const [showAbsolute, setShowAbsolute] = useState(false);
  const [, setTick] = useState(0);

  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const interval = getUpdateInterval(dateObj);
    if (interval === 0) return;
    const id = setInterval(forceUpdate, interval);
    return () => clearInterval(id);
  }, [dateObj, forceUpdate]);

  const absoluteText = formatDateTime(dateObj);
  const relativeText = formatRelative(dateObj);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={className}
          role="button"
          tabIndex={0}
          onClick={() => setShowAbsolute((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setShowAbsolute((v) => !v);
          }}
        >
          {showAbsolute ? absoluteText : relativeText}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {showAbsolute ? relativeText : absoluteText}
      </TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Write tests**

```tsx
// apps/client/src/components/ui/__tests__/RelativeTime.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RelativeTime } from "../RelativeTime";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/date-format", () => ({
  formatRelative: () => "5 minutes ago",
  formatDateTime: () => "April 10, 2026, 2:30 PM",
}));

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("RelativeTime", () => {
  it("renders relative time by default", () => {
    renderWithTooltip(<RelativeTime date={new Date()} />);
    expect(screen.getByText("5 minutes ago")).toBeTruthy();
  });

  it("toggles to absolute time on click", () => {
    renderWithTooltip(<RelativeTime date={new Date()} />);
    fireEvent.click(screen.getByText("5 minutes ago"));
    expect(screen.getByText("April 10, 2026, 2:30 PM")).toBeTruthy();
  });

  it("toggles back to relative on second click", () => {
    renderWithTooltip(<RelativeTime date={new Date()} />);
    const el = screen.getByText("5 minutes ago");
    fireEvent.click(el);
    fireEvent.click(screen.getByText("April 10, 2026, 2:30 PM"));
    expect(screen.getByText("5 minutes ago")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/ui/RelativeTime.tsx apps/client/src/components/ui/__tests__/RelativeTime.test.tsx
git commit -m "feat(i18n): add RelativeTime component with hover/click toggle"
```

---

### Task 4: Language Switcher UI Update

**Goal:** Update language switcher to show all 8 languages, use async loading, replace MainSidebar inline picker

**Files:**

- Modify: `apps/client/src/components/LanguageSwitcher.tsx`
- Modify: `apps/client/src/components/layout/MainSidebar.tsx:569-596`
- Modify: `apps/client/src/components/layout/__tests__/MainSidebar.user-menu.test.tsx`

**Acceptance Criteria:**

- [ ] `LanguageSwitcher` calls `changeLanguage()` from `loadLanguage.ts` (async with loading)
- [ ] MainSidebar inline language picker replaced with `<LanguageSwitcher variant="full" />`
- [ ] All 8 languages visible (no zh filter)
- [ ] Shows loading indicator during language switch

**Verify:** `cd apps/client && npx vitest run src/components/layout/__tests__/MainSidebar` → all pass

**Steps:**

- [ ] **Step 1: Update LanguageSwitcher.tsx**

Replace `i18n.changeLanguage(langCode)` with the async `changeLanguage` from `loadLanguage.ts`. Add loading state via `useLanguageLoading`.

```tsx
// apps/client/src/components/LanguageSwitcher.tsx
import { useTranslation } from "react-i18next";
import { Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supportedLanguages } from "@/i18n";
import { changeLanguage, useLanguageLoading } from "@/i18n/loadLanguage";
import { cn } from "@/lib/utils";

interface LanguageSwitcherProps {
  variant?: "icon" | "full";
  className?: string;
}

export function LanguageSwitcher({
  variant = "icon",
  className,
}: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation("settings");
  const { isLoading } = useLanguageLoading();

  const currentLanguage = supportedLanguages.find(
    (lang) => lang.code === i18n.language,
  );

  const handleLanguageChange = async (langCode: string) => {
    await changeLanguage(langCode);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={variant === "icon" ? "icon" : "default"}
          className={cn(
            "gap-2",
            variant === "full" &&
              "w-full justify-start px-4 py-2 text-sm hover:bg-accent",
            className,
          )}
        >
          {isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Globe size={16} />
          )}
          {variant === "full" && (
            <span className="flex-1 text-left">
              {t("language")}: {currentLanguage?.nativeName || i18n.language}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <div className="space-y-1">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            {t("selectLanguage")}
          </p>
          {supportedLanguages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              disabled={isLoading}
              className={cn(
                "w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-sm hover:bg-accent",
                i18n.language === lang.code && "bg-accent",
              )}
            >
              <span>{lang.nativeName}</span>
              {i18n.language === lang.code && (
                <span className="text-primary">✓</span>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Replace MainSidebar inline language picker (lines 569-596)**

Remove the entire `{/* Language Switcher */}` block (lines 569-596) and replace with:

```tsx
<Separator />;
{
  /* Language Switcher */
}
<div className="py-1">
  <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground">
    {tSettings("language")}
  </div>
  {supportedLanguages.map((lang) => (
    <button
      key={lang.code}
      onClick={() => changeLanguage(lang.code)}
      className={cn(
        "w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-accent",
        i18n.language === lang.code && "bg-accent",
      )}
    >
      <div className="flex items-center gap-3">
        <Globe size={16} />
        <span>{lang.nativeName}</span>
      </div>
      {i18n.language === lang.code && <span className="text-primary">✓</span>}
    </button>
  ))}
</div>;
```

Add import at top of MainSidebar: `import { changeLanguage } from "@/i18n/loadLanguage";`

Remove the `lang.code === "zh" ? <></> :` filter — show all languages.

- [ ] **Step 3: Update MainSidebar tests**

Update `MainSidebar.user-menu.test.tsx` mock of `supportedLanguages` to include all 8 entries with `zh-CN` instead of `zh`.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/LanguageSwitcher.tsx apps/client/src/components/layout/MainSidebar.tsx apps/client/src/components/layout/__tests__/
git commit -m "feat(i18n): update language switcher for 8 languages with async loading"
```

---

### Task 5: P0 Dialog i18n Completion

**Goal:** Wire up 5 dialog components to use existing and new i18n keys

**Files:**

- Modify: `apps/client/src/components/dialog/CreateChannelDialog.tsx`
- Modify: `apps/client/src/components/dialog/DeleteChannelDialog.tsx`
- Modify: `apps/client/src/components/dialog/CreateWorkspaceDialog.tsx`
- Modify: `apps/client/src/components/dialog/NewMessageDialog.tsx`
- Modify: `apps/client/src/components/dialog/AHandSetupDialog.tsx`
- Modify: `apps/client/src/i18n/locales/en/channel.json` (add missing keys)
- Modify: `apps/client/src/i18n/locales/zh-CN/channel.json`
- Modify: `apps/client/src/i18n/locales/en/workspace.json` (add missing keys)
- Modify: `apps/client/src/i18n/locales/zh-CN/workspace.json`
- Modify: `apps/client/src/i18n/locales/en/message.json` (add missing keys)
- Modify: `apps/client/src/i18n/locales/zh-CN/message.json`
- Modify: `apps/client/src/i18n/locales/en/common.json` (add missing keys)
- Modify: `apps/client/src/i18n/locales/zh-CN/common.json`

**Acceptance Criteria:**

- [ ] All 5 dialogs use `useTranslation()` with no hardcoded user-facing strings
- [ ] New keys added to both en/ and zh-CN/ JSON files
- [ ] Existing keys reused where they match (e.g., `channel.createChannel`, `message.newMessage`)

**Verify:** `cd apps/client && npx vitest run` → no regressions; visually check dialogs in en and zh-CN

**Steps:**

- [ ] **Step 1: Add missing keys to en/channel.json**

Many keys already exist (`createChannel`, `channelNameRequired`, etc.). Add only those that don't:

```json
{
  "channelNameTooLong": "Channel name must be 80 characters or less",
  "willBeCreatedAs": "Will be created as:",
  "selectVisibilityFor": "Select who can see and join #{{name}}",
  "selected": "Selected",
  "publicVisibilityDescription": "Anyone in your workspace can view and join this channel.",
  "privateVisibilityDescription": "Only invited members can see and join this channel.",
  "deleteChannelTitle": "Delete #{{name}}",
  "deleteChannelWarningDetail": "This action cannot be undone. All messages in this channel will be permanently deleted.",
  "deleteWarningIntro": "Deleting this channel will:",
  "deleteWarningMessages": "Remove all messages and files",
  "deleteWarningMembers": "Remove all members from the channel",
  "deleteWarningIrreversible": "This cannot be recovered",
  "typeToConfirm": "Type <bold>{{name}}</bold> to confirm",
  "enterChannelName": "Enter channel name",
  "permanentlyDelete": "Permanently delete (cannot be recovered)",
  "deleting": "Deleting..."
}
```

Add corresponding zh-CN translations to `zh-CN/channel.json`.

- [ ] **Step 2: Add missing keys to en/workspace.json**

```json
{
  "createWorkspace": "Create a workspace",
  "createWorkspaceDescription": "Workspaces are where your team collaborates. Create one for your team, project, or organization.",
  "workspaceUrl": "URL:",
  "creatingWorkspace": "Creating...",
  "createWorkspaceFailed": "Failed to create workspace. Please try again."
}
```

Add corresponding zh-CN translations.

- [ ] **Step 3: Add missing keys to en/message.json**

```json
{
  "selectUserToStart": "Select a user to start a direct conversation"
}
```

Add corresponding zh-CN translation.

- [ ] **Step 4: Add missing keys to en/common.json**

```json
{
  "selected": "Selected",
  "warning": "Warning:",
  "seconds": "s"
}
```

Add corresponding zh-CN translations.

- [ ] **Step 5: Convert CreateChannelDialog.tsx**

Add `import { useTranslation } from "react-i18next";` and `const { t } = useTranslation("channel");` at the top of the component.

Replace hardcoded strings with `t()` calls. Example replacements:

- `"Channel name is required"` → `t("channelNameRequired")`
- `"Channel name must be 80 characters or less"` → `t("channelNameTooLong")`
- `"Must start with a letter or number"` → `t("channelNameInvalid")`
- `"Create a channel"` → `t("createChannel")`
- `"Name"` → `t("channelName")` (existing key, maps to "Channel name")
- `"e.g. marketing"` → `t("channelNamePlaceholder")`
- `"What's this channel about?"` → `t("channelDescriptionPlaceholder")`
- `"Cancel"` → `t("common:cancel")`
- `"Next"` → `t("common:next")`
- `"Back"` → `t("common:back")`
- `"Creating..."` / `"Create Channel"` → `t("creating")` / `t("createChannel")`
- `"Choose visibility"` → `t("chooseVisibility")`
- `"Public"` → `t("public")`
- `"Private"` → `t("private")`
- `"Selected"` → `t("common:selected")`

- [ ] **Step 6: Convert DeleteChannelDialog.tsx**

Add `useTranslation("channel")`. Replace:

- `"Delete #..."` → `t("deleteChannelTitle", { name: channel.name })`
- Warning text → `t("deleteChannelWarningDetail")`
- List items → `t("deleteWarningMessages")`, `t("deleteWarningMembers")`, `t("deleteWarningIrreversible")`
- `"Enter channel name"` → `t("enterChannelName")`
- `"Permanently delete..."` → `t("permanentlyDelete")`
- `"Cancel"` → `t("common:cancel")`
- `"Deleting..."` / `"Delete Channel"` → `t("deleting")` / `t("deleteChannel")`

- [ ] **Step 7: Convert CreateWorkspaceDialog.tsx**

Add `useTranslation("workspace")`. Replace:

- `"Workspace name is required"` → `t("workspace:nameTooShort")` (reuse existing)
- `"Name must be at least 2 characters"` → `t("nameTooShort")`
- `"Name must be 100 characters or less"` → `t("nameTooLong")`
- `"Create a workspace"` → `t("createWorkspace")`
- `"e.g. Acme Inc"` → use a new key or inline
- `"Cancel"` → `t("common:cancel")`
- `"Creating..."` / `"Create Workspace"` → `t("creatingWorkspace")` / `t("createWorkspace")`

- [ ] **Step 8: Convert NewMessageDialog.tsx**

Add `useTranslation("message")`. Most keys already exist:

- `"New Message"` → `t("newMessage")`
- `"Search by username or email..."` → `t("searchUsers")`
- `"Searching..."` → `t("searching")`
- `"Enter username or email to search"` → `t("enterToSearch")`
- `"No users found"` → `t("noUsersFound")`
- `"Select a user to start a direct conversation"` → `t("selectUserToStart")`

- [ ] **Step 9: Convert AHandSetupDialog.tsx**

Add `useTranslation("resources")`. Add new keys to `en/resources.json`:

```json
{
  "localDeviceSetup": "Local Device Setup",
  "ahandConnection": "aHand Connection",
  "browserComponents": "Browser Components",
  "activation": "Activation"
}
```

Replace hardcoded strings. `"Retry"` → `t("common:retry")`. `"s"` → `t("common:seconds")`.

- [ ] **Step 10: Commit**

```bash
git add apps/client/src/components/dialog/ apps/client/src/i18n/locales/
git commit -m "feat(i18n): convert P0 dialogs to use translation keys"
```

---

### Task 6: P0 Auth Routes i18n Completion

**Goal:** Fix remaining hardcoded strings in auth-related routes

**Files:**

- Modify: `apps/client/src/routes/login.tsx`
- Modify: `apps/client/src/routes/confirm-email-change.tsx`
- Modify: `apps/client/src/i18n/locales/en/auth.json` (add missing keys)
- Modify: `apps/client/src/i18n/locales/zh-CN/auth.json`

**Acceptance Criteria:**

- [ ] login.tsx: "Team collaboration, reimagined", "Gmail", "Outlook", "Dev Mode", "Team9 logo" alt text all use t()
- [ ] confirm-email-change.tsx: inline default strings removed, uses keys from auth.json

**Verify:** `cd apps/client && npx vitest run src/routes/` → no regressions

**Steps:**

- [ ] **Step 1: Add missing keys to en/auth.json**

```json
{
  "tagline": "Team collaboration, reimagined",
  "logoAlt": "Team9 logo",
  "devMode": "Dev Mode",
  "gmail": "Gmail",
  "outlook": "Outlook"
}
```

Add corresponding zh-CN translations.

- [ ] **Step 2: Fix login.tsx**

login.tsx already uses `useTranslation("auth")`. Replace remaining hardcoded strings:

- `"Team collaboration, reimagined"` → `t("tagline")`
- `"Team9 logo"` → `t("logoAlt")`
- `"Gmail"` / `"Outlook"` → `t("gmail")` / `t("outlook")`
- `"Dev Mode"` → `t("devMode")`
- `"continue_with"` (Google button text prop) — this is a Google Sign-In SDK parameter, leave as-is

- [ ] **Step 3: Fix confirm-email-change.tsx**

Already uses `t()` with inline defaults (e.g., `t("confirmEmailChangeTitle", "Confirm your new email address")`). The keys already exist in auth.json. Remove the inline default strings — they're redundant since auth.json has them.

Example: `t("confirmEmailChangeTitle", "Confirm your new email address")` → `t("confirmEmailChangeTitle")`

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/routes/login.tsx apps/client/src/routes/confirm-email-change.tsx apps/client/src/i18n/locales/
git commit -m "feat(i18n): complete auth route i18n coverage"
```

---

### Task 7: P1-P2 Component i18n Completion

**Goal:** Convert channel, layout, and sidebar components to use i18n

**Files:**

- Modify: `apps/client/src/components/channel/SelectionCopyPopup.tsx`
- Modify: `apps/client/src/components/channel/ChannelView.tsx`
- Modify: `apps/client/src/components/channel/ThreadReplyIndicator.tsx`
- Modify: `apps/client/src/components/channel/ChannelDetailsModal.tsx`
- Modify: `apps/client/src/components/layout/sidebars/FilesSubSidebar.tsx`
- Modify: `apps/client/src/components/layout/sidebars/MoreSubSidebar.tsx`
- Modify: `apps/client/src/components/layout/sidebars/MessagesSubSidebar.tsx`
- Modify: `apps/client/src/components/layout/MainContent.tsx`
- Modify: `apps/client/src/components/layout/contents/ApplicationMainContent.tsx`
- Modify: `apps/client/src/components/layout/contents/ApplicationDetailContent.tsx`
- Modify: Various `en/*.json` and `zh-CN/*.json` (add missing keys)

**Acceptance Criteria:**

- [ ] All listed components use `useTranslation()` with no hardcoded user-facing strings
- [ ] ThreadReplyIndicator relative time replaced with `formatRelative` from `date-format.ts`
- [ ] ChannelDetailsModal date replaced with `formatDate` from `date-format.ts`

**Verify:** `cd apps/client && npx vitest run` → no regressions

**Steps:**

- [ ] **Step 1: Add missing keys to en/common.json**

```json
{
  "copied": "Copied",
  "copy": "Copy",
  "channelNotFound": "Channel not found"
}
```

- [ ] **Step 2: Add missing keys to en/navigation.json**

```json
{
  "files": "Files",
  "settings": "Settings",
  "startConversation": "Start a conversation",
  "noMessagesYet": "No messages yet",
  "installedApps": "Installed Apps",
  "availableApps": "Available Apps",
  "install": "Install",
  "noAppsAvailable": "No apps available",
  "appSettings": "App Settings",
  "failedToLoadApp": "Failed to load application details"
}
```

Add corresponding zh-CN translations for all new keys.

- [ ] **Step 3: Convert each component**

For each component, add `useTranslation(namespace)` and replace hardcoded strings:

**SelectionCopyPopup.tsx** → `useTranslation("common")`:

- `"Copied"` → `t("copied")`
- `"Copy"` → `t("copy")`

**ChannelView.tsx** → `useTranslation("common")`:

- `"Channel not found"` → `t("channelNotFound")`

**ThreadReplyIndicator.tsx** → replace inline relative time logic (lines 96-100) with `formatRelative()` from `date-format.ts`. Remove the hardcoded `"just now"`, `"Xm"`, `"Xh"`, `"Xd"` strings.

**ChannelDetailsModal.tsx** → replace `new Date(channel.createdAt).toLocaleDateString()` with `formatDate(channel.createdAt)` from `date-format.ts`.

**FilesSubSidebar.tsx** → `useTranslation("navigation")`:

- `"Files"` → `t("files")` (key already exists)

**MoreSubSidebar.tsx** → `useTranslation("navigation")`:

- `"Settings"` → `t("settings")` (use existing key or add to navigation)
- `"More"` → `t("more")` (key already exists)

**MessagesSubSidebar.tsx** → `useTranslation("navigation")`:

- `"Direct Messages"` → `t("directMessages")` (key already exists)
- `"Loading..."` → `t("common:loading")`
- `"Start a conversation"` → `t("startConversation")`
- `"No messages yet"` → `t("noMessagesYet")`

**MainContent.tsx** → `useTranslation("channel")`:

- `"general"` → this is a channel name, not a translatable string — leave as-is if it's data-driven

**ApplicationMainContent.tsx** → `useTranslation("navigation")`:

- `"Apps"` → `t("apps")` (key already exists)
- `"Installed Apps"` → `t("installedApps")`
- `"Available Apps"` → `t("availableApps")`
- `"Install"` → `t("install")`
- `"No apps available"` → `t("noAppsAvailable")`

**ApplicationDetailContent.tsx** → `useTranslation("navigation")`:

- `"App Settings"` → `t("appSettings")`
- `"Failed to load..."` → `t("failedToLoadApp")`

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/channel/ apps/client/src/components/layout/ apps/client/src/i18n/locales/
git commit -m "feat(i18n): convert P1-P2 channel and layout components"
```

---

### Task 8: P3 Component i18n Completion

**Goal:** Convert AI Staff, subscription, and remaining components to use i18n

**Files:**

- Modify: `apps/client/src/components/ai-staff/StaffBadgeCard2D.tsx`
- Modify: `apps/client/src/components/ai-staff/CreateCommonStaffDialog.tsx`
- Modify: `apps/client/src/components/ai-staff/PersonalStaffDetailSection.tsx`
- Modify: `apps/client/src/components/ai-staff/CommonStaffDetailSection.tsx`
- Modify: `apps/client/src/components/layout/contents/SubscriptionContent.tsx`
- Modify: `apps/client/src/i18n/locales/en/skills.json` (add missing keys)
- Modify: `apps/client/src/i18n/locales/zh-CN/skills.json`
- Modify: `apps/client/src/i18n/locales/en/settings.json` (add subscription keys)
- Modify: `apps/client/src/i18n/locales/zh-CN/settings.json`

**Acceptance Criteria:**

- [ ] All AI Staff components use `useTranslation("skills")` with no hardcoded strings
- [ ] SubscriptionContent uses `useTranslation("settings")` with no hardcoded strings
- [ ] CreateCommonStaffDialog's ~25 hardcoded strings fully converted

**Verify:** `cd apps/client && npx vitest run` → no regressions

**Steps:**

- [ ] **Step 1: Add missing keys to en/skills.json**

```json
{
  "mentor": "Mentor",
  "noMentorAssigned": "No mentor assigned",
  "clickToFlip": "Click to flip",
  "about": "About",
  "persona": "Persona",
  "noPersonaDescription": "No persona description available.",
  "model": "Model",
  "personalAssistant": "Personal Assistant",
  "commonStaff": "Common Staff",
  "openClawInstance": "OpenClaw Instance",
  "openClawAgent": "OpenClaw Agent",
  "usernameAvailable": "Username is available",
  "styleRealistic": "Realistic",
  "styleCartoon": "Cartoon",
  "styleAnime": "Anime",
  "styleNotionLineArt": "Notion Line Art",
  "staffDetails": "Staff Details",
  "created": "Created"
}
```

Add corresponding zh-CN translations.

- [ ] **Step 2: Add missing keys to en/settings.json**

```json
{
  "subscription": "Subscription",
  "subscriptionRequired": "Subscription Required",
  "date": "Date",
  "amount": "Amount",
  "credits": "Credits",
  "actions": "Actions"
}
```

Add corresponding zh-CN translations.

- [ ] **Step 3: Convert each AI Staff component**

**StaffBadgeCard2D.tsx** → `useTranslation("skills")`:

- `"Mentor"` → `t("mentor")`
- `"No mentor assigned"` → `t("noMentorAssigned")`
- `"Click to flip"` → `t("clickToFlip")`
- `"About"` → `t("about")`
- `"Persona"` → `t("persona")`
- `"Model"` → `t("model")`

**CreateCommonStaffDialog.tsx** → `useTranslation("skills")`:

- Convert all ~25 hardcoded labels, placeholders, and option texts using the keys from Step 1
- Style options: `"Realistic"` → `t("styleRealistic")`, etc.

**PersonalStaffDetailSection.tsx** → `useTranslation("skills")`:

- `"Personal Assistant"` → `t("personalAssistant")`
- Date display: replace `.toLocaleString()` with `formatDateTime()` from `date-format.ts`

**CommonStaffDetailSection.tsx** → `useTranslation("skills")`:

- `"Common Staff"` → `t("commonStaff")`
- Date display: replace `.toLocaleString()` with `formatDateTime()` from `date-format.ts`

- [ ] **Step 4: Convert SubscriptionContent.tsx**

Add `useTranslation("settings")`. Replace:

- Hardcoded `Intl.DateTimeFormat("en-US", ...)` → `formatDate()` / `formatDateTime()` from `date-format.ts`
- Table headers (`"Date"`, `"Amount"`, etc.) → `t("date")`, `t("amount")`, etc.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/ai-staff/ apps/client/src/components/layout/contents/SubscriptionContent.tsx apps/client/src/i18n/locales/
git commit -m "feat(i18n): convert P3 AI Staff and subscription components"
```

---

### Task 9: Fix Date Formatting Across Components

**Goal:** Replace all hardcoded locale date formatting with utilities from `date-format.ts`

**Files:**

- Modify: `apps/client/src/lib/date-utils.ts` (refactor `formatDateGroup`, `formatDistanceToNow`)
- Modify: `apps/client/src/components/layout/contents/LibraryMainContent.tsx`
- Modify: `apps/client/src/components/document/VersionHistory.tsx`
- Modify: `apps/client/src/components/document/SuggestionList.tsx`
- Modify: `apps/client/src/components/applications/config-panels/OpenClawConfigPanel.tsx`
- Modify: `apps/client/src/components/layout/contents/AIStaffDetailContent.tsx`
- Modify: `apps/client/src/components/resources/ResourceDetailPanel.tsx`
- Modify: `apps/client/src/components/routines/RoutineTriggersTab.tsx`
- Modify: `apps/client/src/components/routines/RunItem.tsx`
- Modify: `apps/client/src/components/routines/ChatArea.tsx`
- Modify: `apps/client/src/components/routines/RunTab.tsx`
- Modify: `apps/client/src/components/routines/ExecutionTimeline.tsx`
- Modify: `apps/client/src/routes/invite.$code.tsx`
- Modify: `apps/client/src/components/search/SearchPage.tsx`
- Modify: `apps/client/src/components/channel/TrackingCard.tsx`

**Acceptance Criteria:**

- [ ] Zero hardcoded `Intl.DateTimeFormat("en-US", ...)` calls remain
- [ ] Zero bare `.toLocaleString()` / `.toLocaleDateString()` / `.toLocaleTimeString()` calls remain
- [ ] `date-utils.ts` `formatDateGroup` refactored to use `formatDateGroup` from `date-format.ts`
- [ ] `date-utils.ts` `formatDistanceToNow` refactored to use `formatRelative` from `date-format.ts`

**Verify:** `cd apps/client && grep -rn "toLocaleString\|toLocaleDateString\|toLocaleTimeString\|DateTimeFormat.*en-US" src/components src/routes --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v __tests__` → no results (except intentional overrides)

**Steps:**

- [ ] **Step 1: Refactor date-utils.ts**

Replace `formatDistanceToNow` with a re-export from `date-format.ts`:

```typescript
// At top of date-utils.ts:
import {
  formatRelative,
  formatDateGroup as formatDateGroupIntl,
} from "./date-format";

// Replace the function body:
export function formatDistanceToNow(date: Date): string {
  return formatRelative(date);
}

// Replace formatDateGroup:
export { formatDateGroupIntl as formatDateGroup };
// Remove the old formatDateGroup function, zhDayNames, enDayNames arrays
```

Update `groupByDate` to remove the `locale` parameter — it now reads from i18n automatically.

- [ ] **Step 2: Fix all .toLocaleString() calls**

For each file, add `import { formatDateTime } from "@/lib/date-format";` and replace:

```typescript
// Before:
new Date(dateStr).toLocaleString();

// After:
formatDateTime(dateStr);
```

Files: LibraryMainContent, CommonStaffDetailSection, PersonalStaffDetailSection, VersionHistory, SuggestionList, OpenClawConfigPanel, AIStaffDetailContent, ResourceDetailPanel (line 759), RunItem, ChatArea (lines 284, 309), RunTab.

- [ ] **Step 3: Fix .toLocaleDateString() calls**

```typescript
// Before:
new Date(date).toLocaleDateString();

// After:
import { formatDate } from "@/lib/date-format";
formatDate(date);
```

Files: invite.$code.tsx, SearchPage.tsx (lines 347, 463), ChannelDetailsModal.tsx.

- [ ] **Step 4: Fix .toLocaleTimeString() call**

ExecutionTimeline.tsx:

```typescript
// Before:
new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// After:
import { formatTime } from "@/lib/date-format";
formatTime(iso);
```

- [ ] **Step 5: Fix RoutineTriggersTab.tsx**

Lines 202, 216 pass `toLocaleString()` results into i18n interpolation. Replace with `formatDateTime()`:

```typescript
// Before:
time: new Date(trigger.nextRunAt).toLocaleString();

// After:
time: formatDateTime(trigger.nextRunAt);
```

- [ ] **Step 6: Fix TrackingCard.tsx**

Line 72 has hardcoded `${minutes}m ${String(seconds).padStart(2, "0")}s` format. Replace with locale-aware formatting using `Intl.RelativeTimeFormat` or keep as numeric display (elapsed time counters are typically locale-neutral).

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/lib/date-utils.ts apps/client/src/lib/date-format.ts apps/client/src/components/ apps/client/src/routes/
git commit -m "refactor(i18n): replace all hardcoded date formatting with locale-aware utilities"
```

---

### Task 10: Generate Translation Files for All Languages

**Goal:** Create translation JSON files for zh-TW, ja, ko, es, fr, de (6 new languages × 12 namespaces = 72 files)

**Files:**

- Create: `apps/client/src/i18n/locales/zh-TW/*.json` (12 files)
- Create: `apps/client/src/i18n/locales/ja/*.json` (12 files)
- Create: `apps/client/src/i18n/locales/ko/*.json` (12 files)
- Create: `apps/client/src/i18n/locales/es/*.json` (12 files)
- Create: `apps/client/src/i18n/locales/fr/*.json` (12 files)
- Create: `apps/client/src/i18n/locales/de/*.json` (12 files)

**Acceptance Criteria:**

- [ ] All 72 JSON files exist with correct structure matching en/
- [ ] zh-TW uses proper Traditional Chinese vocabulary (not just character conversion)
- [ ] All keys from en/ are present in every language file
- [ ] No missing keys, no extra keys
- [ ] JSON is valid and properly formatted

**Verify:** Write a quick validation script:

```bash
cd apps/client/src/i18n/locales
for lang in zh-TW ja ko es fr de; do
  for ns in common auth navigation channel message settings thread workspace routines resources skills onboarding; do
    if [ ! -f "$lang/$ns.json" ]; then echo "MISSING: $lang/$ns.json"; fi
    # Check key count matches en
    en_keys=$(jq 'paths | length' en/$ns.json)
    lang_keys=$(jq 'paths | length' $lang/$ns.json 2>/dev/null || echo 0)
    if [ "$en_keys" != "$lang_keys" ]; then echo "KEY MISMATCH: $lang/$ns.json (en=$en_keys, $lang=$lang_keys)"; fi
  done
done
```

**Steps:**

- [ ] **Step 1: Create directories**

```bash
cd apps/client/src/i18n/locales
mkdir -p zh-TW ja ko es fr de
```

- [ ] **Step 2: Generate zh-TW translations**

For each of the 12 namespace files, take the zh-CN version and generate Traditional Chinese with proper vocabulary adaptation. This is NOT simple character conversion — use proper Taiwanese Chinese terminology:

- 文件 → 檔案, 信息 → 訊息, 用户 → 使用者, 设置 → 設定, 频道 → 頻道

Process each namespace file one at a time. For each: read en/ and zh-CN/ versions for context, generate zh-TW version matching the en/ key structure exactly.

- [ ] **Step 3: Generate ja translations**

For each of the 12 namespace files, translate from en/ to Japanese. Use natural Japanese UI conventions:

- Buttons: concise (保存, キャンセル, 削除)
- Descriptions: polite form (です/ます)
- Technical terms: use katakana where conventional (チャンネル, メッセージ)

- [ ] **Step 4: Generate ko translations**

For each of the 12 namespace files, translate from en/ to Korean. Use natural Korean UI conventions:

- Formal polite style (합니다/습니다) for descriptions
- Standard Korean IT terminology (채널, 메시지, 워크스페이스)

- [ ] **Step 5: Generate es translations**

For each of the 12 namespace files, translate from en/ to Spanish (Latin American neutral). Use neutral register for UI text.

- [ ] **Step 6: Generate fr translations**

For each of the 12 namespace files, translate from en/ to French. Use vous form, standard French UI conventions.

- [ ] **Step 7: Generate de translations**

For each of the 12 namespace files, translate from en/ to German. Use Sie form, standard German UI conventions.

- [ ] **Step 8: Validate all files**

Run the verification script from the Acceptance Criteria section. Fix any missing keys or structural mismatches.

- [ ] **Step 9: Commit**

```bash
git add apps/client/src/i18n/locales/zh-TW/ apps/client/src/i18n/locales/ja/ apps/client/src/i18n/locales/ko/ apps/client/src/i18n/locales/es/ apps/client/src/i18n/locales/fr/ apps/client/src/i18n/locales/de/
git commit -m "feat(i18n): add translations for zh-TW, ja, ko, es, fr, de"
```

---

## Task Dependencies

```
Task 1 (Infrastructure) ──┬──→ Task 4 (Language Switcher)
                          ├──→ Task 5 (P0 Dialogs)
                          ├──→ Task 6 (P0 Auth)
                          ├──→ Task 7 (P1-P2 Components)
                          └──→ Task 8 (P3 Components)

Task 2 (Date Utils) ──────→ Task 3 (RelativeTime) ──→ Task 9 (Date Fixes)

Tasks 5-8 (all component work) ──→ Task 10 (Translation Generation)
Task 9 (Date Fixes) ──────────────→ Task 10 (Translation Generation)
```

Task 10 must be last — it translates the finalized en/ JSON files after all new keys are added.
