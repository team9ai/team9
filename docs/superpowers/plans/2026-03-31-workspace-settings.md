# Workspace Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/more/workspace-settings` page where workspace owners and admins can update the workspace name, slug, and logo from the desktop client.

**Architecture:** Reuse the existing workspace REST API and React Query cache. Add one settings route and one form component, then expose a conditional entry from the More page. For logo upload, surface the backend `publicUrl` field from file presign responses and use `visibility: "public"` so the saved `logoUrl` is directly renderable.

**Tech Stack:** React 19, TanStack Router, TanStack React Query, Zustand, Vitest, Testing Library, existing `fileApi`/`workspaceApi` services.

---

### Task 1: Extend client workspace and file APIs

**Files:**

- Modify: `apps/client/src/services/api/file.ts`
- Modify: `apps/client/src/services/api/workspace.ts`
- Modify: `apps/client/src/types/workspace.ts`
- Modify: `apps/client/src/hooks/useWorkspace.ts`

- [ ] **Step 1: Write the failing hook/API tests**

```ts
// apps/client/src/hooks/__tests__/useWorkspace.test.ts
it("loads full workspace details", async () => {
  mockWorkspaceApi.getWorkspace.mockResolvedValue(workspaceDetail);
  const { result } = renderHook(() => useWorkspace("ws-1"), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual(workspaceDetail));
});

it("updates workspace and invalidates workspace queries", async () => {
  mockWorkspaceApi.updateWorkspace.mockResolvedValue(updatedWorkspace);
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const { result } = renderHook(() => useUpdateWorkspace(), { wrapper });

  await act(async () => {
    await result.current.mutateAsync({
      workspaceId: "ws-1",
      data: {
        name: "Renamed",
        slug: "renamed",
        logoUrl: "https://cdn/logo.png",
      },
    });
  });

  expect(mockWorkspaceApi.updateWorkspace).toHaveBeenCalledWith("ws-1", {
    name: "Renamed",
    slug: "renamed",
    logoUrl: "https://cdn/logo.png",
  });
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["user-workspaces"],
  });
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["workspace", "ws-1"],
  });
});
```

- [ ] **Step 2: Run the hook test and verify it fails**

Run: `pnpm vitest apps/client/src/hooks/__tests__/useWorkspace.test.ts`

Expected: FAIL because `useWorkspace`, `useUpdateWorkspace`, and the new API methods do not exist yet.

- [ ] **Step 3: Add the minimal API and hook implementation**

```ts
// apps/client/src/types/workspace.ts
export interface UpdateWorkspaceDto {
  name?: string;
  slug?: string;
  logoUrl?: string | null;
}

// apps/client/src/services/api/file.ts
export interface PresignedUploadCredentials {
  url: string;
  key: string;
  fields: Record<string, string>;
  publicUrl: string;
}

// apps/client/src/services/api/workspace.ts
getWorkspace: async (workspaceId: string): Promise<WorkspaceResponse> => { ... }
updateWorkspace: async (workspaceId: string, data: UpdateWorkspaceDto): Promise<WorkspaceResponse> => { ... }

// apps/client/src/hooks/useWorkspace.ts
export function useWorkspace(workspaceId: string | undefined) { ... }
export function useUpdateWorkspace() { ...invalidate ["user-workspaces"] and ["workspace", workspaceId]... }
```

- [ ] **Step 4: Re-run the hook test and verify it passes**

Run: `pnpm vitest apps/client/src/hooks/__tests__/useWorkspace.test.ts`

Expected: PASS with both hook cases green.

### Task 2: Build the workspace settings page with TDD

**Files:**

- Create: `apps/client/src/components/layout/contents/WorkspaceSettingsContent.tsx`
- Create: `apps/client/src/components/layout/contents/__tests__/WorkspaceSettingsContent.test.tsx`
- Create: `apps/client/src/routes/_authenticated/more/workspace-settings.tsx`

- [ ] **Step 1: Write the failing component tests**

```tsx
it("renders workspace form fields from the loaded workspace", async () => {
  render(<WorkspaceSettingsContent />, { wrapper });
  expect(await screen.findByDisplayValue("Weight Wave")).toBeInTheDocument();
  expect(screen.getByDisplayValue("weight-wave")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
});

it("shows validation and blocks invalid slug submission", async () => {
  render(<WorkspaceSettingsContent />, { wrapper });
  fireEvent.change(await screen.findByLabelText(/slug/i), {
    target: { value: "Bad Slug!" },
  });
  expect(
    screen.getByText(/lowercase letters, numbers, and hyphens/i),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
});

it("uploads a logo and saves the edited workspace", async () => {
  render(<WorkspaceSettingsContent />, { wrapper });
  fireEvent.change(await screen.findByLabelText(/workspace logo/i), {
    target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
  });
  fireEvent.change(screen.getByLabelText(/^name$/i), {
    target: { value: "Renamed Workspace" },
  });
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

  await waitFor(() =>
    expect(mockUpdateWorkspace.mutateAsync).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      data: expect.objectContaining({
        name: "Renamed Workspace",
        slug: "weight-wave",
        logoUrl: "https://cdn.example.com/logo.png",
      }),
    }),
  );
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run: `pnpm vitest apps/client/src/components/layout/contents/__tests__/WorkspaceSettingsContent.test.tsx`

Expected: FAIL because the route component and form do not exist yet.

- [ ] **Step 3: Implement the route and form**

```tsx
// route
export const Route = createFileRoute("/_authenticated/more/workspace-settings")({
  component: WorkspaceSettingsPage,
});

// component highlights
const { selectedWorkspaceId } = useWorkspaceStore();
const { data: workspace } = useWorkspace(selectedWorkspaceId);
const updateWorkspace = useUpdateWorkspace();

const handleLogoSelected = async (file: File) => {
  const presigned = await fileApi.createPresignedUpload({ ... , visibility: "public" });
  await fileApi.uploadToS3(presigned.url, file, presigned.fields);
  await fileApi.confirmUpload({ key: presigned.key, fileName: file.name, visibility: "public" });
  setForm((prev) => ({ ...prev, logoUrl: presigned.publicUrl }));
};
```

- [ ] **Step 4: Re-run the component test and verify it passes**

Run: `pnpm vitest apps/client/src/components/layout/contents/__tests__/WorkspaceSettingsContent.test.tsx`

Expected: PASS for load, validation, and save flows.

### Task 3: Wire the More page entry and translations

**Files:**

- Modify: `apps/client/src/components/layout/contents/MoreMainContent.tsx`
- Modify: `apps/client/src/i18n/locales/en/workspace.json`
- Modify: `apps/client/src/i18n/locales/zh/workspace.json`
- Create: `apps/client/src/components/layout/contents/__tests__/MoreMainContent.test.tsx`

- [ ] **Step 1: Write the failing navigation/permission test**

```tsx
it("shows workspace settings only for owner or admin", () => {
  mockUseCurrentWorkspaceRole.mockReturnValue({
    isOwner: false,
    isAdmin: false,
    isOwnerOrAdmin: false,
  });
  render(<MoreMainContent />);
  expect(screen.queryByText(/workspace settings/i)).not.toBeInTheDocument();
});

it("navigates to workspace settings from the workspace group", async () => {
  mockUseCurrentWorkspaceRole.mockReturnValue({
    isOwner: false,
    isAdmin: true,
    isOwnerOrAdmin: true,
  });
  render(<MoreMainContent />);
  fireEvent.click(screen.getByText(/workspace settings/i));
  expect(mockNavigate).toHaveBeenCalledWith({ to: "/more/workspace-settings" });
});
```

- [ ] **Step 2: Run the More page test and verify it fails**

Run: `pnpm vitest apps/client/src/components/layout/contents/__tests__/MoreMainContent.test.tsx`

Expected: FAIL because the menu item is not rendered and no route target is wired.

- [ ] **Step 3: Add the conditional menu item and i18n strings**

```ts
// MoreMainContent.tsx
const { isOwnerOrAdmin } = useCurrentWorkspaceRole();
// insert { id: "workspace-settings", label: t("workspaceSettings", { ns: "workspace" }), icon: Building2 }
// only when isOwnerOrAdmin === true
if (id === "workspace-settings") {
  navigate({ to: "/more/workspace-settings" });
}
```

- [ ] **Step 4: Re-run the More page test and verify it passes**

Run: `pnpm vitest apps/client/src/components/layout/contents/__tests__/MoreMainContent.test.tsx`

Expected: PASS for permission gating and navigation.

### Task 4: Verify the end-to-end client slice

**Files:**

- Modify if needed after verification: any files from Tasks 1-3

- [ ] **Step 1: Run the focused client tests**

Run: `pnpm vitest apps/client/src/hooks/__tests__/useWorkspace.test.ts apps/client/src/components/layout/contents/__tests__/WorkspaceSettingsContent.test.tsx apps/client/src/components/layout/contents/__tests__/MoreMainContent.test.tsx`

Expected: PASS with 0 failures.

- [ ] **Step 2: Run the client build**

Run: `pnpm build:client`

Expected: successful Vite/Tauri client build output with exit code 0.

- [ ] **Step 3: Sanity check requirements against the spec**

Checklist:

- `/more/workspace-settings` route exists
- entry hidden for non-owner/admin users
- name, slug, logo can all be edited
- logo upload uses backend presign flow and stores a renderable URL
- save button is pristine/invalid disabled
- English and Chinese strings exist

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/services/api/file.ts apps/client/src/services/api/workspace.ts apps/client/src/types/workspace.ts apps/client/src/hooks/useWorkspace.ts apps/client/src/components/layout/contents/WorkspaceSettingsContent.tsx apps/client/src/components/layout/contents/__tests__/WorkspaceSettingsContent.test.tsx apps/client/src/routes/_authenticated/more/workspace-settings.tsx apps/client/src/components/layout/contents/MoreMainContent.tsx apps/client/src/components/layout/contents/__tests__/MoreMainContent.test.tsx apps/client/src/i18n/locales/en/workspace.json apps/client/src/i18n/locales/zh/workspace.json docs/superpowers/plans/2026-03-31-workspace-settings.md
git commit -m "feat: add workspace settings page"
```
