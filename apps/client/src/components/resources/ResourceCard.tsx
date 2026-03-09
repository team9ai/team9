import { useTranslation } from "react-i18next";
import {
  Monitor,
  Key,
  Wifi,
  WifiOff,
  AlertCircle,
  Settings,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  Resource,
  ApiResourceConfig,
  AgentComputerConfig,
  ResourceStatus,
} from "@/types/resource";

interface ResourceCardProps {
  resource: Resource;
  onClick: () => void;
}

const STATUS_COLORS: Record<ResourceStatus, string> = {
  online: "bg-green-500",
  offline: "bg-gray-400",
  error: "bg-red-500",
  configuring: "bg-yellow-500",
};

const STATUS_ICONS = {
  online: Wifi,
  offline: WifiOff,
  error: AlertCircle,
  configuring: Settings,
};

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function ResourceCard({ resource, onClick }: ResourceCardProps) {
  const { t } = useTranslation("resources");
  const StatusIcon = STATUS_ICONS[resource.status] ?? WifiOff;
  const authCount = resource.authorizations?.length ?? 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border border-border bg-card p-4 space-y-2",
        "hover:border-primary/30 hover:bg-accent/50 transition-colors cursor-pointer",
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "w-2 h-2 rounded-full shrink-0",
            STATUS_COLORS[resource.status],
          )}
        />
        {resource.type === "agent_computer" ? (
          <Monitor size={16} className="text-muted-foreground shrink-0" />
        ) : (
          <Key size={16} className="text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium truncate flex-1">
          {resource.name}
        </span>
        <Badge variant="outline" className="text-xs shrink-0">
          {t(`type.${resource.type}`)}
        </Badge>
      </div>

      {resource.type === "agent_computer" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusIcon size={12} />
          <span>{t(`status.${resource.status}`)}</span>
          {"connectionType" in resource.config && (
            <>
              <span>·</span>
              <span>
                {t(
                  `connectionType.${(resource.config as AgentComputerConfig).connectionType}`,
                )}
              </span>
            </>
          )}
        </div>
      )}

      {resource.type === "api" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{(resource.config as ApiResourceConfig).provider}</span>
          <span>·</span>
          <code className="text-xs">
            {maskApiKey((resource.config as ApiResourceConfig).apiKey)}
          </code>
        </div>
      )}

      {authCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {t("detail.authCount", { count: authCount })}
        </div>
      )}
    </button>
  );
}
