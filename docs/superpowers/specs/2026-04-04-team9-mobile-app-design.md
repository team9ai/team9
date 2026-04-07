# Team9 Mobile App Design Spec

## Overview

A mobile version of Team9 built with React Native (Expo), targeting both iOS and Android. The app focuses on chat and notifications, providing a streamlined mobile experience for the existing Team9 instant messaging platform.

**Project type:** Independent repository (shares only backend API with the existing codebase)
**Target timeline:** 6-8 weeks, delivered in two phases
**Target platforms:** iOS + Android

## Technology Stack

| Layer              | Technology                                           | Rationale                                                                                                          |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Framework          | React Native + Expo SDK 53                           | Team has React/TS experience; Expo provides managed workflow for push notifications, file picking, and OTA updates |
| Language           | TypeScript 5.8+                                      | Consistent with existing team skills                                                                               |
| Routing            | Expo Router (file-based)                             | Same mental model as TanStack Router used in web client                                                            |
| State (client)     | Zustand                                              | Same pattern as web client                                                                                         |
| State (server)     | TanStack React Query                                 | Same pattern as web client; handles caching, pagination, invalidation                                              |
| Real-time          | Socket.io-client                                     | Direct compatibility with existing backend WebSocket gateway                                                       |
| Push notifications | Expo Notifications                                   | Unified FCM (Android) + APNs (iOS) via Expo Push service                                                           |
| Auth               | expo-auth-session (Google OAuth) + custom email flow | Matches existing backend auth endpoints                                                                            |
| i18n               | i18next + react-i18next                              | Same library as web client; supports zh-Hans, zh-Hant, en                                                          |
| File picking       | expo-image-picker + expo-document-picker             | Camera, photo library, and document selection                                                                      |
| Secure storage     | expo-secure-store                                    | Platform keychain for JWT tokens (more secure than localStorage)                                                   |

## Project Structure

```
team9-mobile/
├── app/                          # Expo Router pages (file-based routing)
│   ├── (auth)/                   # Unauthenticated screens
│   │   ├── login.tsx             # Email + Google OAuth login
│   │   └── verify.tsx            # Verification code input
│   ├── (main)/                   # Authenticated screens (tab navigator)
│   │   ├── _layout.tsx           # Bottom tab navigation
│   │   ├── channels.tsx          # Channel/DM list (Messages tab)
│   │   ├── chat/[id].tsx         # Chat detail with message input
│   │   ├── search.tsx            # Global search (Search tab)
│   │   ├── notifications.tsx     # Notification list (Notifications tab)
│   │   └── settings.tsx          # Profile & settings (Me tab)
│   └── _layout.tsx               # Root layout (auth guard, providers)
├── src/
│   ├── services/
│   │   ├── http.ts               # HTTP client (fetch-based, token interceptor)
│   │   ├── api/                  # API modules (auth, im, notifications, search, user)
│   │   ├── websocket.ts          # Socket.io-client wrapper
│   │   └── push.ts               # Expo Notifications registration & handling
│   ├── stores/
│   │   ├── auth.ts               # Auth state (tokens, user info)
│   │   ├── app.ts                # App-level state (connection status, theme, locale)
│   │   └── notifications.ts      # Notification badge counts
│   ├── components/
│   │   ├── chat/                 # ChatBubble, MessageInput, ThreadDrawer, AttachmentPreview
│   │   ├── channel/              # ChannelListItem, ChannelHeader
│   │   ├── search/               # SearchBar, SearchResultItem, SearchFilters
│   │   └── common/               # Avatar, Badge, EmptyState, LoadingSpinner
│   ├── hooks/
│   │   ├── useWebSocketEvents.ts # Central WS event listener setup
│   │   ├── useAuth.ts            # Auth flow hooks
│   │   ├── usePushNotifications.ts # Push token registration & notification handling
│   │   └── useMessages.ts        # Message query/mutation hooks
│   ├── i18n/
│   │   ├── index.ts              # i18next configuration
│   │   ├── zh-Hans.json          # Simplified Chinese
│   │   ├── zh-Hant.json          # Traditional Chinese
│   │   └── en.json               # English
│   └── types/                    # TypeScript type definitions
│       ├── im.ts                 # Message, Channel, User types
│       ├── ws-events.ts          # WebSocket event types
│       └── notification.ts       # Notification types
├── app.json                      # Expo configuration
├── eas.json                      # EAS Build configuration
└── package.json
```

## Navigation & Screen Design

### Navigation Structure

4-tab bottom navigation:

| Tab           | Icon | Screen              | Description                                                                                                                            |
| ------------- | ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Messages      | 💬   | `channels.tsx`      | Channel and DM list, sorted by recent activity. Each item shows channel name, last message preview, timestamp, and unread badge.       |
| Search        | 🔍   | `search.tsx`        | Global search with filter tabs: All / Messages / Channels / Users. Message results show context with keyword highlighting.             |
| Notifications | 🔔   | `notifications.tsx` | Notification list with categories: mentions, replies, system. Supports mark-as-read and mark-all-read. Unread count badge on tab icon. |
| Me            | 👤   | `settings.tsx`      | User profile, language preference, notification settings, logout.                                                                      |

### Screen Details

**Login Screen (`(auth)/login.tsx`)**

- Email input field with "Send Verification Code" button
- Divider with "or"
- Google OAuth button (via `expo-auth-session`)
- On success, stores JWT tokens in `expo-secure-store` and navigates to main

**Verify Screen (`(auth)/verify.tsx`)**

- 6-digit verification code input
- Countdown timer for resend
- Calls existing `POST /v1/auth/verify-code` endpoint

**Channel List (`(main)/channels.tsx`)**

- Flat list of all channels and DMs the user belongs to
- Each item: avatar/icon, name, last message preview, timestamp, unread count badge
- Pull-to-refresh
- Tap navigates to chat detail

**Chat Detail (`(main)/chat/[id].tsx`)**

- Header: channel name, member count / online status
- Message list: inverted FlatList (or FlashList for performance), grouped by date
- Each message bubble: avatar, sender name, content, timestamp, reactions
- Tap-and-hold on message: reaction picker, reply in thread
- Thread indicator: shows reply count, tap opens Thread drawer
- Input bar: text input + 📎 file picker + 📷 camera/gallery + send button
- Attachment preview: thumbnails above input bar with remove button
- Typing indicator: shown below message list

**Thread Drawer**

- Slides in from right side, covers ~75% of screen width
- Left side shows semi-transparent overlay of chat (tap to dismiss)
- Header: "Thread" title + close button
- Original message displayed with left accent border
- Reply list below
- Input bar at bottom for thread replies
- Implemented as a custom animated drawer (react-native-reanimated + gesture-handler)

**Search Screen (`(main)/search.tsx`)**

- Search input at top (debounced, 300ms)
- Filter tabs: All | Messages | Channels | Users
- Message results: channel context, sender, timestamp, content with keyword highlight
- Channel results: icon, name, member count
- User results: avatar, display name, status
- Tap message result navigates to that message in chat detail
- Calls existing `GET /v1/search/*` endpoints

**Notification Screen (`(main)/notifications.tsx`)**

- List of notifications sorted by time
- Unread notifications highlighted with accent border
- Each item: timestamp, description, content preview
- "Mark All Read" button in header
- Tap notification navigates to relevant chat/message
- Pagination via cursor-based infinite scroll

**Settings Screen (`(main)/settings.tsx`)**

- User avatar and display name
- Language selector: 简体中文 / 繁體中文 / English
- Notification preferences toggle
- Logout button

## Architecture & Data Flow

### API Communication

The mobile app communicates with the existing Team9 backend without any modification to existing endpoints (except push notification support).

**HTTP Layer:**

- Custom fetch-based HTTP client mirroring the web client's pattern
- Request interceptor: attaches `Authorization: Bearer <token>` header
- Response interceptor: handles 401 by attempting token refresh via `POST /v1/auth/refresh`
- Token refresh deduplication: only one refresh request in-flight at a time
- Tokens stored in `expo-secure-store` (iOS Keychain / Android Keystore)
- Base URL configured via environment variable

**WebSocket Layer:**

- Socket.io-client connecting to backend `/im` namespace
- Auth token passed in handshake `auth` object
- Auto-reconnection with exponential backoff
- On reconnect: re-join channels, invalidate React Query caches
- Connection status tracked in Zustand store

**Key API Endpoints Used:**

| Domain        | Endpoint                                    | Usage                                  |
| ------------- | ------------------------------------------- | -------------------------------------- |
| Auth          | `POST /v1/auth/start`                       | Initiate email login                   |
| Auth          | `POST /v1/auth/verify-code`                 | Verify email code                      |
| Auth          | `POST /v1/auth/refresh`                     | Refresh JWT token                      |
| Auth          | `POST /v1/auth/google`                      | Google OAuth login                     |
| IM            | `GET /v1/im/channels`                       | Fetch channel list                     |
| IM            | `GET /v1/im/channels/:id/messages`          | Fetch message history (paginated)      |
| IM            | `POST /v1/im/channels/:id/messages`         | Send message                           |
| IM            | `POST /v1/im/messages/:id/attachments`      | Upload file attachment                 |
| IM            | `GET /v1/im/channels/:id/threads/:parentId` | Fetch thread replies                   |
| Search        | `GET /v1/search/messages`                   | Search messages                        |
| Search        | `GET /v1/search/channels`                   | Search channels                        |
| Search        | `GET /v1/search/users`                      | Search users                           |
| Notifications | `GET /v1/notifications`                     | Fetch notifications (cursor-paginated) |
| Notifications | `POST /v1/notifications/mark-read`          | Mark as read                           |
| Notifications | `POST /v1/notifications/mark-all-read`      | Mark all as read                       |
| Push (NEW)    | `POST /v1/push/register`                    | Register push token                    |
| Push (NEW)    | `DELETE /v1/push/register`                  | Unregister push token                  |

### WebSocket Events

All events mirror the existing web client's event contract:

**Listened events (server → client):**

- `new_message` — new message in a joined channel
- `message_updated` — message edited
- `message_deleted` — message removed
- `user_typing` — typing indicator from another user
- `read_status_updated` — read receipt update
- `reaction_added` / `reaction_removed` — emoji reaction changes
- `channel_created` / `channel_updated` — channel changes
- `notification_received` — new notification

**Emitted events (client → server):**

- `join_channel` / `leave_channel` — channel subscription
- `typing_start` / `typing_stop` — typing indicators
- `mark_as_read` — mark messages as read
- `add_reaction` / `remove_reaction` — emoji reactions

### State Management

**Zustand Stores:**

| Store           | Responsibility                                                           |
| --------------- | ------------------------------------------------------------------------ |
| `auth`          | Current user info, token state, login/logout actions                     |
| `app`           | WebSocket connection status, active channel ID, theme, locale preference |
| `notifications` | Unread notification count (for tab badge)                                |

**React Query Keys:**

| Key Pattern                   | Data                               |
| ----------------------------- | ---------------------------------- |
| `['channels']`                | Channel list                       |
| `['messages', channelId]`     | Message history (infinite query)   |
| `['thread', parentMessageId]` | Thread replies                     |
| `['search', type, query]`     | Search results                     |
| `['notifications']`           | Notification list (infinite query) |
| `['user', userId]`            | User profile                       |

### Push Notification Architecture

```
Mobile App                    Backend                    Push Service
─────────                    ───────                    ────────────
1. App launch
   → requestPermissions()
   → getExpoPushToken()
   ─────────────────────►
   POST /v1/push/register
   { token, platform }
                              Store token in
                              user_push_tokens table
                              ─────────────────────────►

2. New message arrives
   (user is offline)
                              im-worker detects
                              user not connected
                              via WebSocket
                              ─────────────────────────►
                              Send via Expo Push API
                              (routes to FCM/APNs)
                                                         ─────────────►
                                                         Deliver to device

3. User taps notification
   → Parse notification data
   → Navigate to chat/[channelId]

4. User logs out
   ─────────────────────►
   DELETE /v1/push/register
   { token }
                              Remove token from
                              user_push_tokens table
```

**Push notification payload structure:**

```json
{
  "to": "ExponentPushToken[xxx]",
  "title": "#general - Alice",
  "body": "新版本部署完成了 🎉",
  "data": {
    "type": "new_message",
    "channelId": "channel-uuid",
    "messageId": "message-uuid"
  }
}
```

**Notification handling:**

- **Foreground:** Show in-app toast/banner (not system notification)
- **Background/Killed:** System notification via FCM/APNs, tap navigates to relevant screen
- **Badge count:** Updated server-side in push payload based on unread count

### File Upload Flow

```
1. User taps 📎 or 📷
   → expo-document-picker (files) or expo-image-picker (camera/gallery)
2. Selected file shown as thumbnail in attachment preview area
   → User can remove before sending
3. User taps Send
   → Upload file: POST /v1/im/messages/:id/attachments (multipart/form-data)
   → Send message with attachment references
4. Recipients see attachment in message bubble
   → Images: inline preview (tap for full screen)
   → Files: icon + filename + size (tap to download/open)
```

## Backend Changes Required

The existing backend API is sufficient for most mobile features. Only push notification support requires new work:

### 1. New Database Table: `user_push_tokens`

| Column     | Type                   | Description             |
| ---------- | ---------------------- | ----------------------- |
| id         | uuid                   | Primary key             |
| user_id    | uuid                   | FK to users table       |
| token      | varchar                | Expo Push Token string  |
| platform   | enum('ios', 'android') | Device platform         |
| created_at | timestamp              | Token registration time |
| updated_at | timestamp              | Last activity time      |

Unique constraint on `(user_id, token)` to prevent duplicate registrations.

### 2. New API Endpoints

**`POST /v1/push/register`** — Register a push token

- Auth: JWT required
- Body: `{ token: string, platform: 'ios' | 'android' }`
- Upserts token for the authenticated user

**`DELETE /v1/push/register`** — Unregister a push token

- Auth: JWT required
- Body: `{ token: string }`
- Removes the token (called on logout)

### 3. im-worker Push Logic

When a new message arrives in im-worker:

1. Determine target users (channel members)
2. Check which users are NOT connected via WebSocket (query Redis adapter)
3. For offline users, fetch their push tokens from `user_push_tokens`
4. Send push notification via Expo Push API (`https://exp.host/--/api/v2/push/send`)
5. Handle push failures: remove invalid tokens (DeviceNotRegistered error)

**Trigger conditions for push:**

- New message in a channel the user belongs to (user is offline)
- Direct mention (@user) — always push even if user has app open (via data-only push)
- Reply in a thread the user participated in

**Do not push when:**

- User is currently connected via WebSocket and viewing the same channel
- Message is from the user themselves

## Internationalization

Three supported locales with detection priority:

1. User's saved preference (stored in `expo-secure-store`)
2. Device system locale (`expo-localization`)
3. Fallback: `en`

| Locale Key | Label    | Example     |
| ---------- | -------- | ----------- |
| `zh-Hans`  | 简体中文 | 新消息      |
| `zh-Hant`  | 繁體中文 | 新訊息      |
| `en`       | English  | New message |

Language switcher in Settings screen. Changing locale updates the stored preference and triggers i18next language change (no app restart needed).

## Delivery Phases

### Phase 1: Core Chat + Notifications (Weeks 1-4)

- Project scaffolding (Expo, routing, base components)
- Email login + token management
- Channel list screen
- Chat detail screen (text messages, real-time via Socket.io)
- Message read status + typing indicators
- @mention rendering
- Emoji reactions
- In-app notification list
- Push notification infrastructure (backend + mobile)
- Basic settings screen (profile, logout)

**Milestone:** Usable chat app with push notifications.

### Phase 2: Enhanced Features (Weeks 5-8)

- Google OAuth login
- Thread drawer (right-slide panel with animations)
- File and image upload in chat
- Global search (messages, channels, users)
- Internationalization (zh-Hans, zh-Hant, en)
- Notification preferences
- Polish: pull-to-refresh, empty states, error handling, loading skeletons

**Milestone:** Feature-complete MVP ready for TestFlight/internal testing.

## Testing Strategy

- **Unit tests:** Jest for services, stores, and utility functions
- **Component tests:** React Native Testing Library for UI components
- **Integration tests:** API service tests with MSW (Mock Service Worker)
- **E2E tests:** Detox for critical user flows (login, send message, receive push)
- **Target:** 100% coverage for new code per project requirements
