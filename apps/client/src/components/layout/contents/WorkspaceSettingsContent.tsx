import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  useCurrentWorkspaceRole,
  useUpdateWorkspace,
  useWorkspace,
} from "@/hooks/useWorkspace";
import { fileApi } from "@/services/api/file";
import { useWorkspaceStore } from "@/stores";
import type { UpdateWorkspaceDto } from "@/types/workspace";

const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const ALLOWED_LOGO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);

type NameValidationKey = "nameTooShort" | "nameTooLong";
type SlugValidationKey = "slugTooShort" | "slugTooLong" | "slugInvalidFormat";

function validateName(name: string): NameValidationKey | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "nameTooShort";
  if (trimmed.length > 100) return "nameTooLong";
  return null;
}

function validateSlug(slug: string): SlugValidationKey | null {
  const trimmed = slug.trim();
  if (trimmed.length < 2) return "slugTooShort";
  if (trimmed.length > 50) return "slugTooLong";
  if (!SLUG_PATTERN.test(trimmed)) return "slugInvalidFormat";
  return null;
}

export function WorkspaceSettingsContent() {
  const { t } = useTranslation("workspace");
  const { selectedWorkspaceId } = useWorkspaceStore();
  const { isOwnerOrAdmin } = useCurrentWorkspaceRole();
  const { data: workspace, isLoading } = useWorkspace(
    selectedWorkspaceId || undefined,
  );
  const updateWorkspace = useUpdateWorkspace();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    setName(workspace.name);
    setSlug(workspace.slug);
    setLogoUrl(workspace.logoUrl);
    setSavedMessage(null);
    setSubmitError(null);
  }, [workspace]);

  const nameError = useMemo(() => validateName(name), [name]);
  const slugError = useMemo(() => validateSlug(slug), [slug]);

  const isDirty =
    !!workspace &&
    (name.trim() !== workspace.name ||
      slug.trim() !== workspace.slug ||
      (logoUrl ?? null) !== (workspace.logoUrl ?? null));

  const canSave =
    !!workspace &&
    !nameError &&
    !slugError &&
    isDirty &&
    !updateWorkspace.isPending &&
    !isUploadingLogo;

  const handleLogoChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadError(null);
    setSavedMessage(null);

    if (file.size > MAX_LOGO_SIZE) {
      setUploadError(t("logoTooLarge"));
      return;
    }

    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setUploadError(t("logoInvalidType"));
      return;
    }

    try {
      setIsUploadingLogo(true);
      const presigned = await fileApi.createPresignedUpload({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        fileSize: file.size,
        visibility: "public",
      });

      await fileApi.uploadToS3(presigned.url, file, presigned.fields);
      await fileApi.confirmUpload({
        key: presigned.key,
        fileName: file.name,
        visibility: "public",
      });

      setLogoUrl(presigned.publicUrl);
    } catch (error: any) {
      setUploadError(
        error?.response?.data?.message ||
          error?.message ||
          t("logoUploadFailed"),
      );
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleSubmit = async () => {
    if (!workspace || !selectedWorkspaceId || !canSave) return;

    setSubmitError(null);
    setSavedMessage(null);

    const data: Partial<UpdateWorkspaceDto> = {};
    if (name.trim() !== workspace.name) data.name = name.trim();
    if (slug.trim() !== workspace.slug) data.slug = slug.trim();
    if ((logoUrl ?? null) !== (workspace.logoUrl ?? null))
      data.logoUrl = logoUrl;

    try {
      await updateWorkspace.mutateAsync({
        workspaceId: selectedWorkspaceId,
        data,
      });
      setSavedMessage(t("settingsSaved"));
    } catch (error: any) {
      const status = error?.response?.status ?? error?.status;
      if (status === 409) {
        setSubmitError(t("slugAlreadyTaken"));
      } else {
        setSubmitError(
          error?.response?.data?.message ||
            error?.message ||
            t("settingsSaveFailed"),
        );
      }
    }
  };

  if (isLoading) {
    return (
      <main className="h-full flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">
          {t("loading", "Loading...")}
        </div>
      </main>
    );
  }

  if (!isOwnerOrAdmin) {
    return (
      <main className="h-full flex flex-col overflow-hidden bg-background">
        <header className="h-14 bg-background flex items-center gap-3 px-4 border-b">
          <Link to="/more">
            <Button variant="ghost" size="icon">
              <ArrowLeft size={20} />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">
            {t("workspaceSettings", "Workspace Settings")}
          </h1>
        </header>

        <div className="flex-1 p-6 bg-secondary/30">
          <Card className="max-w-3xl">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle size={16} />
                {t(
                  "workspaceSettingsUnauthorized",
                  "You don't have permission to edit workspace settings",
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full flex flex-col overflow-hidden bg-background">
      <header className="h-14 bg-background flex items-center gap-3 px-4 border-b">
        <Link to="/more">
          <Button variant="ghost" size="icon">
            <ArrowLeft size={20} />
          </Button>
        </Link>
        <h1 className="text-lg font-semibold">
          {t("workspaceSettings", "Workspace Settings")}
        </h1>
      </header>

      <ScrollArea className="flex-1 min-h-0 bg-secondary/30">
        <div className="p-6">
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>
                {t("workspaceSettings", "Workspace Settings")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {submitError && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle size={16} />
                  {submitError}
                </div>
              )}

              {uploadError && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle size={16} />
                  {uploadError}
                </div>
              )}

              {savedMessage && (
                <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                  {savedMessage}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="workspace-logo">{t("logo", "Logo")}</Label>
                <div className="flex items-center gap-4">
                  <div className="group relative">
                    <Avatar className="h-16 w-16 rounded-2xl">
                      {logoUrl ? (
                        <AvatarImage src={logoUrl} alt={name} />
                      ) : null}
                      <AvatarFallback className="rounded-2xl bg-primary/10 text-primary text-lg">
                        {(name || workspace?.name || "W")
                          .charAt(0)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <Camera size={18} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <input
                      id="workspace-logo"
                      aria-label="Workspace logo"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      className="sr-only"
                      onChange={handleLogoChange}
                    />
                    <Label htmlFor="workspace-logo" className="cursor-pointer">
                      <span className="inline-flex h-9 items-center rounded-md border px-3 text-sm">
                        {isUploadingLogo
                          ? t("uploadingLogo", "Uploading...")
                          : t("changeLogo", "Change logo")}
                      </span>
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("logoHint", "PNG, JPG, WEBP, or SVG up to 5MB")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="workspace-name">{t("name", "Name")}</Label>
                <Input
                  id="workspace-name"
                  aria-invalid={!!nameError}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSavedMessage(null);
                  }}
                />
                {nameError && (
                  <p className="text-sm text-destructive">{t(nameError)}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="workspace-slug">{t("slug", "Slug")}</Label>
                <Input
                  id="workspace-slug"
                  aria-invalid={!!slugError}
                  value={slug}
                  onChange={(event) => {
                    setSlug(event.target.value);
                    setSavedMessage(null);
                  }}
                />
                {slugError && (
                  <p className="text-sm text-destructive">{t(slugError)}</p>
                )}
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSubmit} disabled={!canSave}>
                  {updateWorkspace.isPending
                    ? t("saving", "Saving...")
                    : t("saveChanges", "Save changes")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </main>
  );
}
