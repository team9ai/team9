import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGrants, useRevokeGrant } from "@/hooks/usePermissions";
import { GrantEditor } from "./GrantEditor";
import type { PermissionGrant } from "@/services/api/permissions";

/** Produces a short human-readable summary of the scope metadata. */
function scopeSummary(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return "—";
  return entries
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: ${(v as unknown[]).join(", ")}`;
      return `${k}: ${String(v)}`;
    })
    .join("; ");
}

function formatExpires(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  return new Date(expiresAt).toLocaleDateString();
}

interface GrantRowProps {
  grant: PermissionGrant;
  onRevoke: (id: string) => void;
  revoking: boolean;
  revokeLabel: string;
}

function GrantRow({ grant, onRevoke, revoking, revokeLabel }: GrantRowProps) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-4 text-sm font-mono">{grant.permissionKey}</td>
      <td className="py-2 pr-4 text-sm text-muted-foreground max-w-[200px] truncate">
        {scopeSummary(grant.scopeMetadata)}
      </td>
      <td className="py-2 pr-4 text-sm text-muted-foreground whitespace-nowrap">
        {formatExpires(grant.expiresAt)}
      </td>
      <td className="py-2 text-right">
        <Button
          variant="ghost"
          size="sm"
          aria-label={revokeLabel}
          disabled={revoking}
          onClick={() => onRevoke(grant.id)}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={14} className="mr-1" />
          {revokeLabel}
        </Button>
      </td>
    </tr>
  );
}

export interface GrantListProps {
  subjectKind: PermissionGrant["subjectKind"];
  subjectId: string;
}

export function GrantList({ subjectKind, subjectId }: GrantListProps) {
  const { t } = useTranslation("permissions");
  const [editorOpen, setEditorOpen] = useState(false);

  const { data: grants = [], isLoading } = useGrants({
    subjectKind,
    subjectId,
  });
  const revokeGrant = useRevokeGrant();

  const handleRevoke = (grantId: string) => {
    if (!window.confirm(t("grants.revokeConfirm"))) return;
    revokeGrant.mutate(grantId);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("grants.title")}</h3>
        <Button size="sm" variant="outline" onClick={() => setEditorOpen(true)}>
          <Plus size={14} className="mr-1" />
          {t("grants.createButton")}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("grants.empty", { subject: subjectKind })}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                  {t("grants.permissionKey")}
                </th>
                <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                  {t("grants.scope")}
                </th>
                <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                  {t("grants.expires")}
                </th>
                <th className="pb-2 text-right text-xs font-medium text-muted-foreground">
                  {/* actions */}
                </th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <GrantRow
                  key={grant.id}
                  grant={grant}
                  onRevoke={handleRevoke}
                  revoking={revokeGrant.isPending}
                  revokeLabel={t("grants.revoke")}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GrantEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        subjectKind={subjectKind}
        subjectId={subjectId}
      />
    </div>
  );
}
