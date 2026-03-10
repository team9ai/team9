import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Route } from "@/routes/_authenticated/skills/$skillId";
import {
  ArrowLeft,
  Loader2,
  Trash2,
  AlertTriangle,
  Save,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useSkill,
  useSkillVersion,
  useSkillVersions,
  useCreateSkillVersion,
  useDeleteSkill,
} from "@/hooks/useSkills";
import { FileTree } from "./FileTree";
import { FileEditor } from "./FileEditor";
import { SuggestionReviewPanel } from "./SuggestionReviewPanel";
import type { SkillFile } from "@/types/skill";

export function SkillDetailPage() {
  const { t } = useTranslation("skills");
  const navigate = useNavigate();
  const { skillId } = Route.useParams();

  const { data: skill, isLoading, error } = useSkill(skillId);
  const { data: versions } = useSkillVersions(skillId);
  const deleteSkill = useDeleteSkill();
  const createVersion = useCreateSkillVersion(skillId);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [reviewingVersion, setReviewingVersion] = useState<number | null>(null);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showSaveVersion, setShowSaveVersion] = useState(false);
  const [versionMessage, setVersionMessage] = useState("");

  // Track edits: path -> content
  const [editedFiles, setEditedFiles] = useState<Map<string, string>>(
    new Map(),
  );

  // Fetch historical version if viewing one
  const { data: historicalVersion } = useSkillVersion(
    skillId,
    viewingVersion ?? undefined,
  );

  const isViewingHistory = viewingVersion !== null;
  const baseFiles: SkillFile[] = isViewingHistory
    ? (historicalVersion?.files ?? [])
    : (skill?.files ?? []);

  // Merge in locally-added new files (files in editedFiles that don't exist in baseFiles)
  const displayFiles: SkillFile[] = isViewingHistory
    ? baseFiles
    : [
        ...baseFiles,
        ...[...editedFiles.entries()]
          .filter(([path]) => !baseFiles.find((f) => f.path === path))
          .map(([path, content]) => ({
            id: `new-${path}`,
            skillId: skillId,
            path,
            content,
            size: content.length,
            createdAt: new Date().toISOString(),
          })),
      ];

  const selectedFile = displayFiles.find((f) => f.path === selectedPath);

  // Auto-select first file when files change or selected file no longer exists
  useEffect(() => {
    if (
      displayFiles.length > 0 &&
      !displayFiles.find((f) => f.path === selectedPath)
    ) {
      setSelectedPath(displayFiles[0].path);
    }
  }, [displayFiles, selectedPath]);

  function handleFileSave(content: string) {
    if (!selectedPath) return;
    setEditedFiles((prev) => new Map(prev).set(selectedPath, content));
  }

  function handleNewFile() {
    if (!newFileName.trim()) return;
    const path = newFileName.trim();
    setEditedFiles((prev) => new Map(prev).set(path, ""));
    setSelectedPath(path);
    setShowNewFile(false);
    setNewFileName("");
  }

  function handleUploadFiles(uploaded: { path: string; content: string }[]) {
    setEditedFiles((prev) => {
      const next = new Map(prev);
      for (const f of uploaded) next.set(f.path, f.content);
      return next;
    });
    // Select the first uploaded file
    if (uploaded.length > 0) setSelectedPath(uploaded[0].path);
  }

  function handleDeleteFile(path: string) {
    if (!skill) return;
    if (selectedPath === path) {
      setSelectedPath(null);
    }

    const isNewFile = !(skill.files ?? []).find((f) => f.path === path);

    setEditedFiles((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });

    // If it's a locally-added file, just remove from local state
    if (isNewFile) return;

    // Otherwise publish a version without the file
    const remainingFiles = (skill.files ?? [])
      .filter((f) => f.path !== path)
      .map((f) => ({
        path: f.path,
        content: editedFiles.get(f.path) ?? f.content,
      }));
    createVersion.mutate({
      files: remainingFiles,
      status: "published",
      message: `Delete ${path}`,
    });
  }

  function handleSaveVersion() {
    if (!skill) return;
    const existingFiles = (skill.files ?? []).map((f) => ({
      path: f.path,
      content: editedFiles.get(f.path) ?? f.content,
    }));
    // Include locally-added new files
    const newFiles = [...editedFiles.entries()]
      .filter(([path]) => !(skill.files ?? []).find((f) => f.path === path))
      .map(([path, content]) => ({ path, content }));
    const files = [...existingFiles, ...newFiles];
    createVersion.mutate(
      {
        files,
        status: "published",
        message: versionMessage.trim() || undefined,
      },
      {
        onSuccess: () => {
          setShowSaveVersion(false);
          setVersionMessage("");
          setEditedFiles(new Map());
        },
      },
    );
  }

  function handleDelete() {
    if (!confirm(t("detail.deleteConfirm"))) return;
    deleteSkill.mutate(skillId, {
      onSuccess: () => navigate({ to: "/skills" }),
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <AlertTriangle size={32} />
        <p className="text-sm">{t("detail.loadError")}</p>
      </div>
    );
  }

  const hasEdits = editedFiles.size > 0;
  const hasPendingSuggestions = (skill.pendingSuggestions?.length ?? 0) > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/skills" })}
        >
          <ArrowLeft size={16} />
        </Button>

        <span className="text-xl">{skill.icon || "🧩"}</span>
        <h1 className="font-semibold truncate">{skill.name}</h1>

        <Badge variant="secondary" className="text-xs">
          {t(`type.${skill.type}` as const)}
        </Badge>

        <div className="flex-1" />

        {/* Version selector */}
        <Select
          value={viewingVersion !== null ? String(viewingVersion) : "current"}
          onValueChange={(v) =>
            setViewingVersion(v === "current" ? null : Number(v))
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">
              {t("version.current")} (v{skill.currentVersion})
            </SelectItem>
            {versions?.map((v) => (
              <SelectItem key={v.version} value={String(v.version)}>
                <div className="flex items-center gap-1.5">
                  <span>{t("version.version", { version: v.version })}</span>
                  {v.status === "suggested" && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      {t("status.suggested")}
                    </span>
                  )}
                  {v.status === "rejected" && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      {t("status.rejected")}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasEdits && !isViewingHistory && (
          <Button size="sm" onClick={() => setShowSaveVersion(true)}>
            <Save size={14} className="mr-1" />
            {t("version.saveVersion")}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={handleDelete}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Pending suggestion banner */}
      {hasPendingSuggestions && !reviewingVersion && (
        <div className="flex items-center gap-2 px-4 py-2 bg-orange-50 dark:bg-orange-950/30 border-b border-orange-200 dark:border-orange-900">
          <AlertTriangle size={16} className="text-orange-600" />
          <span className="text-sm text-orange-700 dark:text-orange-400">
            {t("version.pendingSuggestion")}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              const first = skill.pendingSuggestions?.[0];
              if (first) setReviewingVersion(first.version);
            }}
          >
            {t("detail.review")}
          </Button>
        </div>
      )}

      {/* Review panel overlay */}
      {reviewingVersion !== null && (
        <SuggestionReviewPanel
          skillId={skillId}
          version={reviewingVersion}
          currentFiles={skill.files}
          onClose={() => setReviewingVersion(null)}
        />
      )}

      {/* Main content: file tree + editor */}
      {reviewingVersion === null && (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: File tree */}
          <div className="w-56 border-r border-border shrink-0">
            <FileTree
              files={displayFiles}
              selectedPath={selectedPath}
              onSelectFile={setSelectedPath}
              onNewFile={
                !isViewingHistory ? () => setShowNewFile(true) : undefined
              }
              onUploadFiles={!isViewingHistory ? handleUploadFiles : undefined}
              onDeleteFile={!isViewingHistory ? handleDeleteFile : undefined}
              readOnly={isViewingHistory}
            />
          </div>

          {/* Right: Editor */}
          <div className="flex-1 overflow-hidden">
            {selectedFile ? (
              <FileEditor
                file={
                  editedFiles.has(selectedFile.path)
                    ? {
                        ...selectedFile,
                        content: editedFiles.get(selectedFile.path)!,
                      }
                    : selectedFile
                }
                readOnly={isViewingHistory}
                onSave={handleFileSave}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                {displayFiles.length > 0
                  ? t("detail.selectFile")
                  : t("detail.noFiles")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* New file dialog */}
      <Dialog open={showNewFile} onOpenChange={setShowNewFile}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("detail.newFile")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder={t("detail.newFilePlaceholder")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNewFile();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              size="sm"
              onClick={handleNewFile}
              disabled={!newFileName.trim()}
            >
              <Plus size={14} className="mr-1" />
              {t("create.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save version dialog */}
      <Dialog open={showSaveVersion} onOpenChange={setShowSaveVersion}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("version.saveVersion")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={versionMessage}
              onChange={(e) => setVersionMessage(e.target.value)}
              placeholder={t("version.versionMessagePlaceholder")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveVersion();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              size="sm"
              onClick={handleSaveVersion}
              disabled={createVersion.isPending}
            >
              {createVersion.isPending && (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              )}
              <Save size={14} className="mr-1" />
              {t("version.saveVersion")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
