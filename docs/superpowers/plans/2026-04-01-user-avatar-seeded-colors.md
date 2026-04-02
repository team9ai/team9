# User Avatar Seeded Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user fallback avatars deterministic from `userId`, centralize user avatar rendering in a reusable `UserAvatar` component, and reuse the workspace avatar palette from one shared utility.

**Architecture:** Add a small avatar-color utility in `apps/client/src/lib/` that owns the safe gradient palette, stable seed hashing, and initials extraction. Build a `UserAvatar` wrapper on top of the existing Radix avatar primitives, then migrate the main user-identity surfaces to consume it while refactoring workspace avatars in `MainSidebar.tsx` to reuse the same palette source.

**Tech Stack:** React 19, TypeScript, Radix Avatar, Tailwind CSS, Vitest, Testing Library

---

## File Structure

### Create

- `apps/client/src/lib/avatar-colors.ts`
- `apps/client/src/lib/__tests__/avatar-colors.test.ts`
- `apps/client/src/components/ui/user-avatar.tsx`
- `apps/client/src/components/ui/__tests__/UserAvatar.test.tsx`
- `apps/client/src/components/channel/__tests__/MessageItem.avatar.test.tsx`
- `apps/client/src/components/sidebar/__tests__/UserListItem.avatar.test.tsx`

### Modify

- `apps/client/src/components/layout/MainSidebar.tsx`
- `apps/client/src/components/channel/MessageItem.tsx`
- `apps/client/src/components/sidebar/UserListItem.tsx`
- `apps/client/src/components/channel/AddMemberDialog.tsx`
- `apps/client/src/components/activity/ActivityItem.tsx`
- `apps/client/src/components/search/SearchFilterFrom.tsx`
- `apps/client/src/components/channel/UserProfileCard.tsx`
- `apps/client/src/components/dialog/NewMessageDialog.tsx`
- `apps/client/src/routes/_authenticated/more/members.tsx`
- `apps/client/src/components/channel/editor/plugins/MentionsPlugin.tsx`

### Responsibilities

- `avatar-colors.ts`: single source of truth for the predefined gradient palette, seeded selection, and initials
- `user-avatar.tsx`: single source of truth for user avatar rendering rules (`avatarUrl`, bot fallback, seeded fallback)
- `MainSidebar.tsx`: keep workspace avatar UI unchanged while consuming the shared palette and initials helpers
- Migrated call sites: stop hardcoding user fallback colors and pass stable identity data (`userId`, `displayName`, `username`, `avatarUrl`)

### Out of Scope for This Plan

- `BotThinkingIndicator.tsx`, `AIStaff*`, `TrackingCard.tsx`, `ChannelHeader.tsx`, and non-user decorative avatars that intentionally do not represent a human user identity

## Task 1: Seeded Avatar Utility

**Files:**
- Create: `apps/client/src/lib/avatar-colors.ts`
- Create: `apps/client/src/lib/__tests__/avatar-colors.test.ts`

- [ ] **Step 1: Write the failing utility test**

```ts
import { describe, expect, it } from "vitest";
import {
  AVATAR_GRADIENTS,
  getInitials,
  getSeededAvatarGradient,
} from "../avatar-colors";

describe("avatar-colors", () => {
  it("returns the same gradient for the same seed", () => {
    expect(getSeededAvatarGradient("user-123")).toBe(
      getSeededAvatarGradient("user-123"),
    );
  });

  it("always returns one of the predefined gradients", () => {
    expect(AVATAR_GRADIENTS).toContain(getSeededAvatarGradient("user-123"));
    expect(AVATAR_GRADIENTS).toContain(getSeededAvatarGradient("workspace-9"));
    expect(AVATAR_GRADIENTS).toContain(getSeededAvatarGradient("alice"));
  });

  it("builds initials from either one or two words", () => {
    expect(getInitials("Alice")).toBe("A");
    expect(getInitials("Alice Smith")).toBe("AS");
    expect(getInitials("")).toBe("?");
    expect(getInitials(undefined)).toBe("?");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/client test -- src/lib/__tests__/avatar-colors.test.ts`

Expected: FAIL with module-not-found or missing-export errors for `avatar-colors`

- [ ] **Step 3: Write the minimal utility implementation**

```ts
export const AVATAR_GRADIENTS = [
  "from-indigo-500 to-blue-400",
  "from-violet-500 to-purple-400",
  "from-rose-400 to-pink-400",
  "from-emerald-500 to-teal-400",
  "from-amber-400 to-orange-400",
  "from-cyan-500 to-sky-400",
  "from-fuchsia-500 to-pink-400",
  "from-lime-500 to-green-400",
  "from-blue-500 to-indigo-400",
  "from-orange-500 to-red-400",
] as const;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getSeededAvatarGradient(seed?: string | null): string {
  const normalized = seed?.trim() || "?";
  return AVATAR_GRADIENTS[hashSeed(normalized) % AVATAR_GRADIENTS.length];
}

export function getInitials(name?: string | null): string {
  const normalized = name?.trim();
  if (!normalized) return "?";

  const words = normalized.split(/\s+/);
  if (words.length === 1) {
    return words[0][0]?.toUpperCase() ?? "?";
  }

  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase() || "?";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir apps/client test -- src/lib/__tests__/avatar-colors.test.ts`

Expected: PASS with 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/lib/avatar-colors.ts apps/client/src/lib/__tests__/avatar-colors.test.ts
git commit -m "feat(client): add seeded avatar color utility"
```

## Task 2: `UserAvatar` Component

**Files:**
- Create: `apps/client/src/components/ui/user-avatar.tsx`
- Create: `apps/client/src/components/ui/__tests__/UserAvatar.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserAvatar } from "../user-avatar";
import { getSeededAvatarGradient } from "@/lib/avatar-colors";

describe("UserAvatar", () => {
  it("renders a seeded fallback for human users without avatarUrl", () => {
    const { container } = render(
      <UserAvatar userId="user-42" name="Alice Smith" username="alice" />,
    );

    expect(screen.getByText("AS")).toBeInTheDocument();
    expect(container.firstChild).toHaveTextContent("AS");
    expect(container.querySelector("[data-slot='avatar-fallback']")).toHaveClass(
      getSeededAvatarGradient("user-42"),
    );
  });

  it("renders the uploaded avatar when avatarUrl exists", () => {
    render(
      <UserAvatar
        userId="user-42"
        name="Alice Smith"
        avatarUrl="https://example.com/a.png"
      />,
    );

    expect(screen.getByRole("img", { name: "Alice Smith" })).toHaveAttribute(
      "src",
      "https://example.com/a.png",
    );
  });

  it("renders the bot image when isBot is true and avatarUrl is missing", () => {
    render(<UserAvatar userId="bot-1" name="Helper Bot" isBot />);

    expect(screen.getByRole("img", { name: "Helper Bot" })).toHaveAttribute(
      "src",
      "/bot.webp",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/client test -- src/components/ui/__tests__/UserAvatar.test.tsx`

Expected: FAIL because `user-avatar.tsx` does not exist yet

- [ ] **Step 3: Write the minimal component implementation**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";
import { getInitials, getSeededAvatarGradient } from "@/lib/avatar-colors";
import {
  Avatar as BaseAvatar,
  AvatarFallback,
  AvatarImage,
} from "./avatar";

export interface UserAvatarProps
  extends React.ComponentProps<typeof BaseAvatar> {
  userId?: string;
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  isBot?: boolean;
  fallbackClassName?: string;
}

export function UserAvatar({
  userId,
  name,
  username,
  avatarUrl,
  isBot = false,
  className,
  fallbackClassName,
  ...props
}: UserAvatarProps) {
  const displayName = name || username || "Unknown User";
  const seed = userId || username || name || "?";
  const initials = getInitials(name || username);

  return (
    <BaseAvatar className={className} {...props}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
      {!avatarUrl && isBot ? (
        <AvatarImage src="/bot.webp" alt={displayName} />
      ) : null}
      <AvatarFallback
        className={cn(
          "bg-linear-to-br text-white",
          getSeededAvatarGradient(seed),
          fallbackClassName,
        )}
      >
        {initials}
      </AvatarFallback>
    </BaseAvatar>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir apps/client test -- src/components/ui/__tests__/UserAvatar.test.tsx`

Expected: PASS with 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/ui/user-avatar.tsx apps/client/src/components/ui/__tests__/UserAvatar.test.tsx
git commit -m "feat(client): add shared user avatar component"
```

## Task 3: Migrate Core User Identity Surfaces

**Files:**
- Create: `apps/client/src/components/channel/__tests__/MessageItem.avatar.test.tsx`
- Create: `apps/client/src/components/sidebar/__tests__/UserListItem.avatar.test.tsx`
- Modify: `apps/client/src/components/channel/MessageItem.tsx`
- Modify: `apps/client/src/components/sidebar/UserListItem.tsx`
- Modify: `apps/client/src/components/channel/AddMemberDialog.tsx`
- Modify: `apps/client/src/components/activity/ActivityItem.tsx`
- Modify: `apps/client/src/components/search/SearchFilterFrom.tsx`
- Modify: `apps/client/src/components/channel/UserProfileCard.tsx`
- Modify: `apps/client/src/components/dialog/NewMessageDialog.tsx`
- Modify: `apps/client/src/routes/_authenticated/more/members.tsx`
- Modify: `apps/client/src/components/channel/editor/plugins/MentionsPlugin.tsx`

- [ ] **Step 1: Write failing regression tests for representative call sites**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageItem } from "../MessageItem";
import type { Message } from "@/types/im";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channelId: "channel-1",
    senderId: "user-99",
    content: "hello",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    sender: {
      id: "user-99",
      email: "alice@example.com",
      username: "alice",
      displayName: "Alice Smith",
      avatarUrl: undefined,
      status: "online",
      isActive: true,
      userType: "human",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("MessageItem avatar fallback", () => {
  it("renders seeded initials for users without avatarUrl", () => {
    render(<MessageItem message={makeMessage()} />);
    expect(screen.getByText("AS")).toBeInTheDocument();
  });
});
```

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { UserListItem } from "../UserListItem";
import { getSeededAvatarGradient } from "@/lib/avatar-colors";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/hooks/useIMUsers", () => ({
  useIsUserOnline: () => false,
}));

describe("UserListItem avatar fallback", () => {
  it("passes userId through to the seeded fallback", () => {
    const { container } = render(
      <UserListItem
        name="Alice Smith"
        avatar="AS"
        userId="user-99"
        subtitle="@alice"
      />,
    );

    expect(
      container.querySelector("[data-slot='avatar-fallback']"),
    ).toHaveClass(getSeededAvatarGradient("user-99"));
  });
});
```

- [ ] **Step 2: Run the regression tests to verify they fail**

Run: `pnpm --dir apps/client test -- src/components/channel/__tests__/MessageItem.avatar.test.tsx src/components/sidebar/__tests__/UserListItem.avatar.test.tsx`

Expected: FAIL because the current call sites still render hardcoded fallback styles

- [ ] **Step 3: Replace raw user avatar usage with `UserAvatar`**

Use this migration pattern in each user-identity call site:

```tsx
import { UserAvatar } from "@/components/ui/user-avatar";

<UserAvatar
  className="w-9 h-9"
  fallbackClassName="text-sm"
  userId={message.sender?.id || message.senderId || undefined}
  name={message.sender?.displayName}
  username={message.sender?.username}
  avatarUrl={message.sender?.avatarUrl}
  isBot={message.sender?.userType === "bot"}
/>
```

Apply the same pattern to each file with the local size/text classes preserved:

```tsx
// apps/client/src/components/sidebar/UserListItem.tsx
<UserAvatar
  className={avatarSizeClass}
  fallbackClassName={avatarTextClass}
  userId={userId}
  name={name}
  username={subtitle?.startsWith("@") ? subtitle.slice(1) : undefined}
  avatarUrl={avatarUrl}
  isBot={isBot}
/>
```

```tsx
// apps/client/src/components/layout/MainSidebar.tsx
<UserAvatar
  className="w-10 h-10"
  fallbackClassName="text-sm font-medium"
  userId={currentUser?.id}
  name={currentUser?.displayName}
  username={currentUser?.username}
  avatarUrl={currentUser?.avatarUrl}
/>
```

```tsx
// apps/client/src/components/channel/editor/plugins/MentionsPlugin.tsx
<UserAvatar
  className="w-6 h-6"
  fallbackClassName="text-xs"
  userId={user.id}
  name={user.displayName}
  username={user.username}
  avatarUrl={user.avatarUrl}
/>
```

Do the same for:

- `AddMemberDialog.tsx`
- `ActivityItem.tsx`
- `SearchFilterFrom.tsx`
- `UserProfileCard.tsx`
- `NewMessageDialog.tsx`
- `routes/_authenticated/more/members.tsx`

- [ ] **Step 4: Run the regression tests to verify they pass**

Run: `pnpm --dir apps/client test -- src/components/channel/__tests__/MessageItem.avatar.test.tsx src/components/sidebar/__tests__/UserListItem.avatar.test.tsx`

Expected: PASS with seeded fallback assertions succeeding

- [ ] **Step 5: Commit**

```bash
git add \
  apps/client/src/components/channel/__tests__/MessageItem.avatar.test.tsx \
  apps/client/src/components/sidebar/__tests__/UserListItem.avatar.test.tsx \
  apps/client/src/components/channel/MessageItem.tsx \
  apps/client/src/components/sidebar/UserListItem.tsx \
  apps/client/src/components/channel/AddMemberDialog.tsx \
  apps/client/src/components/activity/ActivityItem.tsx \
  apps/client/src/components/search/SearchFilterFrom.tsx \
  apps/client/src/components/channel/UserProfileCard.tsx \
  apps/client/src/components/dialog/NewMessageDialog.tsx \
  apps/client/src/routes/_authenticated/more/members.tsx \
  apps/client/src/components/channel/editor/plugins/MentionsPlugin.tsx \
  apps/client/src/components/layout/MainSidebar.tsx
git commit -m "feat(client): migrate user avatar fallbacks to seeded colors"
```

## Task 4: Reuse the Shared Palette in Workspace Sidebar and Run Final Verification

**Files:**
- Modify: `apps/client/src/components/layout/MainSidebar.tsx`

- [ ] **Step 1: Refactor workspace sidebar helpers to consume the shared utility**

Replace the local constants and helpers in `MainSidebar.tsx`:

```tsx
import {
  getInitials,
  getSeededAvatarGradient,
} from "@/lib/avatar-colors";
```

Remove:

```ts
const WORKSPACE_GRADIENTS = [/* ... */];

const getInitials = (name: string) => { /* ... */ };

const getWorkspaceGradient = (index: number) => {
  return WORKSPACE_GRADIENTS[index % WORKSPACE_GRADIENTS.length];
};
```

Replace usage with a stable seed:

```tsx
className={cn(
  "absolute flex items-center justify-center bg-linear-to-br text-white text-xs font-semibold rounded-lg border-2 border-nav-bg opacity-60",
  getSeededAvatarGradient(workspace.id),
)}
```

```tsx
className={cn(
  "w-10 h-10 absolute top-0 left-0 flex items-center justify-center bg-linear-to-br text-white text-sm font-semibold rounded-xl shadow-md",
  getSeededAvatarGradient(currentWorkspace.id),
)}
```

This refactor should not change the sidebar layout, only the palette source and the seed rule.

- [ ] **Step 2: Run the focused test suite**

Run: `pnpm --dir apps/client test -- src/lib/__tests__/avatar-colors.test.ts src/components/ui/__tests__/UserAvatar.test.tsx src/components/channel/__tests__/MessageItem.avatar.test.tsx src/components/sidebar/__tests__/UserListItem.avatar.test.tsx`

Expected: PASS with all new tests green

- [ ] **Step 3: Run a grep audit for remaining hardcoded user avatar fallbacks**

Run: `rg -n "AvatarFallback className=\\\"bg-primary|AvatarFallback className=\\\"bg-accent|AvatarFallback className=\\\"bg-primary/10" apps/client/src/components apps/client/src/routes/_authenticated/more/members.tsx`

Expected: remaining matches are either bot-only, non-user decorative avatars, or explicitly out-of-scope surfaces from this plan

- [ ] **Step 4: Build the client**

Run: `pnpm --dir apps/client build`

Expected: successful Vite build with exit code 0

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/layout/MainSidebar.tsx
git commit -m "refactor(client): reuse seeded avatar palette for workspaces"
```

## Self-Review

### Spec Coverage Check

- deterministic user fallback color from `userId`: Task 1 and Task 2
- shared palette reused by workspace avatars: Task 4
- centralized user fallback rendering: Task 2 and Task 3
- migration of high-traffic user surfaces: Task 3
- test coverage for deterministic behavior: Task 1, Task 2, Task 3, Task 4

### Placeholder Scan

Before execution, run:

`rg -n "T[O]DO|T[B]D|implement[[:space:]]+later|similar[[:space:]]+to[[:space:]]+Task|appropriate[[:space:]]+error[[:space:]]+handling|write[[:space:]]+tests[[:space:]]+for[[:space:]]+the[[:space:]]+above" docs/superpowers/plans/2026-04-01-user-avatar-seeded-colors.md`

Expected: no matches

### Type Consistency Check

- utility export names stay exactly `AVATAR_GRADIENTS`, `getSeededAvatarGradient`, and `getInitials`
- component prop name stays `fallbackClassName`
- all migrated call sites pass `userId`, `name`, `username`, `avatarUrl`, and `isBot` using the same spellings as `UserAvatarProps`
