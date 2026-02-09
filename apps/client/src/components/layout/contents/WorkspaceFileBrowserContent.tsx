import { ArrowLeft, FolderOpen, Loader2, AlertCircle } from "lucide-react";
import { MarkdownViewer } from "@/components/workspace/MarkdownViewer";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import type {
  FileKeeperTokenResponse,
  FileKeeperDirEntry,
} from "@/services/api/applications";
import { FileManager } from "@cubone/react-file-manager";
import "@cubone/react-file-manager/dist/style.css";
import styles from "./WorkspaceFileBrowser.module.scss";

interface WorkspaceFileBrowserContentProps {
  staffId: string;
  workspaceName: string;
  /** Hide the back-button header when embedded inside another page */
  embedded?: boolean;
}

interface CuboneFile {
  name: string;
  isDirectory: boolean;
  path: string;
  updatedAt?: string;
  size?: number;
}

function toFileManagerFiles(
  entries: FileKeeperDirEntry[],
  currentPath: string,
): CuboneFile[] {
  return entries.map((e) => ({
    name: e.name,
    isDirectory: e.type === "directory",
    path:
      currentPath === "." || currentPath === ""
        ? `/${e.name}`
        : `/${currentPath}/${e.name}`,
    updatedAt: e.modified,
    size: e.size,
  }));
}

export function WorkspaceFileBrowserContent({
  staffId,
  workspaceName,
  embedded,
}: WorkspaceFileBrowserContentProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();
  const [currentPath, setCurrentPath] = useState(".");
  const [openFile, setOpenFile] = useState<CuboneFile | null>(null);
  const tokenRef = useRef<FileKeeperTokenResponse | null>(null);

  // Fetch file-keeper token
  const { data: tokenData, isLoading: tokenLoading } = useQuery({
    queryKey: ["file-keeper-token", workspaceId, staffId],
    queryFn: async () => {
      const data = await api.applications.getFileKeeperToken(staffId);
      tokenRef.current = data;
      return data;
    },
    enabled: !!workspaceId,
    staleTime: 30 * 60 * 1000, // 30 min (token valid for 1 hour)
  });

  // List files for the current path
  const {
    data: filesData,
    isLoading: filesLoading,
    isFetching: filesFetching,
    error: filesError,
  } = useQuery({
    queryKey: [
      "workspace-files",
      workspaceId,
      staffId,
      workspaceName,
      currentPath,
    ],
    queryFn: () =>
      api.applications.listWorkspaceFiles(
        tokenData!,
        workspaceName,
        currentPath,
      ),
    enabled: !!tokenData,
    placeholderData: keepPreviousData,
  });

  const files = useMemo(
    () => (filesData ? toFileManagerFiles(filesData.entries, currentPath) : []),
    [filesData, currentPath],
  );

  const getToken = useCallback((): FileKeeperTokenResponse => {
    if (!tokenRef.current) throw new Error("Token not available");
    return tokenRef.current;
  }, []);

  const invalidateFiles = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["workspace-files", workspaceId, staffId, workspaceName],
    });
  }, [queryClient, workspaceId, staffId, workspaceName]);

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: async (filesToDelete: CuboneFile[]) => {
      const token = getToken();
      for (const f of filesToDelete) {
        const relativePath = f.path.startsWith("/") ? f.path.slice(1) : f.path;
        await api.applications.deleteWorkspaceFile(
          token,
          workspaceName,
          relativePath,
          f.isDirectory,
        );
      }
    },
    onSuccess: invalidateFiles,
  });

  const createFolderMutation = useMutation({
    mutationFn: async ({
      name,
      parentFolder,
    }: {
      name: string;
      parentFolder: CuboneFile | null;
    }) => {
      const token = getToken();
      let folderPath: string;
      if (!parentFolder) {
        const base =
          currentPath === "." || currentPath === "" ? "" : currentPath;
        folderPath = base ? `${base}/${name}` : name;
      } else {
        const parentPath = parentFolder.path.startsWith("/")
          ? parentFolder.path.slice(1)
          : parentFolder.path;
        folderPath = parentPath ? `${parentPath}/${name}` : name;
      }
      await api.applications.createWorkspaceFolder(
        token,
        workspaceName,
        folderPath,
      );
    },
    onSuccess: invalidateFiles,
  });

  // Build upload config for @cubone/react-file-manager
  const fileUploadConfig = useMemo(() => {
    if (!tokenData) return undefined;
    const uploadPath = currentPath === "." ? "" : currentPath;
    const url = api.applications._buildFileKeeperUrl(
      tokenData,
      workspaceName,
      uploadPath,
    );
    return {
      url,
      method: "PUT" as const,
      headers: {
        Authorization: `Bearer ${tokenData.token}`,
      },
    };
  }, [tokenData, workspaceName, currentPath]);

  const renameMutation = useMutation({
    mutationFn: async ({
      file,
      newName,
    }: {
      file: CuboneFile;
      newName: string;
    }) => {
      const token = getToken();
      const oldPath = file.path.startsWith("/")
        ? file.path.slice(1)
        : file.path;
      const parentDir = oldPath.includes("/")
        ? oldPath.substring(0, oldPath.lastIndexOf("/"))
        : "";
      const newPath = parentDir ? `${parentDir}/${newName}` : newName;
      await api.applications.renameWorkspaceFile(
        token,
        workspaceName,
        oldPath,
        newPath,
      );
    },
    onSuccess: invalidateFiles,
  });

  const pasteMutation = useMutation({
    mutationFn: async ({
      files,
      destination,
      operationType,
    }: {
      files: CuboneFile[];
      destination: CuboneFile | null;
      operationType: "move" | "copy";
    }) => {
      const token = getToken();
      const destDir = destination
        ? destination.path.startsWith("/")
          ? destination.path.slice(1)
          : destination.path
        : currentPath === "." || currentPath === ""
          ? ""
          : currentPath;
      for (const f of files) {
        const srcPath = f.path.startsWith("/") ? f.path.slice(1) : f.path;
        const newPath = destDir ? `${destDir}/${f.name}` : f.name;
        if (operationType === "move") {
          await api.applications.renameWorkspaceFile(
            token,
            workspaceName,
            srcPath,
            newPath,
          );
        } else {
          await api.applications.copyWorkspaceFile(
            token,
            workspaceName,
            srcPath,
            newPath,
          );
        }
      }
    },
    onSuccess: invalidateFiles,
  });

  const downloadMutation = useMutation({
    mutationFn: async (filesToDownload: CuboneFile[]) => {
      const token = getToken();
      for (const f of filesToDownload) {
        if (f.isDirectory) continue;
        const relativePath = f.path.startsWith("/") ? f.path.slice(1) : f.path;
        const blob = await api.applications.downloadWorkspaceFile(
          token,
          workspaceName,
          relativePath,
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    },
  });

  const isLoading = tokenLoading || filesLoading;

  // Make the drop zone clickable to trigger file picker (event delegation
  // because the upload dialog is mounted dynamically)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".draggable-file-input")) return;
      const fileInput = document.querySelector<HTMLInputElement>("#chooseFile");
      fileInput?.click();
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return (
    <main className="h-full flex flex-col bg-background">
      {!embedded && (
        <>
          <header className="h-14 bg-background flex items-center gap-2 px-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                navigate({
                  to: "/ai-staff/$staffId",
                  params: { staffId },
                })
              }
            >
              <ArrowLeft size={18} />
            </Button>
            <FolderOpen size={18} className="text-primary" />
            <h2 className="font-semibold text-lg text-foreground">
              {workspaceName}
            </h2>
          </header>
          <Separator />
        </>
      )}

      {/* File Manager / Markdown Viewer */}
      <div className="flex-1 overflow-hidden">
        {openFile && tokenData ? (
          <MarkdownViewer
            file={openFile}
            tokenData={tokenData}
            workspaceName={workspaceName}
            onClose={() => setOpenFile(null)}
          />
        ) : (
          <>
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {filesError && (
              <Card className="m-4 p-6 text-center">
                <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Failed to load workspace files
                </p>
              </Card>
            )}

            {!isLoading && !filesError && tokenData && (
              <FileManager
                files={files}
                isLoading={
                  filesFetching ||
                  deleteMutation.isPending ||
                  createFolderMutation.isPending ||
                  renameMutation.isPending ||
                  pasteMutation.isPending ||
                  downloadMutation.isPending
                }
                layout="list"
                height={embedded ? "100%" : "calc(100vh - 56px)"}
                fileUploadConfig={fileUploadConfig}
                className={styles.hideNavPane}
                defaultNavExpanded={false}
                onFileOpen={(file: CuboneFile) => {
                  if (!file.isDirectory && /\.md$/i.test(file.name)) {
                    setOpenFile(file);
                  }
                }}
                onCreateFolder={(
                  name: string,
                  parentFolder: CuboneFile | null,
                ) => createFolderMutation.mutate({ name, parentFolder })}
                onDelete={(filesToDelete: CuboneFile[]) =>
                  deleteMutation.mutate(filesToDelete)
                }
                onRename={(file: CuboneFile, newName: string) =>
                  renameMutation.mutate({ file, newName })
                }
                onPaste={(
                  files: CuboneFile[],
                  destination: CuboneFile | null,
                  operationType: "move" | "copy",
                ) =>
                  pasteMutation.mutate({ files, destination, operationType })
                }
                onDownload={(filesToDownload: CuboneFile[]) =>
                  downloadMutation.mutate(filesToDownload)
                }
                onFileUploaded={() => invalidateFiles()}
                onRefresh={() => invalidateFiles()}
                onFolderChange={(path: string) => {
                  // @cubone paths start with "/", strip leading slash for file-keeper
                  const normalized =
                    path === "/" || path === "" ? "." : path.replace(/^\//, "");
                  setCurrentPath(normalized);
                }}
                permissions={{
                  upload: true,
                  download: true,
                  delete: true,
                  create: true,
                  rename: true,
                  move: true,
                  copy: true,
                }}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
