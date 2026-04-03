# Account Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated `/profile` account page that lets signed-in users update avatar, display name, and username, and manage email changes through a separate confirmation flow.

**Architecture:** Reuse the existing authenticated app shell, current-user query, IM users profile update endpoint, and shared file upload/email infrastructure. Add a new backend email-change request flow backed by a dedicated table, expose small account endpoints for pending/resend/cancel/confirm actions, then layer a focused account settings page on top of those APIs.

**Tech Stack:** React 19, TanStack Router, TanStack Query, Tailwind/Radix UI, NestJS 11, Drizzle ORM, PostgreSQL, Resend email service, Vitest, Jest.

---

## File Structure

### Backend files

- Create: `apps/server/libs/database/src/schemas/im/user-email-change-requests.ts`
- Modify: `apps/server/libs/database/src/schemas/im/index.ts`
- Modify: `apps/server/libs/database/src/schemas/im/relations.ts`
- Create: `apps/server/apps/gateway/src/account/account.module.ts`
- Create: `apps/server/apps/gateway/src/account/account.controller.ts`
- Create: `apps/server/apps/gateway/src/account/account.service.ts`
- Create: `apps/server/apps/gateway/src/account/dto/index.ts`
- Create: `apps/server/apps/gateway/src/account/dto/create-email-change.dto.ts`
- Create: `apps/server/apps/gateway/src/account/dto/resend-email-change.dto.ts` if needed, otherwise keep DTO surface minimal
- Modify: `apps/server/apps/gateway/src/im/users/dto/update-user.dto.ts`
- Modify: `apps/server/apps/gateway/src/im/users/users.service.ts`
- Modify: `apps/server/apps/gateway/src/im/users/users.controller.ts`
- Modify: `apps/server/apps/gateway/src/auth/auth.service.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts` or the module that wires gateway modules
- Modify: `apps/server/libs/email/src/email.service.ts`
- Create: `apps/server/libs/email/src/templates/email-change-confirmation.template.ts`
- Test: `apps/server/apps/gateway/src/account/account.service.spec.ts`
- Test: `apps/server/apps/gateway/src/im/users/users.controller.spec.ts` or `users.service.spec.ts`
- Test: `apps/server/apps/gateway/src/auth/auth.service.spec.ts`

### Frontend files

- Create: `apps/client/src/routes/_authenticated/profile.tsx`
- Create: `apps/client/src/components/layout/contents/AccountSettingsContent.tsx`
- Create: `apps/client/src/components/layout/contents/__tests__/AccountSettingsContent.test.tsx`
- Modify: `apps/client/src/components/layout/MainSidebar.tsx`
- Modify: `apps/client/src/services/api/im.ts`
- Modify: `apps/client/src/services/api/index.ts`
- Modify: `apps/client/src/hooks/useIMUsers.ts`
- Modify: `apps/client/src/hooks/useAuth.ts`
- Modify: `apps/client/src/stores/useAppStore.ts`
- Modify: `apps/client/src/i18n/locales/en/settings.json`
- Modify: `apps/client/src/i18n/locales/zh/settings.json`

### Migration / generated files

- Create: new drizzle migration under `apps/server/libs/database/migrations/`
- Modify: snapshot files under `apps/server/libs/database/migrations/meta/`

---

### Task 1: Add Backend Support For Username Updates

**Files:**

- Modify: `apps/server/apps/gateway/src/im/users/dto/update-user.dto.ts`
- Modify: `apps/server/apps/gateway/src/im/users/users.service.ts`
- Modify: `apps/server/apps/gateway/src/im/users/users.controller.ts`
- Test: `apps/server/apps/gateway/src/im/users/users.controller.spec.ts` or `apps/server/apps/gateway/src/im/users/users.service.spec.ts`

- [ ] **Step 1: Write the failing backend tests for username update**

Add tests covering:

```ts
it("updates username for the current user", async () => {
  const dto = { username: "new-handle" };
  await expect(service.update("user-1", dto)).resolves.toMatchObject({
    username: "new-handle",
  });
});

it("throws ConflictException when username already exists", async () => {
  await expect(
    service.update("user-1", { username: "taken-name" }),
  ).rejects.toThrow("Username already exists");
});
```

- [ ] **Step 2: Run the focused backend test and verify failure**

Run:

```bash
pnpm -C apps/server test -- users
```

Expected:

- FAIL because `UpdateUserDto` does not accept `username`
- FAIL because `UsersService.update()` does not check username uniqueness

- [ ] **Step 3: Extend the update DTO with explicit username validation**

Use a DTO shape like:

```ts
export class UpdateUserDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  displayName?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/)
  @IsOptional()
  username?: string;

  @IsUrl()
  @IsOptional()
  avatarUrl?: string;
}
```

- [ ] **Step 4: Add username uniqueness enforcement in `UsersService.update()`**

Implement the check before the update:

```ts
if (dto.username) {
  const [existing] = await this.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, dto.username))
    .limit(1);

  if (existing && existing.id !== id) {
    throw new ConflictException("Username already exists");
  }
}
```

- [ ] **Step 5: Return the updated user shape unchanged to existing consumers**

Keep the response contract:

```ts
return {
  id: updatedUser.id,
  email: updatedUser.email,
  username: updatedUser.username,
  displayName: updatedUser.displayName,
  avatarUrl: updatedUser.avatarUrl,
  status: updatedUser.status,
  lastSeenAt: updatedUser.lastSeenAt,
  userType: updatedUser.userType,
};
```

- [ ] **Step 6: Re-run focused backend tests**

Run:

```bash
pnpm -C apps/server test -- users
```

Expected:

- PASS for username update coverage

- [ ] **Step 7: Commit**

```bash
git add apps/server/apps/gateway/src/im/users/dto/update-user.dto.ts \
  apps/server/apps/gateway/src/im/users/users.service.ts \
  apps/server/apps/gateway/src/im/users/users.controller.ts \
  apps/server/apps/gateway/src/im/users/*.spec.ts
git commit -m "feat: support username updates for current user"
```

---

### Task 2: Add Email Change Persistence And Account Endpoints

**Files:**

- Create: `apps/server/libs/database/src/schemas/im/user-email-change-requests.ts`
- Modify: `apps/server/libs/database/src/schemas/im/index.ts`
- Modify: `apps/server/libs/database/src/schemas/im/relations.ts`
- Create: `apps/server/apps/gateway/src/account/account.module.ts`
- Create: `apps/server/apps/gateway/src/account/account.controller.ts`
- Create: `apps/server/apps/gateway/src/account/account.service.ts`
- Create: `apps/server/apps/gateway/src/account/dto/create-email-change.dto.ts`
- Create: `apps/server/apps/gateway/src/account/dto/index.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts` or equivalent gateway module wiring
- Test: `apps/server/apps/gateway/src/account/account.service.spec.ts`

- [ ] **Step 1: Write failing tests for the email-change flow**

Cover:

```ts
it("creates one pending email change request for a new email", async () => {
  await expect(
    service.createEmailChange("user-1", { newEmail: "new@test.com" }),
  ).resolves.toMatchObject({
    newEmail: "new@test.com",
    status: "pending",
  });
});

it("rejects duplicate target email", async () => {
  await expect(
    service.createEmailChange("user-1", { newEmail: "taken@test.com" }),
  ).rejects.toThrow("Email already exists");
});

it("cancels an existing pending request", async () => {
  await expect(service.cancelEmailChange("user-1")).resolves.toEqual({
    success: true,
  });
});
```

- [ ] **Step 2: Add the new schema and generate the migration**

Define a table shape like:

```ts
export const userEmailChangeRequests = pgTable("user_email_change_requests", {
  id: uuid("id").primaryKey().notNull(),
  userId: uuid("user_id").notNull(),
  currentEmail: varchar("current_email", { length: 255 }).notNull(),
  newEmail: varchar("new_email", { length: 255 }).notNull(),
  tokenHash: text("token_hash").notNull(),
  status: pgEnum("user_email_change_request_status", [
    "pending",
    "confirmed",
    "cancelled",
    "expired",
  ])("status")
    .default("pending")
    .notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

Run:

```bash
pnpm db:generate
```

Expected:

- New migration file created
- Snapshot metadata updated

- [ ] **Step 3: Implement the account service read/write operations**

Add methods with this shape:

```ts
getPendingEmailChange(userId: string)
createEmailChange(userId: string, dto: { newEmail: string })
resendEmailChange(userId: string)
cancelEmailChange(userId: string)
confirmEmailChange(token: string)
```

Implementation rules:

- reject if `newEmail` already belongs to another user
- cancel/replace any earlier pending request for the same user before creating a new one
- store a hashed token instead of raw token
- confirmation updates `schema.users.email`, `emailVerified`, `emailVerifiedAt`

- [ ] **Step 4: Add the HTTP surface**

Expose:

```ts
@Get('email-change')
@Post('email-change')
@Post('email-change/resend')
@Delete('email-change')
@Get('confirm-email-change')
```

Use `AuthGuard` on every endpoint except confirmation.

- [ ] **Step 5: Reuse existing email infrastructure instead of inventing a new sender**

Add one mailer entry point in `EmailService`:

```ts
async sendEmailChangeConfirmation(
  email: string,
  username: string,
  confirmationLink: string,
): Promise<boolean>
```

and a template file matching the existing verification/login email pattern.

- [ ] **Step 6: Run focused backend tests and migration sanity checks**

Run:

```bash
pnpm -C apps/server test -- account
pnpm -C apps/server test -- auth
```

Expected:

- PASS for the new account service/controller coverage
- no regression in auth-related tests touching current user/email behavior

- [ ] **Step 7: Commit**

```bash
git add apps/server/libs/database/src/schemas/im \
  apps/server/libs/database/migrations \
  apps/server/apps/gateway/src/account \
  apps/server/apps/gateway/src/app.module.ts \
  apps/server/libs/email/src \
  apps/server/apps/gateway/src/account/*.spec.ts
git commit -m "feat: add account email change flow"
```

---

### Task 3: Seed Google Signups With Better Default Profile Data

**Files:**

- Modify: `apps/server/apps/gateway/src/auth/auth.service.ts`
- Test: `apps/server/apps/gateway/src/auth/auth.service.spec.ts`

- [ ] **Step 1: Write failing tests for Google signup defaults**

Add coverage for:

```ts
it("uses Google name and picture for a new user", async () => {
  expect(result.user.displayName).toBe("Ada Lovelace");
  expect(result.user.avatarUrl).toBe(
    "https://googleusercontent.com/avatar.png",
  );
});

it("falls back to gravatar when Google picture is missing", async () => {
  expect(result.user.avatarUrl).toContain("gravatar.com/avatar/");
});

it("does not overwrite existing profile data on later Google login", async () => {
  expect(result.user.displayName).toBe(existingUser.displayName);
  expect(result.user.avatarUrl).toBe(existingUser.avatarUrl);
});
```

- [ ] **Step 2: Add a tiny Gravatar helper inside `AuthService` or a local util**

Use normalized email + md5:

```ts
private buildGravatarUrl(email: string): string {
  const normalized = email.trim().toLowerCase();
  const hash = createHash('md5').update(normalized).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?d=identicon`;
}
```

- [ ] **Step 3: Update the first-time Google signup branch only**

Keep existing users unchanged; only alter the new-user insert values:

```ts
const avatarUrl = picture || this.buildGravatarUrl(email);

.values({
  id: userId,
  email,
  username,
  displayName: name || username,
  avatarUrl,
  emailVerified: true,
  emailVerifiedAt: new Date(),
})
```

- [ ] **Step 4: Re-run auth tests**

Run:

```bash
pnpm -C apps/server test -- auth.service
```

Expected:

- PASS for Google login/signup scenarios

- [ ] **Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/auth/auth.service.ts \
  apps/server/apps/gateway/src/auth/auth.service.spec.ts
git commit -m "feat: seed Google signups with profile defaults"
```

---

### Task 4: Add Frontend Account Data Hooks And API Methods

**Files:**

- Modify: `apps/client/src/services/api/im.ts`
- Modify: `apps/client/src/services/api/index.ts`
- Modify: `apps/client/src/hooks/useIMUsers.ts`
- Modify: `apps/client/src/hooks/useAuth.ts`
- Modify: `apps/client/src/stores/useAppStore.ts`
- Test: `apps/client/src/hooks/__tests__/useIMUsers.test.tsx` if created, or extend existing account-related tests

- [ ] **Step 1: Write failing hook/API tests for account mutations**

Cover:

```ts
it("updates the current user profile and invalidates currentUser + im-users cache", async () => {
  await result.current.mutateAsync({ username: "new-handle" });
  expect(imApi.users.updateMe).toHaveBeenCalledWith({ username: "new-handle" });
});

it("loads pending email change state", async () => {
  expect(result.current.data?.newEmail).toBe("new@test.com");
});
```

- [ ] **Step 2: Extend API clients with explicit account/email-change methods**

Add methods like:

```ts
getPendingEmailChange: async () => http.get("/v1/account/email-change");
startEmailChange: async (data: { newEmail: string }) =>
  http.post("/v1/account/email-change", data);
resendEmailChange: async () => http.post("/v1/account/email-change/resend", {});
cancelEmailChange: async () => http.delete("/v1/account/email-change");
```

- [ ] **Step 3: Add focused hooks rather than overloading unrelated ones**

Add hooks such as:

```ts
useUpdateCurrentUserProfile();
usePendingEmailChange();
useStartEmailChange();
useResendEmailChange();
useCancelEmailChange();
```

Invalidate:

```ts
["currentUser"][("account", "email-change")][("im-users", userId)];
```

- [ ] **Step 4: Keep the Zustand user store in sync**

Ensure successful profile changes refresh the app store by reusing current-user query sync:

```ts
queryClient.invalidateQueries({ queryKey: ["currentUser"] });
```

Avoid manually duplicating merge logic in multiple places.

- [ ] **Step 5: Run focused frontend tests**

Run:

```bash
pnpm -C apps/client test src/hooks
```

Expected:

- PASS for account hooks and no regression in auth/current-user behavior

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/services/api/im.ts \
  apps/client/src/services/api/index.ts \
  apps/client/src/hooks/useIMUsers.ts \
  apps/client/src/hooks/useAuth.ts \
  apps/client/src/stores/useAppStore.ts \
  apps/client/src/hooks/__tests__
git commit -m "feat: add frontend account data hooks"
```

---

### Task 5: Build The `/profile` Account Settings Page

**Files:**

- Create: `apps/client/src/routes/_authenticated/profile.tsx`
- Create: `apps/client/src/components/layout/contents/AccountSettingsContent.tsx`
- Modify: `apps/client/src/components/layout/MainSidebar.tsx`
- Modify: `apps/client/src/i18n/locales/en/settings.json`
- Modify: `apps/client/src/i18n/locales/zh/settings.json`
- Test: `apps/client/src/components/layout/contents/__tests__/AccountSettingsContent.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Cover at least:

```tsx
it("renders current avatar, display name, username, and email", async () => {
  expect(await screen.findByDisplayValue("Ada")).toBeInTheDocument();
  expect(screen.getByDisplayValue("ada-lovelace")).toBeInTheDocument();
  expect(screen.getByText("ada@example.com")).toBeInTheDocument();
});

it("blocks invalid usernames", async () => {
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: "Bad Name!" },
  });
  expect(screen.getByText("usernameInvalidFormat")).toBeInTheDocument();
});

it("shows pending email change actions when a request exists", async () => {
  expect(screen.getByText(/pending confirmation/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /resend/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Add the route and wire the menu entry**

Route:

```ts
export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});
```

Menu action in `MainSidebar.tsx`:

```tsx
<button onClick={() => navigate({ to: "/profile" })}>
  <User size={16} />
  <span>{tSettings("profile")}</span>
</button>
```

- [ ] **Step 3: Build the `Profile` card with avatar upload**

Use the same patterns as workspace settings:

```tsx
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
```

Fields:

```tsx
<Input id="display-name" ... />
<Input id="username" ... />
<Button disabled={!canSave}>Save changes</Button>
```

Upload flow:

```tsx
const presigned = await fileApi.createPresignedUpload({
  filename: file.name,
  contentType: file.type,
  fileSize: file.size,
  visibility: "public",
});
await fileApi.uploadToS3(presigned.url, file, presigned.fields);
await fileApi.confirmUpload({
  key: presigned.key,
  fileName: file.name,
  visibility: "public",
});
setAvatarUrl(presigned.publicUrl);
```

- [ ] **Step 4: Build the `Login Email` card with explicit pending state**

Render a shape like:

```tsx
<Card>
  <CardHeader>
    <CardTitle>{t('loginEmail')}</CardTitle>
  </CardHeader>
  <CardContent>
    <p>{currentUser.email}</p>
    {pendingEmailChange ? (
      <>
        <p>{t('pendingConfirmation', { email: pendingEmailChange.newEmail })}</p>
        <Button onClick={handleResend}>{t('retry')}</Button>
        <Button variant="outline" onClick={handleCancel}>{t('cancel')}</Button>
      </>
    ) : (
      <>
        <Input value={newEmail} onChange={...} />
        <Button onClick={handleStartEmailChange}>{t('changeEmail')}</Button>
      </>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 5: Localize all account-page strings**

Add keys to both locale files, including:

```json
{
  "accountSettings": "Account Settings",
  "displayName": "Display name",
  "username": "Username",
  "loginEmail": "Login email",
  "changeEmail": "Change email",
  "pendingConfirmation": "Pending confirmation: {{email}}",
  "usernameInvalidFormat": "Username must contain only lowercase letters, numbers, and hyphens",
  "usernameAlreadyTaken": "This username is already taken"
}
```

- [ ] **Step 6: Run focused account page tests**

Run:

```bash
pnpm -C apps/client test src/components/layout/contents/__tests__/AccountSettingsContent.test.tsx
```

Expected:

- PASS for render, validation, upload, and pending-email UI coverage

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/routes/_authenticated/profile.tsx \
  apps/client/src/components/layout/contents/AccountSettingsContent.tsx \
  apps/client/src/components/layout/contents/__tests__/AccountSettingsContent.test.tsx \
  apps/client/src/components/layout/MainSidebar.tsx \
  apps/client/src/i18n/locales/en/settings.json \
  apps/client/src/i18n/locales/zh/settings.json
git commit -m "feat: add account settings page"
```

---

### Task 6: Verify End-To-End Behavior And Clean Up Regressions

**Files:**

- Modify: any touched files from Tasks 1-5 only if verification reveals defects
- Test: account/backend/frontend suites already added

- [ ] **Step 1: Run backend account/auth verification**

Run:

```bash
pnpm -C apps/server test -- account
pnpm -C apps/server test -- auth
```

Expected:

- PASS across new email-change and Google-signup coverage

- [ ] **Step 2: Run frontend client verification**

Run:

```bash
pnpm -C apps/client test
pnpm build:client
```

Expected:

- all client tests pass
- production client build passes

- [ ] **Step 3: Manually sanity-check the highest-risk flows**

Check locally:

```text
1. Open the user menu and click Profile.
2. Change display name and username; verify sidebar text updates after save.
3. Upload a PNG/JPG/WEBP avatar; verify preview and sidebar avatar update.
4. Start an email change; verify pending state appears.
5. Resend and cancel the pending email change; verify UI refreshes.
6. For a new Google-only test account, confirm first login seeds name/avatar.
```

- [ ] **Step 4: Fix any failures with minimal follow-up commits**

If a regression appears, make a narrow fix and re-run only the failing command first, then re-run the full suite.

- [ ] **Step 5: Final commit if needed**

```bash
git add <only files changed during verification fixes>
git commit -m "fix: address account settings verification issues"
```

---

## Self-Review

### Spec coverage

- `/profile` route and menu wiring: Task 5
- avatar/displayName/username editing: Tasks 1, 4, 5
- email change as separate flow: Task 2, Task 5
- Google defaults + Gravatar fallback: Task 3
- localization and validation: Task 5
- tests for backend/frontend flows: Tasks 1-6

### Placeholder scan

- No `TODO` / `TBD`
- Each task includes concrete files, commands, and code shape
- No “same as previous task” references

### Type consistency

- Profile update continues through `PATCH /v1/im/users/me`
- Email flow uses `/v1/account/email-change*`
- Frontend invalidation targets `["currentUser"]` and `["account", "email-change"]`
