import { Loader2, Clock, User, Bot } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useDocumentVersions } from "@/hooks/useDocuments";
import type { DocumentIdentity, VersionResponse } from "@/types/document";

interface VersionHistoryProps {
  documentId: string;
  currentVersionIndex?: number;
  onSelectVersion?: (versionIndex: number) => void;
}

function formatIdentity(identity: DocumentIdentity): string {
  if (identity.type === "bot") return "Bot";
  if (identity.type === "workspace") return "Workspace";
  return "User";
}

function IdentityIcon({ identity }: { identity: DocumentIdentity }) {
  if (identity.type === "bot") {
    return <Bot size={12} className="text-primary" />;
  }
  return <User size={12} className="text-muted-foreground" />;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString();
}

function VersionItem({
  version,
  isActive,
  onClick,
}: {
  version: VersionResponse;
  isActive: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 border-b border-border last:border-0 hover:bg-accent/50 transition-colors",
        isActive && "bg-accent",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          v{version.versionIndex}
        </span>
        <div className="flex items-center gap-1">
          <IdentityIcon identity={version.updatedBy} />
          <span className="text-xs text-muted-foreground">
            {formatIdentity(version.updatedBy)}
          </span>
        </div>
      </div>
      {version.summary && (
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {version.summary}
        </p>
      )}
      <div className="flex items-center gap-1 mt-1">
        <Clock size={10} className="text-muted-foreground/60" />
        <span className="text-[10px] text-muted-foreground/60">
          {formatDate(version.createdAt)}
        </span>
      </div>
    </button>
  );
}

export function VersionHistory({
  documentId,
  currentVersionIndex,
  onSelectVersion,
}: VersionHistoryProps) {
  const { data: versions, isLoading } = useDocumentVersions(documentId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!versions?.length) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No versions yet
      </p>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        {versions.map((version) => (
          <VersionItem
            key={version.id}
            version={version}
            isActive={version.versionIndex === currentVersionIndex}
            onClick={() => onSelectVersion?.(version.versionIndex)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
