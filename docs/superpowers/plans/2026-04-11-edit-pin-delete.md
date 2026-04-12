# Message Edit, Pin, and Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the stubbed frontend handlers for message editing (inline Lexical editor), pin/unpin (optimistic cache updates), and delete (confirmation dialog + admin permissions), plus backend admin-delete support.

**Architecture:** Three independent frontend features backed by existing REST APIs and WebSocket events. Editing replaces the message content area with a Lexical editor instance. Pin/unpin uses optimistic React Query cache mutations following the existing reaction pattern. Delete adds an AlertDialog confirmation and extends permissions to channel admins. Backend change is limited to the `delete()` method in `messages.service.ts` and its controller call.

**Tech Stack:** React 19, Lexical, TanStack React Query 5, Radix UI AlertDialog, NestJS, Drizzle ORM, i18next

---

## File Structure

| Action | File                                                                        | Responsibility                                                                                                                               |
| ------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Modify | `apps/client/src/components/channel/editor/RichTextEditor.tsx`              | Add `initialHtml` prop, `InitialHtmlPlugin`, `onCancel` prop, conditional Esc handler                                                        |
| Modify | `apps/client/src/components/channel/MessageItem.tsx`                        | Accept `isEditing`, `onEditSave`, `onEditCancel` props; render editor when editing; update edited timestamp display; accept `canDelete` prop |
| Modify | `apps/client/src/components/channel/MessageList.tsx`                        | Manage `editingMessageId` state; wire edit/pin/delete handlers; pass user role for delete permission                                         |
| Modify | `apps/client/src/components/channel/MessageContextMenu.tsx`                 | Accept `canDelete` prop separate from `isOwnMessage`                                                                                         |
| Create | `apps/client/src/components/channel/DeleteMessageDialog.tsx`                | Confirmation dialog for message deletion                                                                                                     |
| Modify | `apps/client/src/hooks/useMessages.ts`                                      | Add `usePinMessage`, `useUnpinMessage` hooks with optimistic updates                                                                         |
| Modify | `apps/client/src/lib/date-utils.ts`                                         | Add `formatEditedTime` helper                                                                                                                |
| Modify | `apps/client/src/i18n/locales/*/message.json` (8 files)                     | Add i18n keys for edit, pin, delete                                                                                                          |
| Modify | `apps/server/apps/gateway/src/im/messages/messages.controller.ts`           | Pass role to `delete()`                                                                                                                      |
| Modify | `apps/server/apps/gateway/src/im/messages/messages.service.ts`              | Accept optional `role` in `delete()`, allow admin/owner                                                                                      |
| Test   | `apps/client/src/components/channel/__tests__/DeleteMessageDialog.test.tsx` | Dialog render, confirm/cancel callbacks                                                                                                      |
| Test   | `apps/client/src/hooks/__tests__/usePinMessage.test.ts`                     | Optimistic update, rollback                                                                                                                  |
| Test   | `apps/server/apps/gateway/src/im/messages/messages.controller.spec.ts`      | Admin delete permission                                                                                                                      |
| Test   | `apps/server/apps/gateway/src/im/messages/messages.service.spec.ts`         | Role-based delete logic                                                                                                                      |

---

### Task 0: i18n Keys for All Three Features

**Goal:** Add all new translation keys upfront so subsequent tasks can reference them without context-switching.

**Files:**

- Modify: `apps/client/src/i18n/locales/en/message.json`
- Modify: `apps/client/src/i18n/locales/zh-CN/message.json`
- Modify: `apps/client/src/i18n/locales/zh-TW/message.json`
- Modify: `apps/client/src/i18n/locales/ja/message.json`
- Modify: `apps/client/src/i18n/locales/ko/message.json`
- Modify: `apps/client/src/i18n/locales/de/message.json`
- Modify: `apps/client/src/i18n/locales/es/message.json`
- Modify: `apps/client/src/i18n/locales/fr/message.json`

**Acceptance Criteria:**

- [ ] All 8 locales have keys: `editedAt`, `editSave`, `editCancel`, `editHint`, `deleteConfirmTitle`, `deleteConfirmDescription`, `deleteConfirm`, `deleteCancel`
- [ ] Key `editedAt` uses interpolation: `(edited at {{time}})`
- [ ] Existing keys unchanged

**Verify:** `pnpm build:client` succeeds (type-checks i18n usage)

**Steps:**

- [ ] **Step 1: Add keys to en/message.json**

Add after the existing `"botGenerating"` line (end of file, before closing `}`):

```json
"editedAt": "(edited at {{time}})",
"editSave": "Save",
"editCancel": "Cancel",
"editHint": "Esc to cancel \u00b7 Enter to save",
"deleteConfirmTitle": "Delete message",
"deleteConfirmDescription": "Are you sure you want to delete this message? This action cannot be undone.",
"deleteConfirm": "Delete",
"deleteCancel": "Cancel"
```

- [ ] **Step 2: Add equivalent keys to all other 7 locales**

zh-CN:

```json
"editedAt": "(已编辑于 {{time}})",
"editSave": "保存",
"editCancel": "取消",
"editHint": "Esc 取消 \u00b7 Enter 保存",
"deleteConfirmTitle": "删除消息",
"deleteConfirmDescription": "确定要删除这条消息吗？此操作无法撤销。",
"deleteConfirm": "删除",
"deleteCancel": "取消"
```

zh-TW:

```json
"editedAt": "(已編輯於 {{time}})",
"editSave": "儲存",
"editCancel": "取消",
"editHint": "Esc 取消 \u00b7 Enter 儲存",
"deleteConfirmTitle": "刪除訊息",
"deleteConfirmDescription": "確定要刪除這則訊息嗎？此操作無法復原。",
"deleteConfirm": "刪除",
"deleteCancel": "取消"
```

ja:

```json
"editedAt": "({{time}}に編集済み)",
"editSave": "保存",
"editCancel": "キャンセル",
"editHint": "Esc キャンセル \u00b7 Enter 保存",
"deleteConfirmTitle": "メッセージを削除",
"deleteConfirmDescription": "このメッセージを削除しますか？この操作は元に戻せません。",
"deleteConfirm": "削除",
"deleteCancel": "キャンセル"
```

ko:

```json
"editedAt": "({{time}}에 수정됨)",
"editSave": "저장",
"editCancel": "취소",
"editHint": "Esc 취소 \u00b7 Enter 저장",
"deleteConfirmTitle": "메시지 삭제",
"deleteConfirmDescription": "이 메시지를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
"deleteConfirm": "삭제",
"deleteCancel": "취소"
```

de:

```json
"editedAt": "(bearbeitet um {{time}})",
"editSave": "Speichern",
"editCancel": "Abbrechen",
"editHint": "Esc Abbrechen \u00b7 Enter Speichern",
"deleteConfirmTitle": "Nachricht löschen",
"deleteConfirmDescription": "Möchten Sie diese Nachricht wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.",
"deleteConfirm": "Löschen",
"deleteCancel": "Abbrechen"
```

es:

```json
"editedAt": "(editado a las {{time}})",
"editSave": "Guardar",
"editCancel": "Cancelar",
"editHint": "Esc cancelar \u00b7 Enter guardar",
"deleteConfirmTitle": "Eliminar mensaje",
"deleteConfirmDescription": "¿Estás seguro de que quieres eliminar este mensaje? Esta acción no se puede deshacer.",
"deleteConfirm": "Eliminar",
"deleteCancel": "Cancelar"
```

fr:

```json
"editedAt": "(modifié à {{time}})",
"editSave": "Enregistrer",
"editCancel": "Annuler",
"editHint": "Esc annuler \u00b7 Entrée enregistrer",
"deleteConfirmTitle": "Supprimer le message",
"deleteConfirmDescription": "Êtes-vous sûr de vouloir supprimer ce message ? Cette action est irréversible.",
"deleteConfirm": "Supprimer",
"deleteCancel": "Annuler"
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/i18n/locales/*/message.json
git commit -m "feat(i18n): add edit, pin, delete message translation keys"
```

---

### Task 1: Pin/Unpin Hooks with Optimistic Updates

**Goal:** Create `usePinMessage` and `useUnpinMessage` React Query mutation hooks that optimistically update the message cache, and wire them into `MessageList.tsx`.

**Files:**

- Modify: `apps/client/src/hooks/useMessages.ts:1925` (after `useDeleteMessage`)
- Modify: `apps/client/src/components/channel/MessageList.tsx:640-676`
- Test: `apps/client/src/hooks/__tests__/usePinMessage.test.ts`

**Acceptance Criteria:**

- [ ] `usePinMessage(channelId)` calls `POST /messages/:id/pin` and optimistically sets `isPinned: true`
- [ ] `useUnpinMessage(channelId)` calls `DELETE /messages/:id/pin` and optimistically sets `isPinned: false`
- [ ] On error, the optimistic update rolls back to the previous cache state
- [ ] `handlePin` in `ChannelMessageItem` calls the correct hook based on `message.isPinned`
- [ ] Tests cover: optimistic update, error rollback

**Verify:** `pnpm jest --testPathPattern=usePinMessage` → all pass

**Steps:**

- [ ] **Step 1: Write tests for pin/unpin hooks**

Create `apps/client/src/hooks/__tests__/usePinMessage.test.ts`:

```typescript
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { usePinMessage, useUnpinMessage } from "../useMessages";
import imApi from "@/services/api/im";

jest.mock("@/services/api/im");

const channelId = "ch-1";
const messageId = "msg-1";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Seed cache with a message page
  queryClient.setQueryData(["messages", channelId], {
    pages: [
      {
        messages: [
          { id: messageId, channelId, isPinned: false, content: "hello" },
        ],
        nextCursor: null,
      },
    ],
    pageParams: [undefined],
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient };
}

describe("usePinMessage", () => {
  it("optimistically sets isPinned to true", async () => {
    (imApi.messages.pinMessage as jest.Mock).mockResolvedValue(undefined);
    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => usePinMessage(channelId), { wrapper });

    await act(() => result.current.mutateAsync(messageId));

    const data = queryClient.getQueryData<any>(["messages", channelId]);
    expect(data.pages[0].messages[0].isPinned).toBe(true);
  });

  it("rolls back on error", async () => {
    (imApi.messages.pinMessage as jest.Mock).mockRejectedValue(
      new Error("403"),
    );
    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => usePinMessage(channelId), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync(messageId);
      } catch {}
    });

    await waitFor(() => {
      const data = queryClient.getQueryData<any>(["messages", channelId]);
      expect(data.pages[0].messages[0].isPinned).toBe(false);
    });
  });
});

describe("useUnpinMessage", () => {
  it("optimistically sets isPinned to false", async () => {
    (imApi.messages.unpinMessage as jest.Mock).mockResolvedValue(undefined);
    const { wrapper, queryClient } = createWrapper();
    // Seed as pinned
    queryClient.setQueryData(["messages", channelId], {
      pages: [
        {
          messages: [
            { id: messageId, channelId, isPinned: true, content: "hello" },
          ],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    });
    const { result } = renderHook(() => useUnpinMessage(channelId), {
      wrapper,
    });

    await act(() => result.current.mutateAsync(messageId));

    const data = queryClient.getQueryData<any>(["messages", channelId]);
    expect(data.pages[0].messages[0].isPinned).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm jest --testPathPattern=usePinMessage`
Expected: FAIL — `usePinMessage` and `useUnpinMessage` not exported

- [ ] **Step 3: Implement hooks in useMessages.ts**

Add after `useDeleteMessage` (around line 1925) in `apps/client/src/hooks/useMessages.ts`:

```typescript
/**
 * Hook to pin a message with optimistic update
 */
export function usePinMessage(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) => imApi.messages.pinMessage(messageId),

    onMutate: async (messageId: string) => {
      await queryClient.cancelQueries({ queryKey: ["messages", channelId] });
      const previous = queryClient.getQueryData(["messages", channelId]);

      queryClient.setQueriesData(
        { queryKey: ["messages", channelId] },
        (old: MessagesQueryData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) =>
              setMessages(
                page,
                getMessages(page).map((msg) =>
                  msg.id === messageId ? { ...msg, isPinned: true } : msg,
                ),
              ),
            ),
          };
        },
      );

      return { previous };
    },

    onError: (_err, _messageId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["messages", channelId], context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
    },
  });
}

/**
 * Hook to unpin a message with optimistic update
 */
export function useUnpinMessage(channelId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) => imApi.messages.unpinMessage(messageId),

    onMutate: async (messageId: string) => {
      await queryClient.cancelQueries({ queryKey: ["messages", channelId] });
      const previous = queryClient.getQueryData(["messages", channelId]);

      queryClient.setQueriesData(
        { queryKey: ["messages", channelId] },
        (old: MessagesQueryData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) =>
              setMessages(
                page,
                getMessages(page).map((msg) =>
                  msg.id === messageId ? { ...msg, isPinned: false } : msg,
                ),
              ),
            ),
          };
        },
      );

      return { previous };
    },

    onError: (_err, _messageId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["messages", channelId], context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
    },
  });
}
```

- [ ] **Step 4: Wire handlePin in MessageList.tsx**

In `ChannelMessageItem` (around line 640), add hook calls and update `handlePin`:

```typescript
// Add to existing hook imports at top of ChannelMessageItem:
const pinMessage = usePinMessage(channelId);
const unpinMessage = useUnpinMessage(channelId);

// Replace the handlePin stub:
const handlePin = () => {
  if (message.isPinned) {
    unpinMessage.mutate(message.id);
  } else {
    pinMessage.mutate(message.id);
  }
};
```

Also add `usePinMessage, useUnpinMessage` to the import from `@/hooks/useMessages` at the top of the file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm jest --testPathPattern=usePinMessage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/hooks/useMessages.ts apps/client/src/hooks/__tests__/usePinMessage.test.ts apps/client/src/components/channel/MessageList.tsx
git commit -m "feat(pin): add pin/unpin hooks with optimistic updates and wire handlers"
```

---

### Task 2: Delete Confirmation Dialog + Admin Permissions

**Goal:** Add a confirmation dialog for all message deletions, allow channel admins/owners to delete others' messages (frontend + backend).

**Files:**

- Create: `apps/client/src/components/channel/DeleteMessageDialog.tsx`
- Modify: `apps/client/src/components/channel/MessageItem.tsx:307` (delete visibility condition)
- Modify: `apps/client/src/components/channel/MessageContextMenu.tsx:89-107` (accept `canDelete` prop)
- Modify: `apps/client/src/components/channel/MessageList.tsx:640-717` (dialog state, role check, pass `canDelete`)
- Modify: `apps/server/apps/gateway/src/im/messages/messages.service.ts:901-930` (accept `role` param)
- Modify: `apps/server/apps/gateway/src/im/messages/messages.controller.ts:366-385` (pass role)
- Test: `apps/client/src/components/channel/__tests__/DeleteMessageDialog.test.tsx`
- Test: `apps/server/apps/gateway/src/im/messages/messages.service.spec.ts` (if exists, add admin delete test)

**Acceptance Criteria:**

- [ ] Clicking "Delete message" opens an AlertDialog with title, description, and confirm/cancel buttons
- [ ] Confirm button is `destructive` variant, triggers actual deletion
- [ ] Cancel or Esc closes dialog without action
- [ ] Admin/owner sees delete option on other users' messages
- [ ] Non-admin only sees delete on own messages
- [ ] Backend allows admin/owner to delete any message in their channel
- [ ] Backend still allows message sender to delete their own message
- [ ] Tests cover: dialog render, confirm callback, cancel callback, admin delete backend

**Verify:** `pnpm jest --testPathPattern="DeleteMessageDialog|messages.service"` → all pass

**Steps:**

- [ ] **Step 1: Write DeleteMessageDialog component test**

Create `apps/client/src/components/channel/__tests__/DeleteMessageDialog.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { DeleteMessageDialog } from "../DeleteMessageDialog";

// Mock i18next
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "message:deleteConfirmTitle": "Delete message",
        "message:deleteConfirmDescription": "Are you sure?",
        "message:deleteConfirm": "Delete",
        "message:deleteCancel": "Cancel",
      };
      return map[key] ?? key;
    },
  }),
}));

describe("DeleteMessageDialog", () => {
  it("renders title and description when open", () => {
    render(
      <DeleteMessageDialog
        open={true}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText("Delete message")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("calls onConfirm when delete button clicked", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteMessageDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = jest.fn();
    render(
      <DeleteMessageDialog
        open={true}
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not render content when closed", () => {
    render(
      <DeleteMessageDialog
        open={false}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.queryByText("Delete message")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest --testPathPattern=DeleteMessageDialog`
Expected: FAIL — module not found

- [ ] **Step 3: Create DeleteMessageDialog component**

Create `apps/client/src/components/channel/DeleteMessageDialog.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

interface DeleteMessageDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteMessageDialog({
  open,
  onConfirm,
  onCancel,
}: DeleteMessageDialogProps) {
  const { t } = useTranslation("message");

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteConfirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {t("deleteCancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={buttonVariants({ variant: "destructive" })}
          >
            {t("deleteConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest --testPathPattern=DeleteMessageDialog`
Expected: PASS

- [ ] **Step 5: Update MessageContextMenu to accept `canDelete` prop**

In `apps/client/src/components/channel/MessageContextMenu.tsx`:

Change the interface to add `canDelete`:

```typescript
interface MessageContextMenuProps {
  children: React.ReactNode;
  message: Message;
  isOwnMessage: boolean;
  canDelete?: boolean; // NEW: admin can delete others' messages
  onReplyInThread?: () => void;
  onCopyMessage?: () => void;
  onCopyLink?: () => void;
  onPin?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}
```

Update the destructuring to include `canDelete`:

```typescript
export function MessageContextMenu({
  children,
  message,
  isOwnMessage,
  canDelete,
  // ... rest
```

Change the condition for showing edit/delete section (around line 89):

```tsx
{
  /* Edit - only for own messages */
}
{
  isOwnMessage && (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onEdit}>
        <Pencil className="mr-2 h-4 w-4" />
        {t("edit")}
        <ContextMenuShortcut>E</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

{
  /* Delete - own messages or admin/owner */
}
{
  (isOwnMessage || canDelete) && (
    <>
      {!isOwnMessage && <ContextMenuSeparator />}
      <ContextMenuItem
        onClick={onDelete}
        className="text-destructive focus:text-destructive focus:bg-destructive/10"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        {t("deleteMessage")}
        <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}
```

- [ ] **Step 6: Update MessageItem to pass `canDelete`**

In `apps/client/src/components/channel/MessageItem.tsx`, add `canDelete` to props interface:

```typescript
export interface MessageItemProps {
  // ... existing props
  canDelete?: boolean; // NEW
}
```

Add to destructuring and pass to `MessageContextMenu`:

```tsx
<MessageContextMenu
  message={message}
  isOwnMessage={isOwnMessage}
  canDelete={canDelete}
  onReplyInThread={onReplyInThread}
  onEdit={isOwnMessage ? onEdit : undefined}
  onDelete={(isOwnMessage || canDelete) ? onDelete : undefined}
  onPin={onPin}
>
```

- [ ] **Step 7: Wire delete dialog and role check in MessageList.tsx**

In the `ChannelMessageItem` wrapper component in `MessageList.tsx`:

Add state and imports:

```typescript
import { DeleteMessageDialog } from "./DeleteMessageDialog";
// Add to existing useMessages imports:
import { usePinMessage, useUnpinMessage } from "@/hooks/useMessages";
```

Add to `ChannelMessageItem` props interface — add `currentUserRole`:

```typescript
function ChannelMessageItem({
  message,
  prevMessage,
  currentUserId,
  showReplyCount,
  onReplyCountClick,
  isHighlighted,
  channelId,
  isDirect,
  currentUserRole,  // NEW
}: {
  // ... existing types
  currentUserRole?: string;  // NEW
}) {
```

Add state and handlers:

```typescript
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

const isOwnMessage = currentUserId === message.senderId;
const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
const canDelete = isAdmin && !isOwnMessage;

const handleDelete = () => {
  setDeleteDialogOpen(true);
};

const handleDeleteConfirm = () => {
  deleteMessage.mutate(message.id);
  setDeleteDialogOpen(false);
};

const handleDeleteCancel = () => {
  setDeleteDialogOpen(false);
};
```

Update the return to wrap with dialog:

```tsx
return (
  <>
    <MessageItem
      message={message}
      // ... existing props
      onDelete={handleDelete}
      canDelete={canDelete}
    />
    <DeleteMessageDialog
      open={deleteDialogOpen}
      onConfirm={handleDeleteConfirm}
      onCancel={handleDeleteCancel}
    />
  </>
);
```

In the parent `MessageList` component, compute `currentUserRole` from `members` prop and pass it down. In the `itemContent` callback where `ChannelMessageItem` is rendered, add:

```typescript
const currentUserRole = members.find((m) => m.userId === currentUser?.id)?.role;
```

Pass `currentUserRole` to every `ChannelMessageItem` render.

- [ ] **Step 8: Backend — update messages.service.ts delete method**

In `apps/server/apps/gateway/src/im/messages/messages.service.ts`, change the `delete` signature (line 901):

```typescript
async delete(
  messageId: string,
  userId: string,
  channelRole?: string,
): Promise<void> {
  const [message] = await this.db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!message) {
    throw new NotFoundException('Message not found');
  }

  const isOwner = message.senderId === userId;
  const isAdminOrOwner =
    channelRole && ['owner', 'admin'].includes(channelRole);

  if (!isOwner && !isAdminOrOwner) {
    throw new ForbiddenException('Cannot delete message from another user');
  }

  // Advance seqId so the deletion shows up in incremental sync
  const newSeqId = await this.channelSequenceService.generateChannelSeq(
    message.channelId,
  );

  await this.db
    .update(schema.messages)
    .set({
      isDeleted: true,
      seqId: newSeqId,
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.messages.id, messageId));
}
```

- [ ] **Step 9: Backend — update messages.controller.ts deleteMessage**

In `apps/server/apps/gateway/src/im/messages/messages.controller.ts`, update the `deleteMessage` method (line 366):

```typescript
@Delete('messages/:id')
async deleteMessage(
  @CurrentUser('sub') userId: string,
  @Param('id', ParseUUIDPipe) messageId: string,
): Promise<{ success: boolean }> {
  const channelId = await this.messagesService.getMessageChannelId(messageId);
  const role = await this.channelsService.getMemberRole(channelId, userId);
  await this.messagesService.delete(messageId, userId, role ?? undefined);

  // Broadcast message deletion to all channel members via WebSocket
  await this.websocketGateway.sendToChannelMembers(
    channelId,
    WS_EVENTS.MESSAGE.DELETED,
    { messageId, channelId },
  );

  // Emit event for search index removal
  this.eventEmitter.emit('message.deleted', messageId);

  return { success: true };
}
```

- [ ] **Step 10: Run all tests**

Run: `pnpm jest --testPathPattern="DeleteMessageDialog|messages.service|messages.controller"`
Expected: All PASS

- [ ] **Step 11: Commit**

```bash
git add apps/client/src/components/channel/DeleteMessageDialog.tsx \
  apps/client/src/components/channel/__tests__/DeleteMessageDialog.test.tsx \
  apps/client/src/components/channel/MessageContextMenu.tsx \
  apps/client/src/components/channel/MessageItem.tsx \
  apps/client/src/components/channel/MessageList.tsx \
  apps/server/apps/gateway/src/im/messages/messages.service.ts \
  apps/server/apps/gateway/src/im/messages/messages.controller.ts
git commit -m "feat(delete): add confirmation dialog and admin delete permissions"
```

---

### Task 3: Inline Message Editing with Lexical Editor

**Goal:** Replace the edit stub with an inline Lexical editor that back-fills the original message HTML, saves via `useUpdateMessage`, and shows "(edited at HH:mm)" timestamp.

**Files:**

- Modify: `apps/client/src/components/channel/editor/RichTextEditor.tsx` — add `initialHtml` prop, `InitialHtmlPlugin`, `onCancel` prop, Esc key handler
- Modify: `apps/client/src/components/channel/MessageItem.tsx` — accept `isEditing`/`onEditSave`/`onEditCancel` props, render editor when editing, update edited timestamp
- Modify: `apps/client/src/components/channel/MessageList.tsx` — manage `editingMessageId` state, wire `handleEdit`/`handleEditSave`/`handleEditCancel`
- Modify: `apps/client/src/lib/date-utils.ts` — add `formatEditedTime` helper

**Acceptance Criteria:**

- [ ] Clicking "Edit" replaces message content with a Lexical editor pre-filled with original HTML
- [ ] Mentions, code blocks, and rich text are preserved when back-filling
- [ ] Enter saves, Esc cancels (returning to normal display)
- [ ] Save/Cancel buttons and hint text shown below editor
- [ ] Edited messages show "(edited at HH:mm)" using `updatedAt`, with full date if not today
- [ ] Only one message can be in edit mode at a time
- [ ] `useUpdateMessage` hook is called on save; WebSocket `message_updated` event updates the cache

**Verify:** Manual test — right-click message → Edit → verify content loads → press Enter → verify "(edited at HH:mm)" appears

**Steps:**

- [ ] **Step 1: Add `formatEditedTime` to date-utils.ts**

In `apps/client/src/lib/date-utils.ts`, add after `formatMessageTime`:

```typescript
/**
 * Format the edited timestamp for display.
 * Returns "HH:mm" for today, "MM/DD HH:mm" for same year, "YYYY/MM/DD HH:mm" for other years.
 */
export function formatEditedTime(date: Date): string {
  return formatMessageTime(date);
}
```

Note: This delegates to the existing `formatMessageTime` which already handles today/same-year/different-year formatting. Having a separate function provides a stable API if the edit timestamp format diverges later.

- [ ] **Step 2: Add `InitialHtmlPlugin` and `onCancel` to RichTextEditor**

In `apps/client/src/components/channel/editor/RichTextEditor.tsx`:

Add import at top:

```typescript
import { $generateNodesFromDOM } from "@lexical/html";
import { KEY_ESCAPE_COMMAND, COMMAND_PRIORITY_HIGH } from "lexical";
```

Add `InitialHtmlPlugin` after `InitialDraftPlugin` (around line 114):

```typescript
function InitialHtmlPlugin({ html }: { html?: string }) {
  const [editor] = useLexicalComposerContext();
  const hasApplied = useRef(false);

  useEffect(() => {
    if (!html || hasApplied.current) return;
    hasApplied.current = true;

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const parser = new DOMParser();
      const dom = parser.parseFromString(html, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);

      nodes.forEach((node) => root.append(node));

      // Move cursor to end
      root.selectEnd();
    });
  }, [editor, html]);

  return null;
}
```

Add `EscapePlugin` for cancel:

```typescript
function EscapePlugin({ onCancel }: { onCancel?: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onCancel) return;
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        onCancel();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onCancel]);

  return null;
}
```

Update props interface:

```typescript
interface RichTextEditorProps {
  channelId?: string;
  onSubmit: (content: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  compact?: boolean;
  onFileSelect?: (files: FileList) => void;
  uploadingFiles?: UploadingFile[];
  onRemoveFile?: (id: string) => void;
  onRetryFile?: (id: string) => void;
  initialDraft?: string;
  initialHtml?: string; // NEW
  onCancel?: () => void; // NEW
}
```

Add to destructuring and use in the component:

```typescript
export function RichTextEditor({
  // ... existing
  initialHtml,
  onCancel,
}: RichTextEditorProps) {
```

Add plugins inside the `LexicalComposer`, after `InitialDraftPlugin`:

```tsx
<InitialHtmlPlugin html={initialHtml} />
<EscapePlugin onCancel={onCancel} />
```

- [ ] **Step 3: Update MessageItem to support edit mode**

In `apps/client/src/components/channel/MessageItem.tsx`:

Add to props interface:

```typescript
export interface MessageItemProps {
  // ... existing props
  isEditing?: boolean; // NEW
  onEditSave?: (content: string) => void; // NEW
  onEditCancel?: () => void; // NEW
}
```

Add to destructuring:

```typescript
export function MessageItem({
  // ... existing
  isEditing = false,
  onEditSave,
  onEditCancel,
}: MessageItemProps) {
```

Add imports:

```typescript
import { RichTextEditor } from "./editor";
import { formatEditedTime } from "@/lib/date-utils";
import { parseApiDate } from "@/lib/date-utils";
```

Replace the edited indicator (around line 220):

```tsx
{
  message.isEdited && (
    <span className="text-xs text-muted-foreground">
      {t("message:editedAt", {
        time: formatEditedTime(parseApiDate(message.updatedAt)),
      })}
    </span>
  );
}
```

Replace the content section (around line 242). Wrap the existing content in a conditional:

```tsx
{
  isEditing ? (
    <div className="w-full">
      <RichTextEditor
        channelId={message.channelId}
        compact
        initialHtml={message.content}
        onSubmit={async (content) => {
          onEditSave?.(content);
        }}
        onCancel={onEditCancel}
        placeholder={t("message:edit")}
      />
      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={() => onEditCancel?.()}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {t("message:editCancel")}
        </button>
        <span className="text-xs text-muted-foreground">
          {t("message:editHint")}
        </span>
      </div>
    </div>
  ) : (
    <>
      {hasContent && (
        <div className="channel-message-content">
          <MessageContent
            content={message.content}
            className="text-sm whitespace-pre-wrap break-words"
            message={message}
          />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Wire edit state in MessageList.tsx**

In the `MessageList` component (parent), add state management. This needs to be lifted up so it's accessible from the `itemContent` callback.

At the top of the `MessageList` function body (around line 92):

```typescript
const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
const updateMessage = useUpdateMessage();
```

Add `useUpdateMessage` to the import from `@/hooks/useMessages`.

In the `ChannelMessageItem` wrapper, add new props:

```typescript
function ChannelMessageItem({
  // ... existing props
  currentUserRole,
  editingMessageId,       // NEW
  onEditStart,            // NEW
  onEditSave,             // NEW
  onEditCancel,           // NEW
}: {
  // ... existing types
  editingMessageId: string | null;  // NEW
  onEditStart: (messageId: string) => void;  // NEW
  onEditSave: (messageId: string, content: string) => void;  // NEW
  onEditCancel: () => void;  // NEW
}) {
```

Update handlers:

```typescript
const isEditing = editingMessageId === message.id;

const handleEdit = () => {
  onEditStart(message.id);
};
```

Pass to `MessageItem`:

```tsx
<MessageItem
  // ... existing props
  isEditing={isEditing}
  onEditSave={(content) => onEditSave(message.id, content)}
  onEditCancel={onEditCancel}
/>
```

In the parent `MessageList`, create the callbacks and pass them in `itemContent`:

```typescript
const handleEditStart = useCallback((messageId: string) => {
  setEditingMessageId(messageId);
}, []);

const handleEditSave = useCallback(
  (messageId: string, content: string) => {
    updateMessage.mutate(
      { messageId, data: { content } },
      {
        onSuccess: () => setEditingMessageId(null),
      },
    );
  },
  [updateMessage],
);

const handleEditCancel = useCallback(() => {
  setEditingMessageId(null);
}, []);
```

Pass these to each `ChannelMessageItem` in the `itemContent` callback:

```tsx
<ChannelMessageItem
  // ... existing props
  editingMessageId={editingMessageId}
  onEditStart={handleEditStart}
  onEditSave={handleEditSave}
  onEditCancel={handleEditCancel}
/>
```

- [ ] **Step 5: Manual verification**

1. Start dev server: `pnpm dev`
2. Open the app, navigate to a channel with messages
3. Right-click your own message → Edit → verify editor appears with content
4. Modify content → press Enter → verify message updates and shows "(edited at HH:mm)"
5. Right-click another message → Edit → press Esc → verify returns to normal
6. Verify only one message can be in edit mode at a time

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/channel/editor/RichTextEditor.tsx \
  apps/client/src/components/channel/MessageItem.tsx \
  apps/client/src/components/channel/MessageList.tsx \
  apps/client/src/lib/date-utils.ts
git commit -m "feat(edit): inline message editing with Lexical editor and edited timestamp"
```
