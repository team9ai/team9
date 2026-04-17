import { useTranslation } from "react-i18next";
import {
  Monitor,
  Key,
  Wifi,
  WifiOff,
  AlertCircle,
  Settings,
  Sparkles,
  Plug,
  Database,
  Globe,
  BookOpen,
  Terminal,
  Webhook,
  Mail,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  Resource,
  ResourceType,
  ApiResourceConfig,
  AgentComputerConfig,
  LlmResourceConfig,
  McpResourceConfig,
  DatabaseResourceConfig,
  BrowserResourceConfig,
  KnowledgeBaseResourceConfig,
  SandboxResourceConfig,
  WebhookResourceConfig,
  MailCalendarResourceConfig,
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

const TYPE_ICONS: Record<ResourceType, LucideIcon> = {
  agent_computer: Monitor,
  api: Key,
  llm: Sparkles,
  mcp: Plug,
  database: Database,
  browser: Globe,
  knowledge_base: BookOpen,
  sandbox: Terminal,
  webhook: Webhook,
  mail_calendar: Mail,
};

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function renderMeta(resource: Resource): React.ReactNode {
  switch (resource.type) {
    case "agent_computer": {
      const c = resource.config as AgentComputerConfig;
      return (
        <>
          <span className="uppercase">{c.connectionType}</span>
          {c.host && (
            <>
              <span>·</span>
              <span className="truncate">
                {c.host}
                {c.port ? `:${c.port}` : ""}
              </span>
            </>
          )}
        </>
      );
    }
    case "api": {
      const c = resource.config as ApiResourceConfig;
      return (
        <>
          <span>{c.provider}</span>
          <span>·</span>
          <code className="text-xs">{maskApiKey(c.apiKey)}</code>
        </>
      );
    }
    case "llm": {
      const c = resource.config as LlmResourceConfig;
      return (
        <>
          <span>{c.provider}</span>
          <span>·</span>
          <span className="truncate">{c.model}</span>
          {c.contextLength && (
            <>
              <span>·</span>
              <span>{(c.contextLength / 1000).toFixed(0)}k ctx</span>
            </>
          )}
        </>
      );
    }
    case "mcp": {
      const c = resource.config as McpResourceConfig;
      return (
        <>
          <span className="uppercase">{c.transport}</span>
          {typeof c.tools === "number" && (
            <>
              <span>·</span>
              <span>{c.tools} tools</span>
            </>
          )}
        </>
      );
    }
    case "database": {
      const c = resource.config as DatabaseResourceConfig;
      return (
        <>
          <span className="capitalize">{c.engine}</span>
          <span>·</span>
          <span className="truncate">
            {c.host}
            {c.port ? `:${c.port}` : ""}
          </span>
        </>
      );
    }
    case "browser": {
      const c = resource.config as BrowserResourceConfig;
      return (
        <>
          <span className="capitalize">{c.kind}</span>
          {c.version && (
            <>
              <span>·</span>
              <span>{c.version}</span>
            </>
          )}
        </>
      );
    }
    case "knowledge_base": {
      const c = resource.config as KnowledgeBaseResourceConfig;
      return (
        <>
          <span className="uppercase">{c.store}</span>
          {typeof c.docs === "number" && (
            <>
              <span>·</span>
              <span>{formatNumber(c.docs)} docs</span>
            </>
          )}
        </>
      );
    }
    case "sandbox": {
      const c = resource.config as SandboxResourceConfig;
      return (
        <>
          <span className="capitalize">{c.provider}</span>
          <span>·</span>
          <span className="capitalize">{c.runtime}</span>
        </>
      );
    }
    case "webhook": {
      const c = resource.config as WebhookResourceConfig;
      return (
        <>
          <Badge variant="secondary" className="px-1 py-0 h-4 text-[10px]">
            {c.method}
          </Badge>
          <span className="truncate">{c.url}</span>
        </>
      );
    }
    case "mail_calendar": {
      const c = resource.config as MailCalendarResourceConfig;
      return (
        <>
          <span className="capitalize">{c.service.replace(/_/g, " ")}</span>
          <span>·</span>
          <span className="truncate">{c.account}</span>
        </>
      );
    }
    default:
      return null;
  }
}

export function ResourceCard({ resource, onClick }: ResourceCardProps) {
  const { t } = useTranslation("resources");
  const StatusIcon = STATUS_ICONS[resource.status] ?? WifiOff;
  const TypeIcon = TYPE_ICONS[resource.type] ?? Key;
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
        <TypeIcon size={16} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate flex-1">
          {resource.name}
        </span>
        <Badge variant="outline" className="text-xs shrink-0">
          {t(`type.${resource.type}`)}
        </Badge>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
        <StatusIcon size={12} className="shrink-0" />
        <span className="shrink-0">{t(`status.${resource.status}`)}</span>
        <span>·</span>
        {renderMeta(resource)}
      </div>

      {authCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {t("detail.authCount", { count: authCount })}
        </div>
      )}
    </button>
  );
}
