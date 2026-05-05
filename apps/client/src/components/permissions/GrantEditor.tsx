import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScopeEditor } from "./ScopeEditor";
import { useCreateGrant } from "@/hooks/usePermissions";
import type { PermissionGrant } from "@/services/api/permissions";

const PERMISSION_KEYS = [
  "messages:send",
  "messages:read",
  "tools:invoke",
  "wiki:read",
  "wiki:write",
  "routine:trigger",
  "files:read",
  "files:write",
] as const;

interface GrantEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectKind: PermissionGrant["subjectKind"];
  subjectId: string;
}

export function GrantEditor({
  open,
  onOpenChange,
  subjectKind,
  subjectId,
}: GrantEditorProps) {
  const { t } = useTranslation("permissions");
  const createGrant = useCreateGrant();

  const [permissionKey, setPermissionKey] = useState<string>(
    PERMISSION_KEYS[0],
  );
  const [scopeMetadata, setScopeMetadata] = useState<Record<string, unknown>>(
    {},
  );
  const [expiresAt, setExpiresAt] = useState<string>("");

  const handleSave = async () => {
    const isoExpiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
    await createGrant.mutateAsync({
      subjectKind,
      subjectId,
      permissionKey,
      scopeMetadata,
      expiresAt: isoExpiresAt,
    });
    onOpenChange(false);
    // Reset form
    setPermissionKey(PERMISSION_KEYS[0]);
    setScopeMetadata({});
    setExpiresAt("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("grants.createButton")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Permission key picker */}
          <div className="space-y-1.5">
            <Label htmlFor="grant-permission-key">
              {t("grants.permissionKey")}
            </Label>
            <Select
              value={permissionKey}
              onValueChange={(v) => {
                setPermissionKey(v);
                setScopeMetadata({});
              }}
            >
              <SelectTrigger id="grant-permission-key">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Scope editor */}
          <div className="space-y-1.5">
            <Label>{t("remember.scopeLabel")}</Label>
            <ScopeEditor
              key={permissionKey}
              permissionKey={permissionKey}
              value={scopeMetadata}
              onChange={setScopeMetadata}
            />
          </div>

          {/* Expires at */}
          <div className="space-y-1.5">
            <Label htmlFor="grant-expires-at">
              {t("remember.expiresLabel")}
            </Label>
            <Input
              id="grant-expires-at"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createGrant.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={createGrant.isPending}
          >
            {t("remember.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
