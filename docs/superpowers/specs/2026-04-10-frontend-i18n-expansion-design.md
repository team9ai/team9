# Frontend i18n Expansion Design

**Date:** 2026-04-10
**Status:** Approved

## Overview

Expand Team9's frontend i18n from 2 languages (en, zh) to 8 languages, complete i18n coverage for all components, add a unified date/time formatting system, and improve the language switching UX.

## Scope

| Module               | Description                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| Language system      | 8 languages, split zh → zh-CN/zh-TW, backward-compatible migration              |
| Loading mechanism    | en statically bundled, others lazy-loaded via Vite dynamic import               |
| Translation files    | 8 × 12 = 96 JSON files, AI-generated translations                               |
| Component completion | ~87 un-i18n-ized files fully converted                                          |
| Date/time utilities  | Unified `date-format.ts` + `<RelativeTime />` component                         |
| Language switcher UI | Unified `LanguageSwitcher`, enable LanguageDetector, default to system language |

## 1. Language System

### Supported Languages

| Code    | Name                | Native Name | Status              |
| ------- | ------------------- | ----------- | ------------------- |
| `en`    | English             | English     | Existing (fallback) |
| `zh-CN` | Chinese Simplified  | 简体中文    | Migrated from `zh`  |
| `zh-TW` | Chinese Traditional | 繁體中文    | New                 |
| `ja`    | Japanese            | 日本語      | New                 |
| `ko`    | Korean              | 한국어      | New                 |
| `es`    | Spanish             | Español     | New                 |
| `fr`    | French              | Français    | New                 |
| `de`    | German              | Deutsch     | New                 |

### zh → zh-CN Migration

- Rename `locales/zh/` → `locales/zh-CN/` (content is already Simplified Chinese)
- Update all static imports referencing `zh`
- Replace `zh` with `zh-CN` in `supportedLngs` config
- Backward compatibility: on init, detect `localStorage.i18nextLng === "zh"` and remap to `"zh-CN"`

### supportedLanguages Export

```typescript
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
```

### Type Safety

- `i18next.d.ts` uses `en` resources as the type basis (since en is the statically imported fallback)
- All other language JSON files must match the en structure (enforced by the translation generation process)

## 2. Dynamic Loading Mechanism

### Architecture

- **en** remains statically imported — guarantees instant first render with no loading delay
- **All other 7 languages** are lazy-loaded via Vite `import.meta.glob()` dynamic imports
- Each language's JSON files become separate Vite chunks, loaded on demand

### loadLanguage Function

```typescript
// src/i18n/loadLanguage.ts
import i18n from "i18next";

const namespaces = [
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

const modules = import.meta.glob("./locales/*/*.json");

export async function loadLanguage(lang: string): Promise<void> {
  // en is statically bundled, skip
  if (lang === "en") return;

  // Already loaded, skip
  if (i18n.hasResourceBundle(lang, "common")) return;

  const loadPromises = namespaces.map(async (ns) => {
    const path = `./locales/${lang}/${ns}.json`;
    const loader = modules[path];
    if (loader) {
      const mod = (await loader()) as { default?: Record<string, string> };
      i18n.addResourceBundle(lang, ns, mod.default || mod);
    }
  });

  await Promise.all(loadPromises);
}
```

### Loading Triggers

1. **Initialization:** After `i18n.init()`, if detected/stored language is not `en`, call `await loadLanguage(lang)` before rendering
2. **Language switch:** `await loadLanguage(lang)` then `i18n.changeLanguage(lang)`
3. **Loading state:** Expose a `useLanguageLoading()` hook for UI feedback during switch

### zh Backward Compatibility

```typescript
// Run before i18n.init()
const stored = localStorage.getItem("i18nextLng");
if (stored === "zh") {
  localStorage.setItem("i18nextLng", "zh-CN");
}
```

### Vite Build Behavior

- `import.meta.glob("./locales/*/*.json")` causes Vite to generate independent chunks per JSON file
- Initial bundle includes only `en/` (12 JSON files)
- Language switch triggers on-demand chunk requests (typically < 10KB per namespace)

## 3. Translation File Generation

### Strategy

| Language | Source         | Method                                                                                                  |
| -------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `zh-CN`  | Existing `zh/` | Direct copy (already Simplified Chinese)                                                                |
| `zh-TW`  | `zh-CN/`       | AI conversion with vocabulary adaptation (not simple character conversion — e.g., 文件→檔案, 信息→訊息) |
| `ja`     | `en/`          | AI translation                                                                                          |
| `ko`     | `en/`          | AI translation                                                                                          |
| `es`     | `en/`          | AI translation                                                                                          |
| `fr`     | `en/`          | AI translation                                                                                          |
| `de`     | `en/`          | AI translation                                                                                          |

### Directory Structure

```
src/i18n/locales/
├── en/           # Existing, unchanged — serves as structure baseline
├── zh-CN/        # Renamed from zh/
├── zh-TW/        # New
├── ja/           # New
├── ko/           # New
├── es/           # New
├── fr/           # New
└── de/           # New
```

Each directory contains the same 12 namespace files:
`common.json`, `auth.json`, `navigation.json`, `channel.json`, `message.json`, `settings.json`, `thread.json`, `workspace.json`, `routines.json`, `resources.json`, `skills.json`, `onboarding.json`

## 4. Component i18n Completion (~87 Files)

### Priority Batches

**P0 — Core Interactions (Dialogs + Auth): ~10 files**

- `CreateChannelDialog.tsx`, `DeleteChannelDialog.tsx`, `CreateWorkspaceDialog.tsx`, `NewMessageDialog.tsx`, `AHandSetupDialog.tsx`
- Auth routes: `login.tsx`, `register.tsx`, `verify-email.tsx`, `confirm-email-change.tsx`

**P1 — Channel Core: ~26 files**

- `ChannelHeader.tsx`, `ChannelContent.tsx`, `ChannelView.tsx`, `MessageReactions.tsx`, `TrackingCard.tsx`, etc.

**P2 — Layout & Sidebar: ~19 files**

- `MainSidebar.tsx`, `MainContent.tsx`, `DynamicSubSidebar.tsx`, etc.

**P3 — AI Staff + Documents + Route Pages: ~32 files**

- AI Staff components, document components, feature route pages

### Per-File Process

1. Extract hardcoded user-facing strings
2. Determine target namespace (based on component's functional module)
3. Generate translation keys following existing naming convention (e.g., `profileCard.title`, `emailCard.invalidEmail`)
4. Add keys to `en/*.json` with English values
5. Replace hardcoded strings in component with `useTranslation(namespace)` + `t("key")`
6. Sync all 8 language translation files

### Namespace Assignment

No new namespaces needed. Existing 12 namespaces cover all modules:

- Dialog components → corresponding module namespace (e.g., `CreateChannelDialog` → `channel`)
- AI Staff components → `skills`
- Auth routes → `auth`
- Layout components → `navigation`

## 5. Date/Time Formatting System

### Unified Utility: `src/lib/date-format.ts`

```typescript
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

function getCurrentLocale(): string {
  return localeMap[i18n.language] || "en-US";
}
```

### Exported Functions

- `formatDate(date, options?)` — date only (e.g., "April 10, 2026" / "2026年4月10日")
- `formatTime(date, options?)` — time only (e.g., "2:30 PM" / "14:30")
- `formatDateTime(date, options?)` — full date+time
- `formatRelative(date)` — relative time string (see rules below)
- `formatNumber(num, options?)` — locale-aware number formatting

All functions use `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` / `Intl.NumberFormat` with `getCurrentLocale()`.

### Relative Time Rules

| Condition  | Display                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| < 1 minute | "just now" / "刚刚" (special case via i18n key `common.justNow`, not Intl API) |
| < 1 hour   | "X minutes ago" / "X 分钟前"                                                   |
| < 24 hours | "X hours ago" / "X 小时前"                                                     |
| < 7 days   | "X days ago" / "X 天前"                                                        |
| ≥ 7 days   | Full date via `formatDate()`                                                   |

### `<RelativeTime />` Component

```typescript
// src/components/ui/RelativeTime.tsx
interface RelativeTimeProps {
  date: Date | string | number;
  className?: string;
}
```

Behavior:

- Default: displays relative time text (e.g., "3 minutes ago")
- **Hover:** tooltip shows full absolute datetime (e.g., "2026-04-10 14:32:05")
- **Click:** toggles between relative and absolute display; clicking again toggles back
- Auto-updates relative time on a reasonable interval (every 30s for < 1h, every 1m for < 24h, etc.)
- Both relative and absolute formats respect current i18n language

### Files to Fix

Replace hardcoded locales and bare `.toLocaleString()` calls:

- `SubscriptionContent.tsx` — hardcoded `Intl.DateTimeFormat("en-US", ...)`
- `AIStaffDetailContent.tsx`, `LibraryMainContent.tsx`, `ResourceDetailPanel.tsx`, etc. — `.toLocaleString()` without locale parameter

## 6. Language Switcher UI

### Changes

1. **Enable LanguageDetector:** Uncomment `i18n.use(LanguageDetector)` in `i18n/index.ts`
   - Detection order: `localStorage` → `navigator` → `htmlTag`
   - Default behavior: use system/browser language on first visit
   - After manual selection: persist to `localStorage`, takes priority on subsequent visits

2. **Unify LanguageSwitcher component:** Remove inline language selection in `MainSidebar.tsx`, use the existing `LanguageSwitcher.tsx` component instead

3. **Show all languages:** Remove the filter that hides non-English options; display all 8 languages

4. **Async loading UX:** When switching to a language that hasn't been loaded yet, show brief loading indicator in the switcher, then complete the switch

5. **Display format:** Each language option shows its native name (e.g., "日本語", "한국어") for universal recognition

## 7. Testing Considerations

- Verify all 8 languages load correctly (no missing keys)
- Verify zh → zh-CN migration path (localStorage compat)
- Verify language switching triggers proper re-render
- Verify `<RelativeTime />` hover/click behavior
- Verify date formatting respects current language
- Verify fallback to `en` when a key is missing in other languages
