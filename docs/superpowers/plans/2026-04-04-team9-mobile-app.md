# Team9 Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React Native (Expo) mobile app for Team9 with chat, threads, file upload, search, notifications (in-app + push), Google OAuth, and i18n.

**Architecture:** Independent Expo project (`team9-mobile/`) communicating with the existing Team9 backend via REST API and Socket.io WebSocket. Expo Router for file-based navigation, Zustand + React Query for state, Expo Notifications for push.

**Tech Stack:** Expo SDK 53, TypeScript, Expo Router, Zustand, TanStack React Query, Socket.io-client, expo-notifications, expo-auth-session, expo-image-picker, expo-document-picker, expo-secure-store, i18next, react-native-reanimated, react-native-gesture-handler

**Spec:** `docs/superpowers/specs/2026-04-04-team9-mobile-app-design.md`

---

## File Structure

```
team9-mobile/
├── app/
│   ├── _layout.tsx                  # Root layout: providers (QueryClient, i18n, auth guard)
│   ├── (auth)/
│   │   ├── _layout.tsx              # Auth layout (no tabs)
│   │   ├── login.tsx                # Email input + Google OAuth button
│   │   └── verify.tsx               # 6-digit code input
│   ├── (main)/
│   │   ├── _layout.tsx              # Tab navigator (Messages, Search, Notifications, Me)
│   │   ├── channels.tsx             # Channel/DM list
│   │   ├── search.tsx               # Global search
│   │   ├── notifications.tsx        # Notification list
│   │   └── settings.tsx             # Profile + settings
│   └── chat/
│       └── [id].tsx                 # Chat detail (outside tabs for stack navigation)
├── src/
│   ├── services/
│   │   ├── http.ts                  # Fetch-based HTTP client with interceptors
│   │   ├── token.ts                 # Secure token storage + refresh logic
│   │   ├── websocket.ts             # Socket.io-client wrapper
│   │   ├── push.ts                  # Push notification registration + handling
│   │   └── api/
│   │       ├── index.ts             # API barrel export
│   │       ├── auth.ts              # Auth endpoints
│   │       ├── channels.ts          # Channel CRUD + members
│   │       ├── messages.ts          # Message CRUD + reactions + threads
│   │       ├── notifications.ts     # Notification endpoints
│   │       ├── search.ts            # Search endpoints
│   │       └── users.ts             # User endpoints
│   ├── stores/
│   │   ├── auth.ts                  # Auth state (user, isAuthenticated)
│   │   ├── app.ts                   # Connection status, active channel, locale
│   │   └── notifications.ts         # Unread counts for tab badge
│   ├── components/
│   │   ├── chat/
│   │   │   ├── MessageBubble.tsx    # Single message display
│   │   │   ├── MessageInput.tsx     # Text input + attachment buttons + send
│   │   │   ├── MessageList.tsx      # Inverted FlatList of messages
│   │   │   ├── ThreadDrawer.tsx     # Right-slide thread panel
│   │   │   ├── AttachmentPreview.tsx # Thumbnails above input
│   │   │   ├── TypingIndicator.tsx  # "X is typing..." display
│   │   │   └── ReactionPicker.tsx   # Emoji reaction selector
│   │   ├── channel/
│   │   │   ├── ChannelListItem.tsx  # Channel row in list
│   │   │   └── ChannelHeader.tsx    # Chat screen header
│   │   ├── search/
│   │   │   ├── SearchBar.tsx        # Debounced search input
│   │   │   ├── SearchFilters.tsx    # All/Messages/Channels/Users tabs
│   │   │   └── SearchResultItem.tsx # Individual result row
│   │   └── common/
│   │       ├── Avatar.tsx           # User/channel avatar
│   │       ├── Badge.tsx            # Unread count badge
│   │       ├── EmptyState.tsx       # Empty list placeholder
│   │       └── LoadingSpinner.tsx   # Loading indicator
│   ├── hooks/
│   │   ├── useAuth.ts              # Login/logout/token hooks
│   │   ├── useWebSocketEvents.ts   # Central WS event → RQ cache updater
│   │   ├── usePushNotifications.ts # Push token registration
│   │   ├── useMessages.ts          # Message queries + mutations
│   │   ├── useChannels.ts          # Channel list query
│   │   ├── useThread.ts            # Thread query
│   │   ├── useSearch.ts            # Search queries
│   │   └── useNotifications.ts     # Notification query + mutations
│   ├── i18n/
│   │   ├── index.ts                # i18next config
│   │   ├── zh-Hans.json            # Simplified Chinese
│   │   ├── zh-Hant.json            # Traditional Chinese
│   │   └── en.json                 # English
│   └── types/
│       ├── im.ts                   # Message, Channel, User, Attachment types
│       ├── ws-events.ts            # WS event name constants + payload types
│       └── notification.ts         # Notification types
├── __tests__/
│   ├── services/
│   │   ├── http.test.ts
│   │   ├── token.test.ts
│   │   └── websocket.test.ts
│   ├── stores/
│   │   ├── auth.test.ts
│   │   └── notifications.test.ts
│   ├── hooks/
│   │   ├── useAuth.test.ts
│   │   ├── useMessages.test.ts
│   │   └── useNotifications.test.ts
│   └── components/
│       ├── MessageBubble.test.tsx
│       ├── ChannelListItem.test.tsx
│       └── MessageInput.test.tsx
├── app.json
├── eas.json
├── babel.config.js
├── tsconfig.json
├── jest.config.js
└── package.json
```

---

## Phase 1: Core Chat + Notifications (Tasks 0-10)

### Task 0: Project Scaffolding

**Goal:** Initialize Expo project with all dependencies, TypeScript config, Jest setup, and shared type definitions.

**Files:**
- Create: `team9-mobile/package.json`
- Create: `team9-mobile/app.json`
- Create: `team9-mobile/tsconfig.json`
- Create: `team9-mobile/babel.config.js`
- Create: `team9-mobile/jest.config.js`
- Create: `team9-mobile/eas.json`
- Create: `team9-mobile/src/types/im.ts`
- Create: `team9-mobile/src/types/ws-events.ts`
- Create: `team9-mobile/src/types/notification.ts`

**Acceptance Criteria:**
- [ ] Expo project builds and runs on iOS simulator and Android emulator
- [ ] TypeScript strict mode enabled, compiles cleanly
- [ ] Jest runs with React Native Testing Library
- [ ] All shared types defined and importable

**Verify:** `cd team9-mobile && npx expo start --no-dev` → builds without errors; `npx jest --passWithNoTests` → passes

**Steps:**

- [ ] **Step 1: Create Expo project**

```bash
npx create-expo-app@latest team9-mobile --template blank-typescript
cd team9-mobile
```

- [ ] **Step 2: Install dependencies**

```bash
npx expo install expo-router expo-secure-store expo-notifications expo-image-picker expo-document-picker expo-auth-session expo-crypto expo-localization expo-linking
npx expo install react-native-reanimated react-native-gesture-handler react-native-safe-area-context react-native-screens
npx expo install @react-native-async-storage/async-storage
npm install zustand @tanstack/react-query socket.io-client i18next react-i18next
npm install -D jest @testing-library/react-native @testing-library/jest-native jest-expo @types/jest
```

- [ ] **Step 3: Configure TypeScript (`tsconfig.json`)**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

- [ ] **Step 4: Configure Jest (`jest.config.js`)**

```javascript
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterSetup: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@tanstack/.*)'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
}
```

- [ ] **Step 5: Configure Babel (`babel.config.js`)**

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
    ],
  };
};
```

- [ ] **Step 6: Configure EAS Build (`eas.json`)**

```json
{
  "cli": { "version": ">= 13.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  }
}
```

- [ ] **Step 7: Create shared types (`src/types/im.ts`)**

```typescript
export type MessageType = 'text' | 'file' | 'image' | 'system' | 'tracking';
export type ChannelType = 'direct' | 'public' | 'private';
export type UserStatus = 'online' | 'offline' | 'away' | 'busy';
export type MessageSendStatus = 'sending' | 'sent' | 'failed';

export interface IMUser {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  status: UserStatus;
  lastSeenAt?: string;
  isActive: boolean;
  userType?: 'human' | 'bot' | 'system';
  createdAt: string;
  updatedAt: string;
}

export interface MessageAttachment {
  id: string;
  fileKey: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface MessageReaction {
  id: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  clientMsgId?: string;
  senderId: string | null;
  parentId?: string;
  rootId?: string;
  content: string;
  type: MessageType;
  metadata?: Record<string, unknown>;
  isPinned: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  sender?: IMUser;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  replyCount?: number;
  lastReplyAt?: string;
  sendStatus?: MessageSendStatus;
}

export interface Channel {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  type: ChannelType;
  createdBy: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelWithUnread extends Channel {
  unreadCount: number;
  lastReadMessageId?: string;
  lastReadAt?: string;
  otherUser?: {
    id: string;
    username: string;
    displayName?: string;
    avatarUrl?: string;
    status: UserStatus;
    userType?: 'human' | 'bot' | 'system';
  };
}

export interface CreateMessageDto {
  content: string;
  clientMsgId?: string;
  parentId?: string;
  attachments?: {
    fileKey: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }[];
}

export interface GetMessagesParams {
  limit?: number;
  before?: string;
  after?: string;
  around?: string;
}

export interface PaginatedMessagesResponse {
  messages: Message[];
  hasOlder: boolean;
  hasNewer: boolean;
}

export interface ThreadResponse {
  rootMessage: Message;
  replies: Array<Message & { subReplies: Message[]; subReplyCount: number }>;
  totalReplyCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export interface AuthStartResponse {
  action: 'code_sent' | 'need_display_name';
  email: string;
  challengeId?: string;
  expiresInSeconds?: number;
}
```

- [ ] **Step 8: Create WS event types (`src/types/ws-events.ts`)**

```typescript
export const WS_EVENTS = {
  // Connection
  AUTHENTICATED: 'authenticated',
  AUTH_ERROR: 'auth_error',
  // Messages
  MESSAGE: {
    NEW: 'new_message',
    UPDATED: 'message_updated',
    DELETED: 'message_deleted',
  },
  // Read Status
  READ_STATUS: {
    MARK: 'mark_as_read',
    UPDATED: 'read_status_updated',
  },
  // Typing
  TYPING: {
    START: 'typing_start',
    STOP: 'typing_stop',
    USER: 'user_typing',
  },
  // Reactions
  REACTION: {
    ADD: 'add_reaction',
    REMOVE: 'remove_reaction',
    ADDED: 'reaction_added',
    REMOVED: 'reaction_removed',
  },
  // Channels
  CHANNEL: {
    CREATED: 'channel_created',
    UPDATED: 'channel_updated',
    DELETED: 'channel_deleted',
    JOINED: 'channel_joined',
    LEFT: 'channel_left',
    OBSERVE: 'channel:observe',
    UNOBSERVE: 'channel:unobserve',
  },
  // Users
  USER: {
    ONLINE: 'user_online',
    OFFLINE: 'user_offline',
    STATUS_CHANGED: 'user_status_changed',
  },
  // Notifications
  NOTIFICATION: {
    NEW: 'notification_new',
    COUNTS_UPDATED: 'notification_counts_updated',
    READ: 'notification_read',
  },
  // Streaming (AI Bot)
  STREAMING: {
    START: 'streaming_start',
    CONTENT: 'streaming_content',
    END: 'streaming_end',
    ABORT: 'streaming_abort',
  },
  // System
  PING: 'ping',
  PONG: 'pong',
} as const;

export interface NewMessageEvent {
  id: string;
  channelId: string;
  senderId: string | null;
  parentId?: string;
  rootId?: string;
  content: string;
  type: string;
  metadata?: Record<string, unknown>;
  isPinned: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  sender?: { id: string; username: string; displayName?: string; avatarUrl?: string };
  attachments?: Array<{ id: string; fileKey: string; fileName: string; fileUrl: string; fileSize: number; mimeType: string; thumbnailUrl?: string }>;
  reactions?: Array<{ id: string; userId: string; emoji: string; createdAt: string }>;
  replyCount?: number;
}

export interface ReadStatusUpdatedEvent {
  channelId: string;
  userId: string;
  lastReadMessageId: string;
}

export interface UserTypingEvent {
  channelId: string;
  userId: string;
  username: string;
  isTyping: boolean;
}

export interface ReactionEvent {
  messageId: string;
  userId: string;
  emoji: string;
}

export interface ChannelCreatedEvent {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  type: string;
  createdBy: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserStatusEvent {
  userId: string;
  status: string;
}

export interface NotificationNewEvent {
  id: string;
  category: string;
  type: string;
  priority: string;
  title: string;
  body: string | null;
  actor: { id: string; username: string; displayName?: string; avatarUrl?: string } | null;
  channelId: string | null;
  messageId: string | null;
  createdAt: string;
}

export interface NotificationCountsEvent {
  total: number;
  byCategory: Record<string, number>;
}
```

- [ ] **Step 9: Create notification types (`src/types/notification.ts`)**

```typescript
export type NotificationCategory = 'message' | 'system' | 'workspace';
export type NotificationType = 'mention' | 'reply' | 'dm_received' | 'channel_invite' | 'system_announcement';

export interface Notification {
  id: string;
  category: NotificationCategory;
  type: NotificationType;
  priority: 'high' | 'medium' | 'low';
  title: string;
  body: string | null;
  actor: {
    id: string;
    username: string;
    displayName?: string;
    avatarUrl?: string;
  } | null;
  tenantId: string | null;
  channelId: string | null;
  messageId: string | null;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationCounts {
  total: number;
  byCategory: Record<string, number>;
}

export interface GetNotificationsParams {
  category?: NotificationCategory;
  type?: NotificationType;
  isRead?: boolean;
  limit?: number;
  cursor?: string;
}

export interface GetNotificationsResponse {
  notifications: Notification[];
  nextCursor: string | null;
}
```

- [ ] **Step 10: Verify project builds and tests run**

```bash
cd team9-mobile && npx expo start --no-dev
# In another terminal:
npx jest --passWithNoTests
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(mobile): initialize Expo project with types and config"
```

---

### Task 1: HTTP Client + Secure Token Storage

**Goal:** Build the HTTP client with auth interceptor and token refresh, plus secure token storage using expo-secure-store.

**Files:**
- Create: `team9-mobile/src/services/token.ts`
- Create: `team9-mobile/src/services/http.ts`
- Create: `team9-mobile/__tests__/services/token.test.ts`
- Create: `team9-mobile/__tests__/services/http.test.ts`

**Acceptance Criteria:**
- [ ] Tokens stored/retrieved from expo-secure-store
- [ ] HTTP client attaches Bearer token to all requests
- [ ] 401 responses trigger token refresh automatically
- [ ] Concurrent 401s deduplicated to single refresh call
- [ ] Failed refresh clears tokens and signals logout

**Verify:** `npx jest __tests__/services/token.test.ts __tests__/services/http.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write token service tests**

```typescript
// __tests__/services/token.test.ts
import { tokenService } from '@/services/token';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store');

describe('tokenService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores and retrieves access token', async () => {
    await tokenService.setTokens('access123', 'refresh456');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'access123');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('refresh_token', 'refresh456');
  });

  it('clears tokens', async () => {
    await tokenService.clearTokens();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
  });

  it('returns null when no token stored', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    const token = await tokenService.getAccessToken();
    expect(token).toBeNull();
  });

  it('refreshes token and stores new pair', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('old_refresh');
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ accessToken: 'new_access', refreshToken: 'new_refresh' }),
    });
    const result = await tokenService.refreshAccessToken();
    expect(result).toBe('new_access');
  });

  it('deduplicates concurrent refresh calls', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('refresh_tok');
    let resolveRefresh: (v: unknown) => void;
    global.fetch = jest.fn().mockReturnValue(
      new Promise((r) => { resolveRefresh = r; })
    );
    const p1 = tokenService.refreshAccessToken();
    const p2 = tokenService.refreshAccessToken();
    resolveRefresh!({
      ok: true,
      json: () => Promise.resolve({ accessToken: 'new', refreshToken: 'new_r' }),
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('new');
    expect(r2).toBe('new');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Implement token service**

```typescript
// src/services/token.ts
import * as SecureStore from 'expo-secure-store';

const KEYS = { ACCESS: 'auth_token', REFRESH: 'refresh_token' } as const;

let refreshPromise: Promise<string | null> | null = null;
let onLogout: (() => void) | null = null;

export const tokenService = {
  setOnLogout(cb: () => void) { onLogout = cb; },

  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(KEYS.ACCESS);
  },

  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(KEYS.REFRESH);
  },

  async setTokens(access: string, refresh: string): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.ACCESS, access),
      SecureStore.setItemAsync(KEYS.REFRESH, refresh),
    ]);
  },

  async clearTokens(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.ACCESS),
      SecureStore.deleteItemAsync(KEYS.REFRESH),
    ]);
  },

  async refreshAccessToken(): Promise<string | null> {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        const refreshToken = await SecureStore.getItemAsync(KEYS.REFRESH);
        if (!refreshToken) { onLogout?.(); return null; }

        const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api';
        const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (!res.ok) { await tokenService.clearTokens(); onLogout?.(); return null; }

        const data = await res.json();
        await tokenService.setTokens(data.accessToken, data.refreshToken);
        return data.accessToken;
      } catch {
        await tokenService.clearTokens();
        onLogout?.();
        return null;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  },
};
```

- [ ] **Step 3: Write HTTP client tests**

```typescript
// __tests__/services/http.test.ts
import { httpClient } from '@/services/http';
import { tokenService } from '@/services/token';

jest.mock('@/services/token');

describe('httpClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('attaches auth header to requests', async () => {
    (tokenService.getAccessToken as jest.Mock).mockResolvedValue('my_token');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true, json: () => Promise.resolve({ data: 'result' }),
    });
    await httpClient.get('/v1/test');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my_token' }),
      }),
    );
  });

  it('retries with refreshed token on 401', async () => {
    (tokenService.getAccessToken as jest.Mock)
      .mockResolvedValueOnce('expired_tok')
      .mockResolvedValueOnce('new_tok');
    (tokenService.refreshAccessToken as jest.Mock).mockResolvedValue('new_tok');
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1 }) });

    const result = await httpClient.get('/v1/test');
    expect(tokenService.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 1 });
  });

  it('throws on non-401 errors', async () => {
    (tokenService.getAccessToken as jest.Mock).mockResolvedValue('tok');
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false, status: 500, json: () => Promise.resolve({ message: 'Server Error' }),
    });
    await expect(httpClient.get('/v1/fail')).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Implement HTTP client**

```typescript
// src/services/http.ts
import { tokenService } from './token';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api';
const TIMEOUT = 30_000;

class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await tokenService.getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (res.status === 401 && !path.includes('/auth/refresh')) {
      const newToken = await tokenService.refreshAccessToken();
      if (newToken) {
        headers.Authorization = `Bearer ${newToken}`;
        const retry = await fetch(`${BASE_URL}${path}`, { ...options, headers });
        if (!retry.ok) throw new ApiError(retry.status, 'Request failed after refresh');
        return retry.json();
      }
      throw new ApiError(401, 'Authentication failed');
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message ?? 'Request failed', body);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : ({} as T);
  } finally {
    clearTimeout(timeout);
  }
}

export const httpClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type with boundary
    }),
};

export { ApiError };
```

- [ ] **Step 5: Run tests and commit**

```bash
npx jest __tests__/services/token.test.ts __tests__/services/http.test.ts
git add -A && git commit -m "feat(mobile): add HTTP client with token refresh and secure storage"
```

---

### Task 2: Auth Store + Login & Verify Screens

**Goal:** Implement Zustand auth store, API service for auth endpoints, and login/verify screens with email verification code flow.

**Files:**
- Create: `team9-mobile/src/services/api/auth.ts`
- Create: `team9-mobile/src/stores/auth.ts`
- Create: `team9-mobile/src/hooks/useAuth.ts`
- Create: `team9-mobile/app/_layout.tsx`
- Create: `team9-mobile/app/(auth)/_layout.tsx`
- Create: `team9-mobile/app/(auth)/login.tsx`
- Create: `team9-mobile/app/(auth)/verify.tsx`
- Create: `team9-mobile/app/(main)/_layout.tsx`
- Create: `team9-mobile/__tests__/stores/auth.test.ts`
- Create: `team9-mobile/__tests__/hooks/useAuth.test.ts`

**Acceptance Criteria:**
- [ ] Auth store tracks user, isAuthenticated, isLoading states
- [ ] Login screen sends email to `/v1/auth/start`, navigates to verify on success
- [ ] Verify screen submits 6-digit code to `/v1/auth/verify-code`, stores tokens on success
- [ ] Root layout redirects to (auth) or (main) based on auth state
- [ ] Logout clears tokens and resets stores

**Verify:** `npx jest __tests__/stores/auth.test.ts __tests__/hooks/useAuth.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write auth store tests**

```typescript
// __tests__/stores/auth.test.ts
import { useAuthStore } from '@/stores/auth';
import { tokenService } from '@/services/token';

jest.mock('@/services/token');

describe('useAuthStore', () => {
  beforeEach(() => useAuthStore.getState().reset());

  it('initializes as not authenticated', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  it('sets user on login', () => {
    const user = { id: '1', email: 'a@b.com', username: 'test', displayName: 'Test', avatarUrl: null };
    useAuthStore.getState().setUser(user);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toEqual(user);
  });

  it('clears state on logout', async () => {
    useAuthStore.getState().setUser({ id: '1', email: 'a@b.com', username: 'test', displayName: null, avatarUrl: null });
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(tokenService.clearTokens).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement auth store**

```typescript
// src/stores/auth.ts
import { create } from 'zustand';
import { tokenService } from '@/services/token';

interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: AuthUser) => void;
  setLoading: (loading: boolean) => void;
  logout: () => Promise<void>;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: true, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: async () => {
    await tokenService.clearTokens();
    set({ user: null, isAuthenticated: false, isLoading: false });
  },
  reset: () => set({ user: null, isAuthenticated: false, isLoading: false }),
}));
```

- [ ] **Step 3: Implement auth API service**

```typescript
// src/services/api/auth.ts
import { httpClient } from '../http';
import type { AuthResponse, AuthStartResponse } from '@/types/im';

export const authApi = {
  start(email: string, displayName?: string): Promise<AuthStartResponse> {
    return httpClient.post('/v1/auth/start', { email, displayName });
  },

  verifyCode(email: string, challengeId: string, code: string): Promise<AuthResponse> {
    return httpClient.post('/v1/auth/verify-code', { email, challengeId, code });
  },

  googleLogin(credential: string): Promise<AuthResponse> {
    return httpClient.post('/v1/auth/google', { credential });
  },

  getMe(): Promise<AuthResponse['user']> {
    return httpClient.get('/v1/auth/me');
  },

  logout(refreshToken?: string): Promise<void> {
    return httpClient.post('/v1/auth/logout', refreshToken ? { refreshToken } : undefined);
  },
};
```

- [ ] **Step 4: Implement useAuth hook**

```typescript
// src/hooks/useAuth.ts
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { authApi } from '@/services/api/auth';
import { tokenService } from '@/services/token';
import { useAuthStore } from '@/stores/auth';
import type { AuthStartResponse } from '@/types/im';

export function useLogin() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const login = async (email: string): Promise<AuthStartResponse | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await authApi.start(email);
      if (result.action === 'code_sent') {
        router.push({ pathname: '/(auth)/verify', params: { email, challengeId: result.challengeId! } });
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { login, isLoading, error };
}

export function useVerifyCode() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUser = useAuthStore((s) => s.setUser);
  const router = useRouter();

  const verify = async (email: string, challengeId: string, code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await authApi.verifyCode(email, challengeId, code);
      await tokenService.setTokens(result.accessToken, result.refreshToken);
      setUser(result.user);
      router.replace('/(main)/channels');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  return { verify, isLoading, error };
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  return async () => {
    const refreshToken = await tokenService.getRefreshToken();
    try { await authApi.logout(refreshToken ?? undefined); } catch { /* best effort */ }
    await logout();
    router.replace('/(auth)/login');
  };
}
```

- [ ] **Step 5: Implement root layout with auth guard**

```typescript
// app/_layout.tsx
import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth';
import { authApi } from '@/services/api/auth';
import { tokenService } from '@/services/token';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 30_000 } },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, setUser, setLoading } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const token = await tokenService.getAccessToken();
      if (token) {
        try {
          const user = await authApi.getMe();
          setUser(user);
        } catch {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuth) router.replace('/(auth)/login');
    else if (isAuthenticated && inAuth) router.replace('/(main)/channels');
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) return null; // splash screen would go here
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGuard>
        <Slot />
      </AuthGuard>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 6: Implement login screen**

```typescript
// app/(auth)/_layout.tsx
import { Stack } from 'expo-router';
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

// app/(auth)/login.tsx
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLogin } from '@/hooks/useAuth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const { login, isLoading, error } = useLogin();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Team9</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={() => login(email)}
        disabled={isLoading || !email.includes('@')}
      >
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Verification Code</Text>}
      </TouchableOpacity>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold', textAlign: 'center', marginBottom: 48 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 16, fontSize: 16, marginBottom: 16 },
  button: { backgroundColor: '#6366f1', borderRadius: 8, padding: 16, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#ef4444', marginTop: 12, textAlign: 'center' },
});
```

- [ ] **Step 7: Implement verify screen**

```typescript
// app/(auth)/verify.tsx
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useVerifyCode } from '@/hooks/useAuth';

export default function VerifyScreen() {
  const { email, challengeId } = useLocalSearchParams<{ email: string; challengeId: string }>();
  const [code, setCode] = useState('');
  const { verify, isLoading, error } = useVerifyCode();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter Verification Code</Text>
      <Text style={styles.subtitle}>Sent to {email}</Text>
      <TextInput
        style={styles.input}
        placeholder="6-digit code"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
      />
      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={() => verify(email!, challengeId!, code)}
        disabled={isLoading || code.length !== 6}
      >
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
      </TouchableOpacity>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  subtitle: { textAlign: 'center', color: '#666', marginBottom: 32 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 16, fontSize: 24, textAlign: 'center', letterSpacing: 8, marginBottom: 16 },
  button: { backgroundColor: '#6366f1', borderRadius: 8, padding: 16, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#ef4444', marginTop: 12, textAlign: 'center' },
});
```

- [ ] **Step 8: Run tests and commit**

```bash
npx jest __tests__/stores/auth.test.ts __tests__/hooks/useAuth.test.ts
git add -A && git commit -m "feat(mobile): add auth flow with login and verify screens"
```

---

### Task 3: WebSocket Service

**Goal:** Build Socket.io-client wrapper with auth, auto-reconnection, event typing, and React Query cache integration.

**Files:**
- Create: `team9-mobile/src/services/websocket.ts`
- Create: `team9-mobile/src/stores/app.ts`
- Create: `team9-mobile/src/hooks/useWebSocketEvents.ts`
- Create: `team9-mobile/__tests__/services/websocket.test.ts`

**Acceptance Criteria:**
- [ ] Connects to `/im` namespace with JWT auth in handshake
- [ ] Auto-reconnects with exponential backoff (1s → 30s)
- [ ] Emits typed events: markAsRead, startTyping, stopTyping, addReaction, removeReaction
- [ ] Listens for new_message, message_updated, message_deleted and updates React Query cache
- [ ] Connection status tracked in Zustand app store

**Verify:** `npx jest __tests__/services/websocket.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Implement app store**

```typescript
// src/stores/app.ts
import { create } from 'zustand';

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

interface AppState {
  connectionStatus: ConnectionStatus;
  activeChannelId: string | null;
  locale: string;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setActiveChannelId: (id: string | null) => void;
  setLocale: (locale: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  connectionStatus: 'disconnected',
  activeChannelId: null,
  locale: 'en',
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setActiveChannelId: (activeChannelId) => set({ activeChannelId }),
  setLocale: (locale) => set({ locale }),
}));
```

- [ ] **Step 2: Write WebSocket service tests**

```typescript
// __tests__/services/websocket.test.ts
import { wsService } from '@/services/websocket';

// Mock socket.io-client
const mockSocket = {
  connected: false,
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  io: { on: jest.fn(), off: jest.fn() },
  auth: {},
};

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => mockSocket),
}));

jest.mock('@/services/token', () => ({
  tokenService: { getAccessToken: jest.fn().mockResolvedValue('test_token') },
}));

describe('wsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits typing_start with channelId', () => {
    wsService.startTyping('ch-1');
    expect(mockSocket.emit).toHaveBeenCalledWith('typing_start', { channelId: 'ch-1' });
  });

  it('emits mark_as_read with channelId and messageId', () => {
    wsService.markAsRead('ch-1', 'msg-1');
    expect(mockSocket.emit).toHaveBeenCalledWith('mark_as_read', { channelId: 'ch-1', messageId: 'msg-1' });
  });

  it('emits add_reaction', () => {
    wsService.addReaction('msg-1', '👍');
    expect(mockSocket.emit).toHaveBeenCalledWith('add_reaction', { messageId: 'msg-1', emoji: '👍' });
  });
});
```

- [ ] **Step 3: Implement WebSocket service**

```typescript
// src/services/websocket.ts
import { io, Socket } from 'socket.io-client';
import { tokenService } from './token';
import { useAppStore } from '@/stores/app';
import { WS_EVENTS } from '@/types/ws-events';

const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api').replace(/\/api$/, '');

let socket: Socket | null = null;

function getSocket(): Socket {
  if (socket) return socket;

  socket = io(`${BASE_URL}/im`, {
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    auth: async (cb) => {
      const token = await tokenService.getAccessToken();
      cb({ token });
    },
  });

  socket.on('connect', () => {
    useAppStore.getState().setConnectionStatus('connected');
  });

  socket.on('disconnect', () => {
    useAppStore.getState().setConnectionStatus('disconnected');
  });

  socket.io.on('reconnect_attempt', () => {
    useAppStore.getState().setConnectionStatus('reconnecting');
  });

  socket.on(WS_EVENTS.AUTH_ERROR, async () => {
    const newToken = await tokenService.refreshAccessToken();
    if (newToken) socket?.connect();
  });

  return socket;
}

export const wsService = {
  connect() {
    const s = getSocket();
    if (!s.connected) s.connect();
  },

  disconnect() {
    socket?.disconnect();
    socket = null;
    useAppStore.getState().setConnectionStatus('disconnected');
  },

  on<T = unknown>(event: string, handler: (data: T) => void) {
    getSocket().on(event, handler as (...args: unknown[]) => void);
  },

  off(event: string, handler?: (...args: unknown[]) => void) {
    getSocket().off(event, handler);
  },

  // Emitters
  startTyping(channelId: string) {
    getSocket().emit(WS_EVENTS.TYPING.START, { channelId });
  },

  stopTyping(channelId: string) {
    getSocket().emit(WS_EVENTS.TYPING.STOP, { channelId });
  },

  markAsRead(channelId: string, messageId: string) {
    getSocket().emit(WS_EVENTS.READ_STATUS.MARK, { channelId, messageId });
  },

  addReaction(messageId: string, emoji: string) {
    getSocket().emit(WS_EVENTS.REACTION.ADD, { messageId, emoji });
  },

  removeReaction(messageId: string, emoji: string) {
    getSocket().emit(WS_EVENTS.REACTION.REMOVE, { messageId, emoji });
  },

  observeChannel(channelId: string) {
    getSocket().emit(WS_EVENTS.CHANNEL.OBSERVE, { channelId });
  },

  unobserveChannel(channelId: string) {
    getSocket().emit(WS_EVENTS.CHANNEL.UNOBSERVE, { channelId });
  },
};
```

- [ ] **Step 4: Implement useWebSocketEvents hook**

```typescript
// src/hooks/useWebSocketEvents.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wsService } from '@/services/websocket';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notifications';
import { WS_EVENTS } from '@/types/ws-events';
import type { NewMessageEvent, ReadStatusUpdatedEvent, ReactionEvent, NotificationCountsEvent } from '@/types/ws-events';
import type { Message, ChannelWithUnread } from '@/types/im';

export function useWebSocketEvents() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;

    wsService.connect();

    // New message → prepend to message list, update channel list
    wsService.on<NewMessageEvent>(WS_EVENTS.MESSAGE.NEW, (msg) => {
      queryClient.setQueryData<{ pages: { messages: Message[] }[] }>(
        ['messages', msg.channelId],
        (old) => {
          if (!old) return old;
          const firstPage = old.pages[0];
          return { ...old, pages: [{ ...firstPage, messages: [msg as Message, ...firstPage.messages] }, ...old.pages.slice(1)] };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    });

    // Message updated
    wsService.on<NewMessageEvent>(WS_EVENTS.MESSAGE.UPDATED, (msg) => {
      queryClient.setQueryData<{ pages: { messages: Message[] }[] }>(
        ['messages', msg.channelId],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: page.messages.map((m) => (m.id === msg.id ? (msg as Message) : m)),
            })),
          };
        },
      );
    });

    // Message deleted
    wsService.on<{ messageId: string; channelId?: string }>(WS_EVENTS.MESSAGE.DELETED, (data) => {
      if (!data.channelId) return;
      queryClient.setQueryData<{ pages: { messages: Message[] }[] }>(
        ['messages', data.channelId],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: page.messages.filter((m) => m.id !== data.messageId),
            })),
          };
        },
      );
    });

    // Read status
    wsService.on<ReadStatusUpdatedEvent>(WS_EVENTS.READ_STATUS.UPDATED, (data) => {
      queryClient.setQueryData<ChannelWithUnread[]>(['channels'], (old) =>
        old?.map((ch) =>
          ch.id === data.channelId ? { ...ch, lastReadMessageId: data.lastReadMessageId, unreadCount: 0 } : ch,
        ),
      );
    });

    // Reactions
    wsService.on<ReactionEvent>(WS_EVENTS.REACTION.ADDED, () => {
      // Simplified: invalidate to refetch
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    });
    wsService.on<ReactionEvent>(WS_EVENTS.REACTION.REMOVED, () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    });

    // Notification counts
    wsService.on<NotificationCountsEvent>(WS_EVENTS.NOTIFICATION.COUNTS_UPDATED, (data) => {
      useNotificationStore.getState().setCounts(data);
    });

    // Channel changes
    wsService.on(WS_EVENTS.CHANNEL.CREATED, () => queryClient.invalidateQueries({ queryKey: ['channels'] }));
    wsService.on(WS_EVENTS.CHANNEL.UPDATED, () => queryClient.invalidateQueries({ queryKey: ['channels'] }));
    wsService.on(WS_EVENTS.CHANNEL.DELETED, () => queryClient.invalidateQueries({ queryKey: ['channels'] }));

    return () => {
      wsService.disconnect();
    };
  }, [isAuthenticated, queryClient]);
}
```

- [ ] **Step 5: Create notification store**

```typescript
// src/stores/notifications.ts
import { create } from 'zustand';
import type { NotificationCounts } from '@/types/notification';

interface NotificationState {
  counts: NotificationCounts;
  setCounts: (counts: NotificationCounts) => void;
  reset: () => void;
}

const initialCounts: NotificationCounts = { total: 0, byCategory: {} };

export const useNotificationStore = create<NotificationState>((set) => ({
  counts: initialCounts,
  setCounts: (counts) => set({ counts }),
  reset: () => set({ counts: initialCounts }),
}));
```

- [ ] **Step 6: Run tests and commit**

```bash
npx jest __tests__/services/websocket.test.ts
git add -A && git commit -m "feat(mobile): add WebSocket service with React Query integration"
```

---

### Task 4: Channel List Screen

**Goal:** Build the Messages tab showing all channels/DMs with unread counts, last message preview, sorted by recent activity.

**Files:**
- Create: `team9-mobile/src/services/api/channels.ts`
- Create: `team9-mobile/src/hooks/useChannels.ts`
- Create: `team9-mobile/src/components/channel/ChannelListItem.tsx`
- Create: `team9-mobile/src/components/common/Avatar.tsx`
- Create: `team9-mobile/src/components/common/Badge.tsx`
- Create: `team9-mobile/app/(main)/channels.tsx`
- Modify: `team9-mobile/app/(main)/_layout.tsx` (add tab navigator)
- Create: `team9-mobile/__tests__/components/ChannelListItem.test.tsx`

**Acceptance Criteria:**
- [ ] Fetches channel list via `GET /v1/im/channels`
- [ ] Shows channel name, last message preview, timestamp, unread badge
- [ ] DM channels show other user's avatar and online status
- [ ] Pull-to-refresh refetches channel list
- [ ] Tap navigates to `/chat/[id]`
- [ ] Tab navigator has 4 tabs with correct icons

**Verify:** `npx jest __tests__/components/ChannelListItem.test.tsx` → all pass

**Steps:**

- [ ] **Step 1: Implement channels API**

```typescript
// src/services/api/channels.ts
import { httpClient } from '../http';
import type { ChannelWithUnread } from '@/types/im';

export const channelsApi = {
  getChannels(): Promise<ChannelWithUnread[]> {
    return httpClient.get('/v1/im/channels');
  },
  getChannel(id: string): Promise<ChannelWithUnread> {
    return httpClient.get(`/v1/im/channels/${id}`);
  },
  markAsRead(channelId: string, messageId: string): Promise<void> {
    return httpClient.post(`/v1/im/channels/${channelId}/read`, { messageId });
  },
};
```

- [ ] **Step 2: Implement useChannels hook**

```typescript
// src/hooks/useChannels.ts
import { useQuery } from '@tanstack/react-query';
import { channelsApi } from '@/services/api/channels';

export function useChannels() {
  return useQuery({
    queryKey: ['channels'],
    queryFn: channelsApi.getChannels,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 3: Implement Avatar component**

```typescript
// src/components/common/Avatar.tsx
import { View, Text, Image, StyleSheet } from 'react-native';

interface AvatarProps {
  uri?: string | null;
  name: string;
  size?: number;
  showStatus?: boolean;
  isOnline?: boolean;
}

export function Avatar({ uri, name, size = 40, showStatus, isOnline }: AvatarProps) {
  const initials = name.slice(0, 2).toUpperCase();
  const bgColor = `hsl(${name.charCodeAt(0) * 7 % 360}, 60%, 65%)`;

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image source={{ uri }} style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor }]}>
          <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials}</Text>
        </View>
      )}
      {showStatus && (
        <View style={[styles.status, { backgroundColor: isOnline ? '#22c55e' : '#9ca3af' }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative' },
  image: { resizeMode: 'cover' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '600' },
  status: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
});
```

- [ ] **Step 4: Implement Badge component**

```typescript
// src/components/common/Badge.tsx
import { View, Text, StyleSheet } from 'react-native';

export function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: '#6366f1', borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
```

- [ ] **Step 5: Write ChannelListItem test**

```typescript
// __tests__/components/ChannelListItem.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChannelListItem } from '@/components/channel/ChannelListItem';

const mockChannel = {
  id: 'ch-1', tenantId: 't1', name: 'general', type: 'public' as const,
  createdBy: 'u1', isArchived: false, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  unreadCount: 3, lastReadMessageId: undefined, lastReadAt: undefined,
};

describe('ChannelListItem', () => {
  it('renders channel name and unread badge', () => {
    const { getByText } = render(<ChannelListItem channel={mockChannel} onPress={jest.fn()} />);
    expect(getByText('#general')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<ChannelListItem channel={mockChannel} onPress={onPress} />);
    fireEvent.press(getByText('#general'));
    expect(onPress).toHaveBeenCalledWith('ch-1');
  });

  it('shows DM user name for direct channels', () => {
    const dm = { ...mockChannel, type: 'direct' as const, name: 'dm', otherUser: { id: 'u2', username: 'bob', displayName: 'Bob', avatarUrl: null, status: 'online' as const } };
    const { getByText } = render(<ChannelListItem channel={dm} onPress={jest.fn()} />);
    expect(getByText('Bob')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Implement ChannelListItem**

```typescript
// src/components/channel/ChannelListItem.tsx
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Avatar } from '@/components/common/Avatar';
import { Badge } from '@/components/common/Badge';
import type { ChannelWithUnread } from '@/types/im';

interface Props {
  channel: ChannelWithUnread;
  onPress: (id: string) => void;
}

export function ChannelListItem({ channel, onPress }: Props) {
  const isDM = channel.type === 'direct';
  const displayName = isDM ? (channel.otherUser?.displayName ?? channel.otherUser?.username ?? channel.name) : channel.name;
  const prefix = isDM ? '' : '#';

  return (
    <TouchableOpacity style={styles.container} onPress={() => onPress(channel.id)} activeOpacity={0.7}>
      <Avatar
        uri={isDM ? channel.otherUser?.avatarUrl : channel.avatarUrl}
        name={displayName}
        size={48}
        showStatus={isDM}
        isOnline={isDM && channel.otherUser?.status === 'online'}
      />
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>{prefix}{displayName}</Text>
      </View>
      <View style={styles.meta}>
        <Badge count={channel.unreadCount} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  content: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { alignItems: 'flex-end' },
});
```

- [ ] **Step 7: Implement tab navigator and channels screen**

```typescript
// app/(main)/_layout.tsx
import { Tabs } from 'expo-router';
import { useWebSocketEvents } from '@/hooks/useWebSocketEvents';
import { useNotificationStore } from '@/stores/notifications';

export default function MainLayout() {
  useWebSocketEvents();
  const totalUnread = useNotificationStore((s) => s.counts.total);

  return (
    <Tabs screenOptions={{ headerShown: true, tabBarActiveTintColor: '#6366f1' }}>
      <Tabs.Screen name="channels" options={{ title: 'Messages', tabBarIcon: ({ color }) => <TabIcon name="chat" color={color} /> }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: ({ color }) => <TabIcon name="search" color={color} /> }} />
      <Tabs.Screen name="notifications" options={{ title: 'Notifications', tabBarBadge: totalUnread > 0 ? totalUnread : undefined, tabBarIcon: ({ color }) => <TabIcon name="bell" color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Me', tabBarIcon: ({ color }) => <TabIcon name="user" color={color} /> }} />
    </Tabs>
  );
}

// Simple text-based tab icons (replace with actual icon library later)
function TabIcon({ name, color }: { name: string; color: string }) {
  const icons: Record<string, string> = { chat: '💬', search: '🔍', bell: '🔔', user: '👤' };
  return <Text style={{ fontSize: 20 }}>{icons[name]}</Text>;
}

import { Text } from 'react-native';
```

```typescript
// app/(main)/channels.tsx
import { FlatList, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useChannels } from '@/hooks/useChannels';
import { ChannelListItem } from '@/components/channel/ChannelListItem';

export default function ChannelsScreen() {
  const { data: channels, isLoading, refetch } = useChannels();
  const router = useRouter();

  return (
    <FlatList
      data={channels}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ChannelListItem channel={item} onPress={(id) => router.push(`/chat/${id}`)} />
      )}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
    />
  );
}
```

- [ ] **Step 8: Run tests and commit**

```bash
npx jest __tests__/components/ChannelListItem.test.tsx
git add -A && git commit -m "feat(mobile): add channel list screen with tab navigation"
```

---

### Task 5: Chat Detail Screen (Messages + Send)

**Goal:** Build the chat screen with inverted message list, message bubbles, text input, and real-time message sending/receiving.

**Files:**
- Create: `team9-mobile/src/services/api/messages.ts`
- Create: `team9-mobile/src/hooks/useMessages.ts`
- Create: `team9-mobile/src/components/chat/MessageBubble.tsx`
- Create: `team9-mobile/src/components/chat/MessageList.tsx`
- Create: `team9-mobile/src/components/chat/MessageInput.tsx`
- Create: `team9-mobile/src/components/channel/ChannelHeader.tsx`
- Create: `team9-mobile/app/chat/[id].tsx`
- Create: `team9-mobile/__tests__/components/MessageBubble.test.tsx`
- Create: `team9-mobile/__tests__/hooks/useMessages.test.ts`

**Acceptance Criteria:**
- [ ] Fetches message history with cursor-based pagination (`before` param)
- [ ] Inverted FlatList shows newest messages at bottom
- [ ] Message bubbles show avatar, sender name, content, timestamp
- [ ] Own messages aligned right, others aligned left
- [ ] Send message via `POST /v1/im/channels/:id/messages` with optimistic update
- [ ] Infinite scroll loads older messages
- [ ] New messages from WebSocket appear in real-time

**Verify:** `npx jest __tests__/components/MessageBubble.test.tsx __tests__/hooks/useMessages.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Implement messages API**

```typescript
// src/services/api/messages.ts
import { httpClient } from '../http';
import type { Message, CreateMessageDto, GetMessagesParams, PaginatedMessagesResponse, ThreadResponse } from '@/types/im';

export const messagesApi = {
  getMessages(channelId: string, params?: GetMessagesParams): Promise<Message[]> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.before) qs.set('before', params.before);
    if (params?.after) qs.set('after', params.after);
    const query = qs.toString();
    return httpClient.get(`/v1/im/channels/${channelId}/messages${query ? `?${query}` : ''}`);
  },

  sendMessage(channelId: string, data: CreateMessageDto): Promise<Message> {
    return httpClient.post(`/v1/im/channels/${channelId}/messages`, data);
  },

  getThread(messageId: string, params?: { limit?: number; cursor?: string }): Promise<ThreadResponse> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.cursor) qs.set('cursor', params.cursor);
    const query = qs.toString();
    return httpClient.get(`/v1/im/messages/${messageId}/thread${query ? `?${query}` : ''}`);
  },

  addReaction(messageId: string, emoji: string): Promise<void> {
    return httpClient.post(`/v1/im/messages/${messageId}/reactions`, { emoji });
  },

  removeReaction(messageId: string, emoji: string): Promise<void> {
    return httpClient.delete(`/v1/im/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  },
};
```

- [ ] **Step 2: Implement useMessages hook with infinite query**

```typescript
// src/hooks/useMessages.ts
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi } from '@/services/api/messages';
import type { Message, CreateMessageDto } from '@/types/im';

export function useMessages(channelId: string) {
  return useInfiniteQuery({
    queryKey: ['messages', channelId],
    queryFn: ({ pageParam }) =>
      messagesApi.getMessages(channelId, { limit: 50, before: pageParam }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < 50) return undefined;
      return lastPage[lastPage.length - 1]?.id;
    },
    initialPageParam: undefined as string | undefined,
    select: (data) => ({
      pages: data.pages,
      pageParams: data.pageParams,
      messages: data.pages.flatMap((p) => p),
    }),
  });
}

export function useSendMessage(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMessageDto) => messagesApi.sendMessage(channelId, data),
    onSuccess: (newMessage) => {
      queryClient.setQueryData<{ pages: Message[][] }>(
        ['messages', channelId],
        (old) => {
          if (!old) return old;
          return { ...old, pages: [[newMessage, ...old.pages[0]], ...old.pages.slice(1)] };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
}
```

- [ ] **Step 3: Write MessageBubble test**

```typescript
// __tests__/components/MessageBubble.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { MessageBubble } from '@/components/chat/MessageBubble';

const msg = {
  id: 'm1', channelId: 'ch1', senderId: 'u2', content: 'Hello world',
  type: 'text' as const, isPinned: false, isEdited: false, isDeleted: false,
  createdAt: '2026-04-04T10:00:00Z', updatedAt: '2026-04-04T10:00:00Z',
  sender: { id: 'u2', username: 'alice', displayName: 'Alice', avatarUrl: null },
};

describe('MessageBubble', () => {
  it('renders sender name and content', () => {
    const { getByText } = render(<MessageBubble message={msg} isOwn={false} />);
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Hello world')).toBeTruthy();
  });

  it('does not show sender name for own messages', () => {
    const { queryByText } = render(<MessageBubble message={msg} isOwn={true} />);
    expect(queryByText('Alice')).toBeNull();
  });

  it('shows reply count when present', () => {
    const withReplies = { ...msg, replyCount: 5 };
    const { getByText } = render(<MessageBubble message={withReplies} isOwn={false} />);
    expect(getByText('5 replies')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Implement MessageBubble**

```typescript
// src/components/chat/MessageBubble.tsx
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Avatar } from '@/components/common/Avatar';
import type { Message } from '@/types/im';

interface Props {
  message: Message;
  isOwn: boolean;
  onLongPress?: (message: Message) => void;
  onThreadPress?: (message: Message) => void;
}

export function MessageBubble({ message, isOwn, onLongPress, onThreadPress }: Props) {
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <TouchableOpacity
      style={[styles.row, isOwn && styles.rowOwn]}
      onLongPress={() => onLongPress?.(message)}
      activeOpacity={0.8}
    >
      {!isOwn && (
        <Avatar uri={message.sender?.avatarUrl} name={message.sender?.displayName ?? message.sender?.username ?? '?'} size={32} />
      )}
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        {!isOwn && message.sender && (
          <Text style={styles.sender}>{message.sender.displayName ?? message.sender.username}</Text>
        )}
        <Text style={styles.content}>{message.content}</Text>
        {message.reactions && message.reactions.length > 0 && (
          <View style={styles.reactions}>
            {message.reactions.map((r) => (
              <Text key={r.id} style={styles.reaction}>{r.emoji}</Text>
            ))}
          </View>
        )}
        <Text style={styles.time}>{time}</Text>
        {(message.replyCount ?? 0) > 0 && (
          <TouchableOpacity onPress={() => onThreadPress?.(message)}>
            <Text style={styles.threadLink}>{message.replyCount} replies</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 4, alignItems: 'flex-end' },
  rowOwn: { flexDirection: 'row-reverse' },
  bubble: { maxWidth: '75%', borderRadius: 12, padding: 10 },
  bubbleOwn: { backgroundColor: '#6366f1', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#f3f4f6', borderBottomLeftRadius: 4 },
  sender: { fontSize: 12, fontWeight: '600', color: '#6366f1', marginBottom: 2 },
  content: { fontSize: 15, lineHeight: 20 },
  time: { fontSize: 10, color: '#9ca3af', marginTop: 4, alignSelf: 'flex-end' },
  reactions: { flexDirection: 'row', gap: 4, marginTop: 4 },
  reaction: { fontSize: 16 },
  threadLink: { fontSize: 12, color: '#6366f1', fontWeight: '600', marginTop: 4 },
});
```

- [ ] **Step 5: Implement MessageInput**

```typescript
// src/components/chat/MessageInput.tsx
import { useState, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { wsService } from '@/services/websocket';

interface Props {
  channelId: string;
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function MessageInput({ channelId, onSend, disabled }: Props) {
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    wsService.stopTyping(channelId);
  }, [text, channelId, onSend]);

  const handleChangeText = useCallback((value: string) => {
    setText(value);
    if (value.length > 0) wsService.startTyping(channelId);
    else wsService.stopTyping(channelId);
  }, [channelId]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={handleChangeText}
        placeholder="Message..."
        multiline
        maxLength={10000}
        editable={!disabled}
      />
      <TouchableOpacity
        style={[styles.sendButton, (!text.trim() || disabled) && styles.sendDisabled]}
        onPress={handleSend}
        disabled={!text.trim() || disabled}
      >
        <Text style={styles.sendText}>Send</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120, fontSize: 15 },
  sendButton: { backgroundColor: '#6366f1', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 6: Implement chat screen**

```typescript
// app/chat/[id].tsx
import { useCallback, useEffect } from 'react';
import { View, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMessages, useSendMessage } from '@/hooks/useMessages';
import { useAuthStore } from '@/stores/auth';
import { useAppStore } from '@/stores/app';
import { wsService } from '@/services/websocket';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { MessageInput } from '@/components/chat/MessageInput';
import type { Message } from '@/types/im';

export default function ChatScreen() {
  const { id: channelId } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((s) => s.user?.id);
  const setActiveChannelId = useAppStore((s) => s.setActiveChannelId);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useMessages(channelId!);
  const { mutate: sendMessage } = useSendMessage(channelId!);

  useEffect(() => {
    setActiveChannelId(channelId!);
    wsService.observeChannel(channelId!);
    return () => {
      setActiveChannelId(null);
      wsService.unobserveChannel(channelId!);
    };
  }, [channelId]);

  // Mark last message as read when entering
  useEffect(() => {
    const msgs = data?.messages;
    if (msgs?.length) {
      wsService.markAsRead(channelId!, msgs[0].id);
    }
  }, [data?.messages?.[0]?.id, channelId]);

  const handleSend = useCallback((content: string) => {
    sendMessage({ content, clientMsgId: `${Date.now()}-${Math.random()}` });
  }, [sendMessage]);

  const renderItem = useCallback(({ item }: { item: Message }) => (
    <MessageBubble message={item} isOwn={item.senderId === userId} />
  ), [userId]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={data?.messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        inverted
        onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
        onEndReachedThreshold={0.5}
      />
      <MessageInput channelId={channelId!} onSend={handleSend} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
});
```

- [ ] **Step 7: Run tests and commit**

```bash
npx jest __tests__/components/MessageBubble.test.tsx __tests__/hooks/useMessages.test.ts
git add -A && git commit -m "feat(mobile): add chat detail screen with messages and send"
```

---

### Task 6: Read Status + Typing Indicators

**Goal:** Mark messages as read on view, show typing indicators below message list.

**Files:**
- Create: `team9-mobile/src/components/chat/TypingIndicator.tsx`
- Modify: `team9-mobile/app/chat/[id].tsx` (add TypingIndicator)
- Modify: `team9-mobile/src/hooks/useWebSocketEvents.ts` (add typing event handling)

**Acceptance Criteria:**
- [ ] Entering a channel marks latest message as read via WS `mark_as_read`
- [ ] New messages auto-marked as read when channel is active
- [ ] Typing indicator shows "Alice is typing..." when receiving `user_typing` events
- [ ] Typing indicator disappears after 3s timeout or `isTyping: false`

**Verify:** `npx jest __tests__/components/TypingIndicator.test.tsx` → all pass

**Steps:**

- [ ] **Step 1: Implement TypingIndicator component**

```typescript
// src/components/chat/TypingIndicator.tsx
import { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { wsService } from '@/services/websocket';
import { WS_EVENTS } from '@/types/ws-events';
import type { UserTypingEvent } from '@/types/ws-events';

export function TypingIndicator({ channelId }: { channelId: string }) {
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const timeouts = new Map<string, NodeJS.Timeout>();

    const handler = (data: UserTypingEvent) => {
      if (data.channelId !== channelId) return;
      if (data.isTyping) {
        setTypingUsers((prev) => new Map(prev).set(data.userId, data.username));
        clearTimeout(timeouts.get(data.userId));
        timeouts.set(data.userId, setTimeout(() => {
          setTypingUsers((prev) => { const n = new Map(prev); n.delete(data.userId); return n; });
        }, 3000));
      } else {
        setTypingUsers((prev) => { const n = new Map(prev); n.delete(data.userId); return n; });
        clearTimeout(timeouts.get(data.userId));
      }
    };

    wsService.on<UserTypingEvent>(WS_EVENTS.TYPING.USER, handler);
    return () => {
      wsService.off(WS_EVENTS.TYPING.USER, handler as any);
      timeouts.forEach(clearTimeout);
    };
  }, [channelId]);

  if (typingUsers.size === 0) return null;
  const names = [...typingUsers.values()];
  const text = names.length === 1 ? `${names[0]} is typing...` : `${names.join(', ')} are typing...`;
  return <Text style={styles.text}>{text}</Text>;
}

const styles = StyleSheet.create({
  text: { fontSize: 12, color: '#9ca3af', paddingHorizontal: 16, paddingVertical: 4, fontStyle: 'italic' },
});
```

- [ ] **Step 2: Add TypingIndicator to chat screen (between FlatList and MessageInput)**
- [ ] **Step 3: Write test for TypingIndicator**
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(mobile): add read status and typing indicators"
```

---

### Task 7: @Mention Rendering + Emoji Reactions

**Goal:** Render @mentions as highlighted text in messages. Add long-press reaction picker to message bubbles.

**Files:**
- Create: `team9-mobile/src/components/chat/ReactionPicker.tsx`
- Modify: `team9-mobile/src/components/chat/MessageBubble.tsx` (mention parsing + reaction display)

**Acceptance Criteria:**
- [ ] `@username` in message content rendered with highlight color
- [ ] Long-press on message shows emoji reaction picker overlay
- [ ] Tapping emoji calls `wsService.addReaction()`
- [ ] Existing reactions displayed below message content with counts
- [ ] Tapping own reaction removes it

**Verify:** `npx jest __tests__/components/MessageBubble.test.tsx` → all pass

**Steps:**

- [ ] **Step 1: Add mention parsing to MessageBubble** — regex `/@(\w+)/g`, wrap matches in highlighted `<Text>` spans
- [ ] **Step 2: Implement ReactionPicker** — modal overlay with common emojis (👍❤️😂🎉😮👎), positioned near pressed message
- [ ] **Step 3: Add reaction display** — group reactions by emoji with count, highlight if current user reacted
- [ ] **Step 4: Wire up addReaction/removeReaction** via `wsService` and REST fallback
- [ ] **Step 5: Write tests and commit**

```bash
git add -A && git commit -m "feat(mobile): add @mention rendering and emoji reactions"
```

---

### Task 8: In-App Notification Screen

**Goal:** Build the Notifications tab with notification list, mark-as-read, and real-time updates.

**Files:**
- Create: `team9-mobile/src/services/api/notifications.ts`
- Create: `team9-mobile/src/hooks/useNotifications.ts`
- Create: `team9-mobile/app/(main)/notifications.tsx`

**Acceptance Criteria:**
- [ ] Fetches notifications via `GET /v1/notifications` with cursor pagination
- [ ] Infinite scroll loads older notifications
- [ ] Unread notifications visually highlighted with accent border
- [ ] "Mark All Read" button in header calls `POST /v1/notifications/mark-all-read`
- [ ] Tap notification navigates to relevant chat screen
- [ ] Real-time `notification_new` WS event prepends to list
- [ ] Tab badge shows unread count from `notification_counts_updated` event

**Verify:** `npx jest __tests__/hooks/useNotifications.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Implement notifications API**

```typescript
// src/services/api/notifications.ts
import { httpClient } from '../http';
import type { GetNotificationsParams, GetNotificationsResponse, NotificationCounts } from '@/types/notification';

export const notificationsApi = {
  getNotifications(params?: GetNotificationsParams): Promise<GetNotificationsResponse> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.category) qs.set('category', params.category);
    if (params?.isRead !== undefined) qs.set('isRead', String(params.isRead));
    const query = qs.toString();
    return httpClient.get(`/v1/notifications${query ? `?${query}` : ''}`);
  },
  getCounts(): Promise<NotificationCounts> {
    return httpClient.get('/v1/notifications/counts');
  },
  markAsRead(ids: string[]): Promise<void> {
    return httpClient.post('/v1/notifications/mark-read', { notificationIds: ids });
  },
  markAllAsRead(category?: string): Promise<void> {
    const qs = category ? `?category=${category}` : '';
    return httpClient.post(`/v1/notifications/mark-all-read${qs}`);
  },
};
```

- [ ] **Step 2: Implement useNotifications hook with infinite query**
- [ ] **Step 3: Implement notifications screen** — FlatList with NotificationItem, pull-to-refresh, "Mark All Read" header button
- [ ] **Step 4: Add `notification_new` handler** to useWebSocketEvents to prepend and invalidate
- [ ] **Step 5: Write tests and commit**

```bash
git add -A && git commit -m "feat(mobile): add notification list screen with real-time updates"
```

---

### Task 9: Backend Push Notification Support

**Goal:** Add push token storage and push sending logic to the existing Team9 backend.

**Files:**
- Create: `apps/server/libs/database/schemas/im/user-push-tokens.ts`
- Modify: `apps/server/libs/database/schemas/im/index.ts` (export new table)
- Create: `apps/server/apps/gateway/src/push/push.module.ts`
- Create: `apps/server/apps/gateway/src/push/push.controller.ts`
- Create: `apps/server/apps/gateway/src/push/push.service.ts`
- Create: `apps/server/apps/gateway/src/push/dto/register-token.dto.ts`
- Modify: `apps/server/apps/im-worker/src/` (add push trigger on new message)

**Acceptance Criteria:**
- [ ] New `user_push_tokens` table with `(user_id, token)` unique constraint
- [ ] `POST /v1/push/register` upserts push token for authenticated user
- [ ] `DELETE /v1/push/register` removes push token (on logout)
- [ ] im-worker sends push via Expo Push API when user is offline and receives a message
- [ ] Push skipped when user is online (connected via WebSocket)
- [ ] Push skipped for user's own messages
- [ ] Invalid tokens (DeviceNotRegistered) auto-removed

**Verify:** `cd apps/server && pnpm test -- --testPathPattern=push` → all pass

**Steps:**

- [ ] **Step 1: Create user_push_tokens schema**

```typescript
// apps/server/libs/database/schemas/im/user-push-tokens.ts
import { pgTable, uuid, varchar, pgEnum, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

export const platformEnum = pgEnum('push_platform', ['ios', 'android']);

export const userPushTokens = pgTable('user_push_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 512 }).notNull(),
  platform: platformEnum('platform').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueUserToken: uniqueIndex('uq_user_push_token').on(table.userId, table.token),
}));
```

- [ ] **Step 2: Export from schemas index, run `pnpm db:generate` and `pnpm db:migrate`**
- [ ] **Step 3: Create PushModule with controller and service**
  - `POST /v1/push/register` — upsert token (JwtAuthGuard)
  - `DELETE /v1/push/register` — remove token (JwtAuthGuard)
- [ ] **Step 4: Implement push sending in PushService**
  - `sendPush(userId, title, body, data)` — fetch tokens, POST to `https://exp.host/--/api/v2/push/send`
  - Handle `DeviceNotRegistered` errors by deleting stale tokens
- [ ] **Step 5: Add push trigger in im-worker**
  - On new message: get channel members, filter out sender and online users (check Redis), call PushService
- [ ] **Step 6: Write tests for controller and service**
- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(server): add push notification token management and sending"
```

---

### Task 10: Mobile Push Notification Integration

**Goal:** Register push token on app launch, handle incoming notifications (foreground toast + background navigation).

**Files:**
- Create: `team9-mobile/src/services/push.ts`
- Create: `team9-mobile/src/hooks/usePushNotifications.ts`
- Modify: `team9-mobile/app/_layout.tsx` (add push init)

**Acceptance Criteria:**
- [ ] Requests notification permission on first launch
- [ ] Registers Expo Push Token via `POST /v1/push/register` after login
- [ ] Unregisters token via `DELETE /v1/push/register` on logout
- [ ] Foreground notifications show in-app toast (not system notification)
- [ ] Background notification tap navigates to relevant chat screen
- [ ] Badge count updated from push payload

**Verify:** Manual test on physical device (push notifications don't work in simulators)

**Steps:**

- [ ] **Step 1: Implement push service**

```typescript
// src/services/push.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { httpClient } from './http';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false, // Handle foreground manually
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const pushService = {
  async registerForPush(): Promise<string | null> {
    if (!Device.isDevice) return null;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await httpClient.post('/v1/push/register', {
      token,
      platform: Platform.OS as 'ios' | 'android',
    });
    return token;
  },

  async unregister(token: string): Promise<void> {
    await httpClient.delete('/v1/push/register', { token });
  },
};
```

- [ ] **Step 2: Implement usePushNotifications hook** — register on auth, listen for notification response (tap), navigate to chat
- [ ] **Step 3: Add push registration to root layout** — call after auth check succeeds
- [ ] **Step 4: Add token unregister to logout flow**
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(mobile): add push notification registration and handling"
```

---

### Task 11: Settings Screen + Logout

**Goal:** Build the Me tab with user profile display, notification preferences, and logout button.

**Files:**
- Create: `team9-mobile/app/(main)/settings.tsx`

**Acceptance Criteria:**
- [ ] Shows current user avatar, display name, email
- [ ] Logout button clears tokens, disconnects WS, navigates to login
- [ ] Notification toggle for enabling/disabling push

**Verify:** Manual test — logout flow returns to login screen

**Steps:**

- [ ] **Step 1: Implement settings screen** — display user info from authStore, logout button calls `useLogout()`
- [ ] **Step 2: Add notification toggle** — toggles expo-notifications permissions
- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(mobile): add settings screen with logout"
```

---

## Phase 2: Enhanced Features (Tasks 12-16)

### Task 12: Google OAuth Login

**Goal:** Add Google OAuth login button to login screen using expo-auth-session.

**Files:**
- Modify: `team9-mobile/app/(auth)/login.tsx` (add Google button)
- Modify: `team9-mobile/src/hooks/useAuth.ts` (add useGoogleLogin)
- Modify: `team9-mobile/app.json` (add Google OAuth scheme)

**Acceptance Criteria:**
- [ ] Google sign-in button triggers OAuth flow via `expo-auth-session`
- [ ] Receives Google ID token, sends to `POST /v1/auth/google`
- [ ] On success, stores tokens and navigates to main
- [ ] Handles cancel/error gracefully

**Verify:** Manual test on device with Google account

**Steps:**

- [ ] **Step 1: Configure Google OAuth** — add scheme to app.json, get `EXPO_PUBLIC_GOOGLE_CLIENT_ID` env var
- [ ] **Step 2: Implement useGoogleLogin hook**

```typescript
// Addition to src/hooks/useAuth.ts
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export function useGoogleLogin() {
  const [, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
  });
  const setUser = useAuthStore((s) => s.setUser);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (response?.type === 'success') {
      (async () => {
        try {
          const result = await authApi.googleLogin(response.params.id_token);
          await tokenService.setTokens(result.accessToken, result.refreshToken);
          setUser(result.user);
          router.replace('/(main)/channels');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Google login failed');
        }
      })();
    }
  }, [response]);

  return { promptAsync, error };
}
```

- [ ] **Step 3: Add Google button to login screen** — "Sign in with Google" below divider
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(mobile): add Google OAuth login"
```

---

### Task 13: Thread Drawer

**Goal:** Build a right-sliding drawer that shows thread (parent message + replies) when tapping a message's reply count.

**Files:**
- Create: `team9-mobile/src/components/chat/ThreadDrawer.tsx`
- Create: `team9-mobile/src/hooks/useThread.ts`
- Modify: `team9-mobile/app/chat/[id].tsx` (add ThreadDrawer state)

**Acceptance Criteria:**
- [ ] Tap "N replies" on message opens drawer from right (75% screen width)
- [ ] Left side shows dimmed overlay (tap to dismiss)
- [ ] Drawer shows parent message with accent border, then reply list
- [ ] Input bar at drawer bottom for replying in thread
- [ ] Replies sent with `parentId` set to root message ID
- [ ] Animated with react-native-reanimated + gesture-handler
- [ ] Real-time thread replies via `new_message` events with matching `parentId`

**Verify:** `npx jest __tests__/hooks/useThread.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Implement useThread hook**

```typescript
// src/hooks/useThread.ts
import { useQuery } from '@tanstack/react-query';
import { messagesApi } from '@/services/api/messages';

export function useThread(messageId: string | null) {
  return useQuery({
    queryKey: ['thread', messageId],
    queryFn: () => messagesApi.getThread(messageId!),
    enabled: !!messageId,
  });
}
```

- [ ] **Step 2: Implement ThreadDrawer component**
  - `Animated.View` with `translateX` from `width` to `width * 0.25`
  - `PanGestureHandler` for swipe-to-dismiss
  - Overlay `Pressable` on left side to dismiss
  - FlatList for replies, MessageInput at bottom with `parentId`
- [ ] **Step 3: Wire into chat screen** — `useState<string | null>` for `threadMessageId`, pass `onThreadPress` to MessageBubble
- [ ] **Step 4: Write tests and commit**

```bash
git add -A && git commit -m "feat(mobile): add thread drawer with slide animation"
```

---

### Task 14: File & Image Upload in Chat

**Goal:** Add file/image attachment support to the message input.

**Files:**
- Create: `team9-mobile/src/components/chat/AttachmentPreview.tsx`
- Modify: `team9-mobile/src/components/chat/MessageInput.tsx` (add 📎 📷 buttons)
- Modify: `team9-mobile/src/components/chat/MessageBubble.tsx` (render attachments)

**Acceptance Criteria:**
- [ ] 📷 button opens camera/gallery via `expo-image-picker`
- [ ] 📎 button opens file picker via `expo-document-picker`
- [ ] Selected files shown as thumbnails above input with remove button
- [ ] On send: upload via `POST /v1/im/messages/:id/attachments` (multipart), then send message with attachment refs
- [ ] Image attachments render as inline previews in message bubbles
- [ ] File attachments render as icon + filename + size
- [ ] Tap image opens full-screen viewer

**Verify:** Manual test — send image from gallery, send PDF file

**Steps:**

- [ ] **Step 1: Implement AttachmentPreview** — horizontal scroll of thumbnails with X button to remove
- [ ] **Step 2: Add picker buttons to MessageInput**

```typescript
// Addition to MessageInput.tsx
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

const pickImage = async () => {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
  });
  if (!result.canceled) {
    onAttach(result.assets.map(a => ({
      uri: a.uri, name: a.fileName ?? 'image.jpg',
      type: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? 0,
    })));
  }
};

const pickFile = async () => {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
  if (!result.canceled) {
    onAttach(result.assets.map(a => ({
      uri: a.uri, name: a.name,
      type: a.mimeType ?? 'application/octet-stream', size: a.size ?? 0,
    })));
  }
};
```

- [ ] **Step 3: Implement upload flow** — build FormData, POST to upload endpoint, include fileKey in CreateMessageDto.attachments
- [ ] **Step 4: Render attachments in MessageBubble** — Image component for images, icon+text for files
- [ ] **Step 5: Write tests and commit**

```bash
git add -A && git commit -m "feat(mobile): add file and image upload in chat"
```

---

### Task 15: Global Search Screen

**Goal:** Build the Search tab with debounced search across messages, channels, and users.

**Files:**
- Create: `team9-mobile/src/services/api/search.ts`
- Create: `team9-mobile/src/hooks/useSearch.ts`
- Create: `team9-mobile/src/components/search/SearchBar.tsx`
- Create: `team9-mobile/src/components/search/SearchFilters.tsx`
- Create: `team9-mobile/src/components/search/SearchResultItem.tsx`
- Create: `team9-mobile/app/(main)/search.tsx`

**Acceptance Criteria:**
- [ ] Search input at top with 300ms debounce
- [ ] Filter tabs: All / Messages / Channels / Users
- [ ] Message results show channel context, sender, timestamp, content with keyword highlight
- [ ] Channel results show icon, name, member count
- [ ] User results show avatar, display name, status
- [ ] Tap message result navigates to chat screen
- [ ] Empty state when no results

**Verify:** `npx jest __tests__/hooks/useSearch.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Implement search API**

```typescript
// src/services/api/search.ts
import { httpClient } from '../http';

interface SearchOptions { limit?: number; offset?: number; type?: string }

export const searchApi = {
  search(q: string, options?: SearchOptions) {
    const qs = new URLSearchParams({ q });
    if (options?.limit) qs.set('limit', String(options.limit));
    if (options?.offset) qs.set('offset', String(options.offset));
    if (options?.type) qs.set('type', options.type);
    return httpClient.get(`/v1/search?${qs}`);
  },
};
```

- [ ] **Step 2: Implement useSearch hook** — `useQuery` with debounced query string, `enabled` only when query length >= 2
- [ ] **Step 3: Implement SearchBar** — TextInput with clear button, debounce via `useRef` + `setTimeout`
- [ ] **Step 4: Implement SearchFilters** — horizontal pill tabs (All/Messages/Channels/Users), `activeFilter` state
- [ ] **Step 5: Implement SearchResultItem** — conditional render based on result type, keyword highlighting via regex split
- [ ] **Step 6: Implement search screen** — compose SearchBar + SearchFilters + FlatList of results
- [ ] **Step 7: Write tests and commit**

```bash
git add -A && git commit -m "feat(mobile): add global search screen"
```

---

### Task 16: Internationalization (i18n)

**Goal:** Add i18next with zh-Hans, zh-Hant, en support. All user-facing strings via translation keys.

**Files:**
- Create: `team9-mobile/src/i18n/index.ts`
- Create: `team9-mobile/src/i18n/en.json`
- Create: `team9-mobile/src/i18n/zh-Hans.json`
- Create: `team9-mobile/src/i18n/zh-Hant.json`
- Modify: `team9-mobile/app/_layout.tsx` (init i18n)
- Modify: `team9-mobile/app/(main)/settings.tsx` (language selector)
- Modify: all screen files (replace hardcoded strings with `t()` calls)

**Acceptance Criteria:**
- [ ] i18next initialized with device locale detection
- [ ] User can switch language in Settings (saved to expo-secure-store)
- [ ] Language change applies instantly without app restart
- [ ] All user-facing strings use translation keys
- [ ] Fallback to English for missing translations

**Verify:** `npx jest __tests__/i18n.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Implement i18n config**

```typescript
// src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import en from './en.json';
import zhHans from './zh-Hans.json';
import zhHant from './zh-Hant.json';

const resources = { en: { translation: en }, 'zh-Hans': { translation: zhHans }, 'zh-Hant': { translation: zhHant } };

export async function initI18n() {
  const saved = await SecureStore.getItemAsync('locale');
  const deviceLocale = Localization.getLocales()[0]?.languageTag ?? 'en';
  // Map device locale to our supported keys
  const mapped = deviceLocale.startsWith('zh-Hant') ? 'zh-Hant'
    : deviceLocale.startsWith('zh') ? 'zh-Hans' : 'en';

  await i18n.use(initReactI18next).init({
    resources,
    lng: saved ?? mapped,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
}

export default i18n;
```

- [ ] **Step 2: Create translation files** — en.json, zh-Hans.json, zh-Hant.json with keys for all screens (login, channels, chat, notifications, settings, search, common)
- [ ] **Step 3: Add language selector to Settings** — picker with 3 options, saves to SecureStore, calls `i18n.changeLanguage()`
- [ ] **Step 4: Replace hardcoded strings** across all screens with `useTranslation()` hook and `t('key')` calls
- [ ] **Step 5: Init i18n in root layout** before rendering
- [ ] **Step 6: Write test verifying language switch works**
- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(mobile): add i18n with zh-Hans, zh-Hant, en support"
```

---

## API Barrel Export

Create after all API modules are done:

```typescript
// src/services/api/index.ts
export { authApi } from './auth';
export { channelsApi } from './channels';
export { messagesApi } from './messages';
export { notificationsApi } from './notifications';
export { searchApi } from './search';
```

---

## Task Dependencies

```
Task 0 (Scaffolding)
  └── Task 1 (HTTP + Token)
       └── Task 2 (Auth + Login screens)
            ├── Task 3 (WebSocket)
            │    └── Task 4 (Channel list)
            │         └── Task 5 (Chat detail)
            │              ├── Task 6 (Read status + typing)
            │              ├── Task 7 (Mentions + reactions)
            │              ├── Task 13 (Thread drawer)
            │              └── Task 14 (File upload)
            ├── Task 8 (Notifications)
            ├── Task 12 (Google OAuth)
            └── Task 15 (Search)
  Task 9 (Backend push) — independent, can parallel with mobile tasks
  Task 10 (Mobile push) — depends on Task 9 + Task 2
  Task 11 (Settings) — depends on Task 2
  Task 16 (i18n) — last, touches all screens
```
