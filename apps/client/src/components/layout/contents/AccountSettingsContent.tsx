import { Camera, Loader2, Mail, RefreshCw, Save, User, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUser } from "@/hooks/useAuth";
import {
  useCancelEmailChange,
  usePendingEmailChange,
  useResendEmailChange,
  useStartEmailChange,
  useUpdateCurrentUser,
} from "@/hooks/useIMUsers";
import { fileApi } from "@/services/api/file";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const USERNAME_PATTERN = /^[a-z0-9_-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "U";
  }

  return parts
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getUsernameError(username: string, t: any) {
  const trimmed = username.trim();

  if (trimmed.length === 0) {
    return t("profileCard.usernameRequired", "Username is required");
  }

  if (
    trimmed.length < 3 ||
    trimmed.length > 30 ||
    !USERNAME_PATTERN.test(trimmed)
  ) {
    return t(
      "profileCard.usernameInvalid",
      "Username can only contain lowercase letters, numbers, underscores, and hyphens",
    );
  }

  return null;
}

function getAvatarError(file: File, t: any) {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    return t(
      "profileCard.avatarInvalidType",
      "Avatar must be a JPEG, PNG, or WebP image",
    );
  }

  if (file.size > MAX_AVATAR_SIZE) {
    return t("profileCard.avatarTooLarge", "Avatar must be 5 MB or smaller");
  }

  return null;
}

function isEmailValid(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

function getApiErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "data" in error.response &&
    error.response.data &&
    typeof error.response.data === "object" &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
  ) {
    return error.response.data.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "";
}

function getProfileSaveError(error: unknown, t: any): string {
  const message = getApiErrorMessage(error);

  if (message === "Username is already taken") {
    return t("profileCard.usernameTaken", "That username is already taken");
  }

  if (
    message === "Avatar URL must reference your own public Team9 upload" ||
    message === "Avatar URL must use the configured Team9 file host" ||
    message ===
      "Avatar URL must use a Team9 public file URL or a trusted avatar provider"
  ) {
    return t(
      "profileCard.avatarRejected",
      "That avatar upload could not be saved. Please choose a new file and try again.",
    );
  }

  return t(
    "profileCard.updateFailed",
    "We could not update your profile right now.",
  );
}

function getEmailChangeError(error: unknown, t: any): string {
  const message = getApiErrorMessage(error);

  if (message === "Email already in use") {
    return t("emailCard.emailInUse", "That email is already in use");
  }

  return t(
    "emailCard.requestFailed",
    "We could not start the email change right now.",
  );
}

export function AccountSettingsContent() {
  const { t } = useTranslation("settings");
  const { data: currentUser, isLoading } = useCurrentUser();
  const { data: pendingEmailData, isLoading: isPendingEmailLoading } =
    usePendingEmailChange();
  const { mutateAsync: updateCurrentUser } = useUpdateCurrentUser();
  const { mutateAsync: startEmailChange } = useStartEmailChange();
  const { mutateAsync: resendEmailChange } = useResendEmailChange();
  const { mutateAsync: cancelEmailChange } = useCancelEmailChange();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSubmittingEmailChange, setIsSubmittingEmailChange] = useState(false);
  const [isSubmittingResend, setIsSubmittingResend] = useState(false);
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false);

  const pendingEmailChange = pendingEmailData?.pendingEmailChange ?? null;

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    setDisplayName(currentUser.displayName ?? "");
    setUsername(currentUser.username ?? "");
    setSelectedAvatar(null);
    setAvatarPreviewUrl(null);
    setAvatarError(null);
    setSaveError(null);
  }, [currentUser?.id, currentUser?.updatedAt]);

  useEffect(() => {
    if (!selectedAvatar) {
      setAvatarPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedAvatar);
    setAvatarPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedAvatar]);

  const initialDisplayName = currentUser?.displayName ?? "";
  const initialUsername = currentUser?.username ?? "";
  const trimmedDisplayName = displayName.trim();
  const trimmedUsername = username.trim();

  const usernameError = useMemo(
    () => getUsernameError(username, t),
    [t, username],
  );

  const isProfileDirty =
    trimmedDisplayName !== initialDisplayName ||
    trimmedUsername !== initialUsername ||
    selectedAvatar !== null;

  const isProfileValid = !usernameError && !avatarError;

  const handleAvatarBrowse = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const error = getAvatarError(file, t);
    if (error) {
      setAvatarError(error);
      setSelectedAvatar(null);
      return;
    }

    setAvatarError(null);
    setSaveError(null);
    setSelectedAvatar(file);
  };

  const handleProfileSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentUser || !isProfileDirty || !isProfileValid || isSavingProfile) {
      return;
    }

    try {
      setIsSavingProfile(true);
      setSaveError(null);

      let avatarUrl: string | undefined;

      if (selectedAvatar) {
        const presigned = await fileApi.createPresignedUpload({
          filename: selectedAvatar.name,
          contentType: selectedAvatar.type,
          fileSize: selectedAvatar.size,
          visibility: "public",
        });

        await fileApi.uploadToS3(
          presigned.url,
          selectedAvatar,
          presigned.fields,
        );

        const confirmedUpload = await fileApi.confirmUpload({
          key: presigned.key,
          fileName: selectedAvatar.name,
          visibility: "public",
        });

        avatarUrl = fileApi.getStablePublicFileUrl(confirmedUpload.id);
      }

      const payload: {
        username?: string;
        displayName?: string;
        avatarUrl?: string;
      } = {};

      if (trimmedUsername !== initialUsername) {
        payload.username = trimmedUsername;
      }

      if (trimmedDisplayName !== initialDisplayName) {
        payload.displayName = trimmedDisplayName;
      }

      if (avatarUrl) {
        payload.avatarUrl = avatarUrl;
      }

      const updatedUser = await updateCurrentUser(payload);

      setDisplayName(updatedUser.displayName ?? "");
      setUsername(updatedUser.username ?? "");
      setSelectedAvatar(null);
      setAvatarPreviewUrl(null);
    } catch (error) {
      setSaveError(getProfileSaveError(error, t));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleStartEmailChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedEmail = newEmail.trim();
    if (!isEmailValid(normalizedEmail)) {
      setEmailError(
        t(
          "emailCard.invalidEmail",
          "Enter a valid email address before continuing.",
        ),
      );
      return;
    }

    try {
      setIsSubmittingEmailChange(true);
      setEmailError(null);
      await startEmailChange({ newEmail: normalizedEmail });
      setNewEmail("");
    } catch (error) {
      setEmailError(getEmailChangeError(error, t));
    } finally {
      setIsSubmittingEmailChange(false);
    }
  };

  const handleResendEmailChange = async () => {
    try {
      setIsSubmittingResend(true);
      await resendEmailChange();
    } finally {
      setIsSubmittingResend(false);
    }
  };

  const handleCancelEmailChange = async () => {
    try {
      setIsSubmittingCancel(true);
      await cancelEmailChange();
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  const currentAvatarUrl =
    avatarPreviewUrl ?? currentUser?.avatarUrl ?? undefined;
  const avatarLabel = currentUser
    ? currentUser.displayName || currentUser.username
    : t("profileCard.avatar", "Avatar");

  if (isLoading) {
    return (
      <main className="h-full flex flex-col overflow-hidden bg-background">
        <header className="h-14 bg-background flex items-center px-4">
          <div className="flex items-center gap-2">
            <User size={18} className="text-primary" />
            <h2 className="font-semibold text-lg text-foreground">
              {t("profilePage.title", "Profile")}
            </h2>
          </div>
        </header>
        <Separator />
        <div className="flex-1 min-h-0 bg-secondary/50 p-4">
          <Card className="p-6 text-sm text-muted-foreground">
            {t("common:loading", "Loading...")}
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full flex flex-col overflow-hidden bg-background">
      <header className="h-14 bg-background flex items-center gap-2 px-4">
        <User size={18} className="text-primary" />
        <div className="min-w-0">
          <h2 className="font-semibold text-lg text-foreground">
            {t("profilePage.title", "Profile")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(
              "profilePage.description",
              "Update your profile details and sign-in email.",
            )}
          </p>
        </div>
      </header>

      <Separator />

      <ScrollArea className="flex-1 min-h-0 bg-secondary/50">
        <div className="p-4">
          <div className="space-y-6">
            <form onSubmit={handleProfileSave}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t("profileCard.title", "Profile details")}
                  </CardTitle>
                  <CardDescription>
                    {t(
                      "profileCard.description",
                      "Update your avatar, display name, and username.",
                    )}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <Avatar className="size-20 shrink-0">
                      {currentAvatarUrl && (
                        <AvatarImage src={currentAvatarUrl} alt={avatarLabel} />
                      )}
                      <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                        {getInitials(avatarLabel)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleAvatarBrowse}
                        >
                          <Camera className="mr-2 size-4" />
                          {t("profileCard.changeAvatar", "Change avatar")}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {t(
                            "profileCard.avatarHint",
                            "JPEG, PNG, or WebP. Max 5 MB.",
                          )}
                        </span>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleAvatarChange}
                      />

                      {selectedAvatar && (
                        <div className="text-xs text-muted-foreground">
                          {selectedAvatar.name}
                        </div>
                      )}

                      {avatarError && (
                        <p className="text-sm text-destructive">
                          {avatarError}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="display-name">
                        {t("profileCard.displayName", "Display name")}
                      </Label>
                      <Input
                        id="display-name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder={t(
                          "profileCard.displayNamePlaceholder",
                          "Your display name",
                        )}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="username">
                        {t("profileCard.username", "Username")}
                      </Label>
                      <Input
                        id="username"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder={t(
                          "profileCard.usernamePlaceholder",
                          "your_username",
                        )}
                        aria-invalid={!!usernameError}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "profileCard.usernameHelp",
                          "3-30 characters. Lowercase letters, numbers, underscores, and hyphens only.",
                        )}
                      </p>
                      {usernameError && (
                        <p className="text-sm text-destructive">
                          {usernameError}
                        </p>
                      )}
                    </div>
                  </div>

                  {saveError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {saveError}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3">
                    <Button
                      type="submit"
                      disabled={
                        !isProfileDirty || !isProfileValid || isSavingProfile
                      }
                    >
                      {isSavingProfile ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 size-4" />
                      )}
                      {isSavingProfile
                        ? t("profileCard.saving", "Saving...")
                        : t("profileCard.save", "Save changes")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </form>

            <form onSubmit={handleStartEmailChange}>
              <Card>
                <CardHeader>
                  <CardTitle>{t("emailCard.title", "Login email")}</CardTitle>
                  <CardDescription>
                    {t(
                      "emailCard.description",
                      "Manage the email address you use to sign in.",
                    )}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">
                      {t("emailCard.currentEmail", "Current email")}
                    </span>
                    <span className="font-medium">
                      {currentUser?.email ?? "—"}
                    </span>
                  </div>

                  {pendingEmailChange ? (
                    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                      <div className="flex items-start gap-3">
                        <Mail className="mt-0.5 size-4 text-primary" />
                        <div className="space-y-1">
                          <p className="font-medium">
                            {t(
                              "emailCard.pending",
                              "Pending email change to {{email}}",
                              { email: pendingEmailChange.newEmail },
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {t(
                              "emailCard.pendingDescription",
                              "We sent a confirmation link to the new address.",
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleResendEmailChange}
                          disabled={isSubmittingResend}
                        >
                          <RefreshCw className="mr-2 size-4" />
                          {t(
                            "emailCard.resendConfirmation",
                            "Resend confirmation",
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={handleCancelEmailChange}
                          disabled={isSubmittingCancel}
                        >
                          <X className="mr-2 size-4" />
                          {t("emailCard.cancelRequest", "Cancel request")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <div className="space-y-2">
                        <Label htmlFor="new-email">
                          {t("emailCard.newEmail", "New email")}
                        </Label>
                        <Input
                          id="new-email"
                          type="email"
                          value={newEmail}
                          onChange={(event) => setNewEmail(event.target.value)}
                          placeholder={t(
                            "emailCard.newEmailPlaceholder",
                            "name@example.com",
                          )}
                        />
                        {emailError && (
                          <p className="text-sm text-destructive">
                            {emailError}
                          </p>
                        )}
                      </div>

                      <Button
                        type="submit"
                        disabled={
                          isSubmittingEmailChange || !isEmailValid(newEmail)
                        }
                      >
                        {isSubmittingEmailChange ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Mail className="mr-2 size-4" />
                        )}
                        {t("emailCard.requestChange", "Request change")}
                      </Button>
                    </div>
                  )}

                  {isPendingEmailLoading && (
                    <p className="text-xs text-muted-foreground">
                      {t("common:loading", "Loading...")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </form>
          </div>
        </div>
      </ScrollArea>
    </main>
  );
}
