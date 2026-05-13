import {
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  FileText,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Folder9FolderEditor,
  type Folder9Permission,
} from "@/components/folder9-editor/Folder9FolderEditor";
import { useCurrentUser } from "@/hooks/useAuth";
import {
  useDeleteSkill,
  useSkill,
  useSkills,
  useUpdateSkill,
} from "@/hooks/useSkills";
import { skillFolderApi } from "@/services/api/folder9-folder";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { cn } from "@/lib/utils";
import { AgentAccessControl } from "./AgentAccessControl";
import { CreateSkillDialog } from "./CreateSkillDialog";
import type { Skill } from "@/types/skill";

interface SkillsListPageProps {
  selectedSkillId?: string;
}

const SKILLS_LIST_WIDTH_DEFAULT = 360;
const SKILLS_LIST_WIDTH_MIN = 280;
const SKILLS_LIST_WIDTH_MAX = 640;

function clampSkillsListWidth(width: number) {
  return Math.min(
    SKILLS_LIST_WIDTH_MAX,
    Math.max(SKILLS_LIST_WIDTH_MIN, width),
  );
}

export function SkillsListPage({ selectedSkillId }: SkillsListPageProps) {
  const { t } = useTranslation("skills");
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [listWidth, setListWidth] = useState(SKILLS_LIST_WIDTH_DEFAULT);

  const { data: skills, isLoading } = useSkills();
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSkills = useMemo(
    () =>
      (skills ?? []).filter((skill) => {
        if (!normalizedQuery) return true;
        return (
          skill.name.toLowerCase().includes(normalizedQuery) ||
          (skill.description ?? "").toLowerCase().includes(normalizedQuery)
        );
      }),
    [normalizedQuery, skills],
  );

  const activeSkillId = selectedSkillId ?? filteredSkills[0]?.id ?? null;

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = listWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      setListWidth(
        clampSkillsListWidth(startWidth + moveEvent.clientX - startX),
      );
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    setListWidth((currentWidth) =>
      clampSkillsListWidth(
        currentWidth + (event.key === "ArrowRight" ? step : -step),
      ),
    );
  };

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside
        data-testid="skills-list-sidebar"
        className="relative shrink-0 border-r border-border bg-muted/20 flex flex-col min-h-0"
        style={{ width: listWidth }}
      >
        <div className="px-5 pt-5 pb-4 space-y-4 border-b border-border/70">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-semibold">{t("title")}</h1>
            <Button
              size="icon"
              className="h-9 w-9"
              aria-label={t("create.create")}
              onClick={() => setShowCreate(true)}
            >
              <Plus size={18} />
            </Button>
          </div>
          <div className="relative">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9 bg-background"
              placeholder={t("searchPlaceholder", {
                defaultValue: "Search skills",
              })}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <Sparkles size={32} />
              <p className="text-sm">{t("empty")}</p>
              <p className="text-xs">{t("emptyDescription")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSkills.map((skill) => (
                <SkillListItem
                  key={skill.id}
                  skill={skill}
                  active={skill.id === activeSkillId}
                  onClick={() =>
                    navigate({
                      to: "/skills/$skillId",
                      params: { skillId: skill.id },
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
        <div
          role="separator"
          aria-label="Resize skills list"
          aria-orientation="vertical"
          aria-valuemin={SKILLS_LIST_WIDTH_MIN}
          aria-valuemax={SKILLS_LIST_WIDTH_MAX}
          aria-valuenow={listWidth}
          tabIndex={0}
          data-testid="skills-list-resize-handle"
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
          className="absolute inset-y-0 right-0 w-1 cursor-col-resize bg-transparent outline-none transition-colors hover:bg-border focus-visible:bg-primary/50 active:bg-primary/50"
        />
      </aside>

      <main className="flex-1 min-w-0 min-h-0">
        {activeSkillId ? (
          <SkillFolderPanel skillId={activeSkillId} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Sparkles size={36} />
            <p className="text-sm">{t("empty")}</p>
          </div>
        )}
      </main>

      <CreateSkillDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
      />
    </div>
  );
}

function SkillListItem({
  skill,
  active,
  onClick,
}: {
  skill: Skill;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "w-full rounded-md border border-transparent px-3 py-4 text-left transition-colors",
        active
          ? "border-primary bg-background shadow-sm"
          : "hover:bg-background/70",
      )}
      onClick={onClick}
    >
      <div className="font-semibold leading-6 truncate">{skill.name}</div>
      {skill.description && (
        <p className="mt-1 text-sm leading-6 text-muted-foreground line-clamp-2">
          {skill.description}
        </p>
      )}
    </button>
  );
}

function SkillFolderPanel({ skillId }: { skillId: string }) {
  const { t } = useTranslation("skills");
  const navigate = useNavigate();
  const { data: skill, isLoading, error } = useSkill(skillId);
  const { data: currentUser, isLoading: isCurrentUserLoading } =
    useCurrentUser();
  const workspaceId = useSelectedWorkspaceId();
  const deleteSkill = useDeleteSkill();
  const updateSkill = useUpdateSkill(skillId);

  const api = useMemo(() => skillFolderApi(skillId), [skillId]);
  const permission: Folder9Permission = currentUser ? "write" : "read";
  const draftKey =
    workspaceId && currentUser
      ? `skill.${workspaceId}.${skillId}.${currentUser.id}`
      : `skill.${skillId}.anon`;

  function handleDelete() {
    if (!confirm(t("detail.deleteConfirm"))) return;
    deleteSkill.mutate(skillId, {
      onSuccess: () => navigate({ to: "/skills" }),
    });
  }

  if (isLoading || isCurrentUserLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertTriangle size={32} />
        <p className="text-sm">{t("detail.loadError")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <FileText size={22} className="text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{skill.name}</h2>
          {skill.description && (
            <p className="truncate text-sm text-muted-foreground">
              {skill.description}
            </p>
          )}
        </div>
        <AgentAccessControl
          value={skill.agentAccess}
          onChange={(next) => updateSkill.mutate({ agentAccess: next })}
          disabled={updateSkill.isPending}
        />
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive"
          aria-label={t("detail.delete")}
          onClick={handleDelete}
        >
          <Trash2 size={17} />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <Folder9FolderEditor
          folderId={skill.folderId ?? skill.id}
          permission={permission}
          approvalMode="auto"
          api={api}
          draftKey={draftKey}
          initialPath="skill.md"
          hideTree={false}
          treePosition="right"
        />
      </div>
    </div>
  );
}
