import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock react-i18next so tests don't depend on translation files.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | { defaultValue: string }) => {
      if (typeof fallback === "string") return fallback;
      if (fallback && "defaultValue" in fallback) return fallback.defaultValue;
      return _key;
    },
  }),
}));

// Mock DocumentEditor (Lexical is heavy and not relevant to these
// tests). The mock surfaces a textarea so we can read / change the
// body content directly.
vi.mock("@/components/documents/DocumentEditor", () => ({
  DocumentEditor: (props: {
    initialContent?: string;
    onChange?: (md: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      data-testid="doc-editor"
      data-readonly={props.readOnly ? "true" : "false"}
      defaultValue={props.initialContent ?? ""}
      readOnly={!!props.readOnly}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}));

// Mock useFolderDraft (the shell wraps this with its own state — we
// only need a stable empty draft so the shell renders the body editor).
type DraftState = {
  draft: { body: string; frontmatter: Record<string, unknown> } | null;
  setDraft: ReturnType<typeof vi.fn>;
  clearDraft: ReturnType<typeof vi.fn>;
  isDirty: boolean;
  hasStaleAlert: boolean;
  dismissStaleAlert: ReturnType<typeof vi.fn>;
};
const draftHook = vi.hoisted(() => ({
  state: null as DraftState | null,
}));
vi.mock("@/hooks/useFolderDraft", () => ({
  useFolderDraft: () => draftHook.state,
  buildFolderDraftKey: (k: string, p: string) => `team9.folder.draft.${k}.${p}`,
}));

// Mock current user + workspace so the tab renders.
const mockUseCurrentUser = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));
const mockUseSelectedWorkspaceId = vi.hoisted(() => vi.fn());
vi.mock("@/stores/useWorkspaceStore", () => ({
  useSelectedWorkspaceId: () => mockUseSelectedWorkspaceId(),
}));

// Mock the routine folder API factory + the routines API used by
// SkillMdEditor for the description PATCH.
const fetchTreeMock = vi.hoisted(() => vi.fn());
const fetchBlobMock = vi.hoisted(() => vi.fn());
const commitMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api/folder9-folder", () => ({
  routineFolderApi: () => ({
    fetchTree: fetchTreeMock,
    fetchBlob: fetchBlobMock,
    commit: commitMock,
  }),
}));

const updateMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api/routines", () => ({
  routinesApi: {
    update: (id: string, dto: { description: string }) => updateMock(id, dto),
  },
}));

import { RoutineSkillFolderTab } from "../RoutineSkillFolderTab";
import type { RoutineDetail } from "@/types/routine";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const ROUTINE_ID = "7f3a2b1c-1111-2222-3333-444455556666";

const baseRoutine: RoutineDetail = {
  id: ROUTINE_ID,
  tenantId: "tenant-1",
  botId: null,
  creatorId: "user-1",
  title: "Daily Report",
  description: "Existing routine description.",
  status: "upcoming",
  scheduleType: "once",
  scheduleConfig: null,
  nextRunAt: null,
  version: 1,
  documentId: null,
  folderId: "folder-uuid-1",
  currentExecutionId: null,
  creationChannelId: null,
  creationSessionId: null,
  sourceRef: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  currentExecution: null,
};

const SKILL_MD_CONTENT =
  "---\n" +
  "name: routine-7f3a2b1c-1111\n" +
  "description: Existing routine description.\n" +
  "---\n" +
  "\n" +
  "# Routine body\n";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "alert").mockImplementation(() => {});

  draftHook.state = {
    draft: null,
    setDraft: vi.fn(),
    clearDraft: vi.fn(),
    isDirty: false,
    hasStaleAlert: false,
    dismissStaleAlert: vi.fn(),
  };

  mockUseCurrentUser.mockReturnValue({
    data: {
      id: "user-1",
      email: "u@example.com",
      username: "user1",
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  });
  mockUseSelectedWorkspaceId.mockReturnValue("ws-1");

  fetchTreeMock.mockResolvedValue([
    { name: "SKILL.md", path: "SKILL.md", type: "file", size: 80 },
    { name: "references", path: "references", type: "dir", size: 0 },
    {
      name: "intro.md",
      path: "references/intro.md",
      type: "file",
      size: 20,
    },
    { name: "scripts", path: "scripts", type: "dir", size: 0 },
    {
      name: "deploy.sh",
      path: "scripts/deploy.sh",
      type: "file",
      size: 40,
    },
    { name: "notes.txt", path: "notes.txt", type: "file", size: 5 },
    { name: "logo.png", path: "logo.png", type: "file", size: 64 },
  ]);

  fetchBlobMock.mockImplementation(async (path: string) => {
    if (path === "SKILL.md") {
      return { path, content: SKILL_MD_CONTENT, encoding: "text" };
    }
    if (path === "logo.png") {
      return { path, content: "ZmFrZQ==", encoding: "base64" };
    }
    return { path, content: `body of ${path}`, encoding: "text" };
  });

  commitMock.mockResolvedValue({ sha: "sha-1" });

  updateMock.mockResolvedValue({ ...baseRoutine, description: "updated" });
});

describe("RoutineSkillFolderTab — folder shell wiring", () => {
  it("renders the folder shell when routine.folderId is set", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("routine-skill-folder-tab"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("folder9-folder-editor")).toBeInTheDocument();
    // Default tab opens at SKILL.md (initialPath) → SkillMdEditor
    // surfaces.
    await waitFor(() =>
      expect(screen.getByTestId("routine-skill-md-editor")).toBeInTheDocument(),
    );
  });

  it("renders an empty placeholder when routine.folderId is null", () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={{ ...baseRoutine, folderId: null }} />
      </Wrapper>,
    );
    expect(
      screen.getByTestId("routine-skill-folder-empty"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("folder9-folder-editor")).toBeNull();
  });

  it("renders nothing while the workspace / user identity is unresolved", () => {
    mockUseSelectedWorkspaceId.mockReturnValue(null);
    const Wrapper = makeWrapper();
    const { container } = render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );
    // No tab and no shell rendered.
    expect(container.querySelector("[data-testid]")).toBeNull();
  });
});

describe("RoutineSkillFolderTab — SKILL.md composite editor", () => {
  it("renders read-only skill name computed from routine.id", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );
    const nameInput = (await screen.findByTestId(
      "routine-skill-name",
    )) as HTMLInputElement;
    // First two segments of the UUID, prefixed with "routine-".
    expect(nameInput.value).toBe("routine-7f3a2b1c-1111");
    expect(nameInput.readOnly).toBe(true);
  });

  it("seeds description from routines.description (not the file frontmatter)", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab
          routine={{
            ...baseRoutine,
            description: "from routines table",
          }}
        />
      </Wrapper>,
    );

    // The frontmatter says "Existing routine description." but the
    // routines row is the source of truth.
    const desc = (await screen.findByTestId(
      "routine-skill-description",
    )) as HTMLInputElement;
    expect(desc.value).toBe("from routines table");
  });

  it("PATCHes the routine then commits the SKILL.md when description changes", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );

    const desc = (await screen.findByTestId(
      "routine-skill-description",
    )) as HTMLInputElement;
    fireEvent.change(desc, { target: { value: "New description" } });

    const saveBtn = await screen.findByTestId("routine-skill-save");
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    // PATCH first.
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(ROUTINE_ID, {
        description: "New description",
      }),
    );

    // The composite editor pushes the regenerated source through the
    // shell's onChange, which records it via setDraft (mocked).
    await waitFor(() => {
      expect(draftHook.state!.setDraft).toHaveBeenCalled();
    });
    const setDraftCalls = draftHook.state!.setDraft.mock.calls;
    const lastCall = setDraftCalls[setDraftCalls.length - 1][0];
    expect(lastCall.body).toContain("description: New description");
    expect(lastCall.body).toContain("name: routine-7f3a2b1c-1111");
    expect(lastCall.body).toContain("# Routine body");
  });

  it("does not commit when the PATCH fails", async () => {
    updateMock.mockRejectedValueOnce(new Error("patch failed"));
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );

    const desc = (await screen.findByTestId(
      "routine-skill-description",
    )) as HTMLInputElement;
    fireEvent.change(desc, { target: { value: "Should not commit" } });

    const initialSetDraftCalls = draftHook.state!.setDraft.mock.calls.length;
    const saveBtn = await screen.findByTestId("routine-skill-save");
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    // No subsequent setDraft (which is what would have carried the
    // new SKILL.md body up to the shell for commit).
    expect(draftHook.state!.setDraft.mock.calls.length).toBe(
      initialSetDraftCalls,
    );
  });

  it("skips the PATCH and commits directly when only the body changed", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );

    // The skill-md editor surface is up — find the body editor inside
    // the SkillMdEditor and simulate a typed change. We use the
    // SkillMdEditor's containing div as scope to disambiguate from
    // any other doc-editor instances the shell may have rendered.
    await screen.findByTestId("routine-skill-md-editor");
    const editors = screen.getAllByTestId("doc-editor");
    expect(editors.length).toBeGreaterThan(0);
    // The body editor is the last `doc-editor` mounted under the
    // SkillMdEditor (only one in our markup today).
    fireEvent.change(editors[editors.length - 1], {
      target: { value: "# New body" },
    });

    const saveBtn = await screen.findByTestId("routine-skill-save");
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(updateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(draftHook.state!.setDraft).toHaveBeenCalled());
    const setDraftCalls = draftHook.state!.setDraft.mock.calls;
    const lastCall = setDraftCalls[setDraftCalls.length - 1][0];
    expect(lastCall.body).toContain("# New body");
  });
});

describe("RoutineSkillFolderTab — references and scripts", () => {
  it("renders DocumentEditor for references/*.md", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );

    // Expand the references directory before its children render.
    const refDir = await screen.findByRole("treeitem", {
      name: /references/,
    });
    await act(async () => {
      fireEvent.click(refDir);
    });

    const refRow = await screen.findByRole("treeitem", {
      name: /intro\.md/,
    });
    await act(async () => {
      fireEvent.click(refRow);
    });

    await waitFor(() => {
      const editors = screen.getAllByTestId("doc-editor");
      // The reference's DocumentEditor seeded with "body of references/intro.md".
      expect(
        editors.some((el) =>
          (el as HTMLTextAreaElement).value.startsWith(
            "body of references/intro.md",
          ),
        ),
      ).toBe(true);
    });
  });

  it("renders monospace textarea for scripts/* and propagates edits", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );

    // Expand scripts/ before its children render.
    const scriptsDir = await screen.findByRole("treeitem", {
      name: /scripts/,
    });
    await act(async () => {
      fireEvent.click(scriptsDir);
    });

    const scriptRow = await screen.findByRole("treeitem", {
      name: /deploy\.sh/,
    });
    await act(async () => {
      fireEvent.click(scriptRow);
    });

    const ta = await screen.findByTestId("routine-script-editor");
    expect((ta as HTMLTextAreaElement).value).toBe("body of scripts/deploy.sh");

    fireEvent.change(ta, { target: { value: "echo updated" } });
    expect(draftHook.state!.setDraft).toHaveBeenCalledWith(
      expect.objectContaining({ body: "echo updated" }),
    );
  });

  it("renders read-only viewer for arbitrary other text files", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );

    const txtRow = await screen.findByRole("treeitem", {
      name: /notes\.txt/,
    });
    await act(async () => {
      fireEvent.click(txtRow);
    });

    const ro = await screen.findByTestId("routine-readonly-text");
    expect((ro as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it("falls through to the binary placeholder for image files", async () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );

    const imgRow = await screen.findByRole("treeitem", {
      name: /logo\.png/,
    });
    await act(async () => {
      fireEvent.click(imgRow);
    });

    expect(
      await screen.findByTestId("folder9-folder-binary"),
    ).toBeInTheDocument();
  });
});

describe("RoutineSkillFolderTab — read-only mode", () => {
  it("disables affordances and hides save when permission resolves to read", async () => {
    // No current user → `canEdit = false` → permission "read".
    mockUseCurrentUser.mockReturnValue({ data: undefined });

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RoutineSkillFolderTab routine={baseRoutine} />
      </Wrapper>,
    );

    // SKILL.md editor still renders, but its description input is
    // disabled and the Save button is gone.
    await waitFor(() =>
      expect(screen.getByTestId("routine-skill-md-editor")).toBeInTheDocument(),
    );
    const desc = screen.getByTestId(
      "routine-skill-description",
    ) as HTMLInputElement;
    expect(desc.disabled).toBe(true);
    expect(screen.queryByTestId("routine-skill-save")).toBeNull();
  });
});
