import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  X,
  Loader2,
  Trash2,
  Monitor,
  Key,
  Clock,
  User,
  ListChecks,
  Pencil,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resourcesApi } from "@/services/api/resources";
import type {
  ApiResourceConfig,
  AgentComputerConfig,
  ResourceUsageLog,
  ResourceStatus,
  Resource,
} from "@/types/resource";

interface ResourceDetailPanelProps {
  resourceId: string;
  onClose: () => void;
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const STATUS_BADGE_VARIANT: Record<
  ResourceStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  online: "default",
  offline: "secondary",
  error: "destructive",
  configuring: "outline",
};

interface EditFormState {
  name: string;
  description: string;
  status: ResourceStatus;
  // agent_computer fields
  connectionType: "ahand" | "ssh" | "cloud";
  host: string;
  port: string;
  // api fields
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

function resourceToFormState(resource: Resource): EditFormState {
  const base = {
    name: resource.name,
    description: resource.description || "",
    status: resource.status,
  };
  if (resource.type === "agent_computer") {
    const config = resource.config as AgentComputerConfig;
    return {
      ...base,
      connectionType: config.connectionType,
      host: config.host || "",
      port: config.port?.toString() || "",
      provider: "",
      apiKey: "",
      baseUrl: "",
      model: "",
    };
  }
  const config = resource.config as ApiResourceConfig;
  return {
    ...base,
    connectionType: "ahand",
    host: "",
    port: "",
    provider: config.provider || "",
    apiKey: config.apiKey || "",
    baseUrl: config.baseUrl || "",
    model: config.model || "",
  };
}

export function ResourceDetailPanel({
  resourceId,
  onClose,
}: ResourceDetailPanelProps) {
  const { t } = useTranslation("resources");
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EditFormState | null>(null);

  const {
    data: resource,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["resource", resourceId],
    queryFn: () => resourcesApi.getById(resourceId),
  });

  const { data: usageLogs = [] } = useQuery({
    queryKey: ["resource-usage-logs", resourceId],
    queryFn: () => resourcesApi.getUsageLogs(resourceId, { limit: 20 }),
    enabled: !!resource,
  });

  // Reset edit mode when switching resources
  useEffect(() => {
    setIsEditing(false);
    setForm(null);
  }, [resourceId]);

  const updateMutation = useMutation({
    mutationFn: (dto: Parameters<typeof resourcesApi.update>[1]) =>
      resourcesApi.update(resourceId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resource", resourceId] });
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      setIsEditing(false);
      setForm(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => resourcesApi.delete(resourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      onClose();
    },
  });

  function startEditing() {
    if (!resource) return;
    setForm(resourceToFormState(resource));
    setIsEditing(true);
    updateMutation.reset();
  }

  function cancelEditing() {
    setIsEditing(false);
    setForm(null);
    updateMutation.reset();
  }

  function handleSave() {
    if (!form || !resource) return;

    const dto: Record<string, unknown> = {};

    if (form.name.trim() !== resource.name) dto.name = form.name.trim();
    if ((form.description || null) !== (resource.description || null))
      dto.description = form.description.trim() || null;
    if (form.status !== resource.status) dto.status = form.status;

    if (resource.type === "agent_computer") {
      const oldConfig = resource.config as AgentComputerConfig;
      const newConfig: Record<string, unknown> = {
        connectionType: form.connectionType,
      };
      if (form.host) newConfig.host = form.host;
      if (form.port) newConfig.port = parseInt(form.port, 10);
      if (oldConfig.os) newConfig.os = oldConfig.os;
      if (oldConfig.arch) newConfig.arch = oldConfig.arch;
      if (JSON.stringify(newConfig) !== JSON.stringify(resource.config)) {
        dto.config = newConfig;
      }
    } else {
      const newConfig: Record<string, unknown> = {
        provider: form.provider || "custom",
        apiKey: form.apiKey,
      };
      if (form.baseUrl) newConfig.baseUrl = form.baseUrl;
      if (form.model) newConfig.model = form.model;
      if (JSON.stringify(newConfig) !== JSON.stringify(resource.config)) {
        dto.config = newConfig;
      }
    }

    if (Object.keys(dto).length === 0) {
      cancelEditing();
      return;
    }

    updateMutation.mutate(dto);
  }

  const canSave =
    form !== null &&
    form.name.trim().length > 0 &&
    (resource?.type !== "api" || form.apiKey.trim().length > 0) &&
    !updateMutation.isPending;

  return (
    <div className="border-l bg-background flex flex-col h-full w-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold truncate">{t("detail.title")}</h3>
        <div className="flex items-center gap-1">
          {resource && !isEditing && (
            <Button variant="ghost" size="icon-sm" onClick={startEditing}>
              <Pencil size={14} />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">
            {t("detail.loadError")}
          </p>
        </div>
      )}

      {resource && !isLoading && (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            {/* Basic info */}
            <div className="space-y-2">
              {/* Status & type badges — editable status in edit mode */}
              <div className="flex items-center gap-2 flex-wrap">
                {isEditing && form ? (
                  <Select
                    value={form.status}
                    onValueChange={(v) =>
                      setForm({ ...form, status: v as ResourceStatus })
                    }
                  >
                    <SelectTrigger className="h-7 w-auto text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        ["online", "offline", "error", "configuring"] as const
                      ).map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`status.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge
                    variant={STATUS_BADGE_VARIANT[resource.status]}
                    className="text-xs"
                  >
                    {t(`status.${resource.status}`)}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {t(`type.${resource.type}`)}
                </Badge>
              </div>

              {/* Name */}
              {isEditing && form ? (
                <div className="space-y-1">
                  <Label className="text-xs">{t("create.name")}</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    maxLength={255}
                  />
                </div>
              ) : (
                <h2 className="text-base font-semibold leading-tight">
                  {resource.name}
                </h2>
              )}

              {/* Description */}
              {isEditing && form ? (
                <div className="space-y-1">
                  <Label className="text-xs">{t("create.description")}</Label>
                  <Textarea
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    rows={2}
                  />
                </div>
              ) : (
                resource.description && (
                  <p className="text-sm text-muted-foreground">
                    {resource.description}
                  </p>
                )
              )}

              {/* Type-specific config */}
              {resource.type === "agent_computer" &&
                (isEditing && form ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">
                        {t("create.connectionType")}
                      </Label>
                      <Select
                        value={form.connectionType}
                        onValueChange={(v) =>
                          setForm({
                            ...form,
                            connectionType: v as "ahand" | "ssh" | "cloud",
                          })
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ahand">Ahand</SelectItem>
                          <SelectItem value="ssh">SSH</SelectItem>
                          <SelectItem value="cloud">Cloud</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">{t("create.host")}</Label>
                        <Input
                          value={form.host}
                          onChange={(e) =>
                            setForm({ ...form, host: e.target.value })
                          }
                          placeholder={t("create.hostPlaceholder")}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("create.port")}</Label>
                        <Input
                          value={form.port}
                          onChange={(e) =>
                            setForm({ ...form, port: e.target.value })
                          }
                          placeholder="22"
                          type="number"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center gap-2">
                      <Monitor size={12} />
                      <span>
                        {t(
                          `connectionType.${(resource.config as AgentComputerConfig).connectionType}`,
                        )}
                      </span>
                    </div>
                    {(resource.config as AgentComputerConfig).host && (
                      <div>
                        Host: {(resource.config as AgentComputerConfig).host}
                        {(resource.config as AgentComputerConfig).port &&
                          `:${(resource.config as AgentComputerConfig).port}`}
                      </div>
                    )}
                    {(resource.config as AgentComputerConfig).os && (
                      <div>
                        OS: {(resource.config as AgentComputerConfig).os}
                        {(resource.config as AgentComputerConfig).arch &&
                          ` (${(resource.config as AgentComputerConfig).arch})`}
                      </div>
                    )}
                    {resource.lastHeartbeatAt && (
                      <div className="flex items-center gap-1">
                        <Clock size={12} />
                        {t("detail.lastHeartbeat", {
                          time: new Date(
                            resource.lastHeartbeatAt,
                          ).toLocaleString(),
                        })}
                      </div>
                    )}
                  </div>
                ))}

              {resource.type === "api" &&
                (isEditing && form ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("create.provider")}</Label>
                      <Input
                        value={form.provider}
                        onChange={(e) =>
                          setForm({ ...form, provider: e.target.value })
                        }
                        placeholder={t("create.providerPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("create.apiKey")}</Label>
                      <Input
                        value={form.apiKey}
                        onChange={(e) =>
                          setForm({ ...form, apiKey: e.target.value })
                        }
                        placeholder={t("create.apiKeyPlaceholder")}
                        type="password"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("create.baseUrl")}</Label>
                      <Input
                        value={form.baseUrl}
                        onChange={(e) =>
                          setForm({ ...form, baseUrl: e.target.value })
                        }
                        placeholder={t("create.baseUrlPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("create.model")}</Label>
                      <Input
                        value={form.model}
                        onChange={(e) =>
                          setForm({ ...form, model: e.target.value })
                        }
                        placeholder={t("create.modelPlaceholder")}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center gap-2">
                      <Key size={12} />
                      <span>
                        {(resource.config as ApiResourceConfig).provider}
                      </span>
                    </div>
                    <div>
                      API Key:{" "}
                      <code>
                        {maskApiKey(
                          (resource.config as ApiResourceConfig).apiKey,
                        )}
                      </code>
                    </div>
                    {(resource.config as ApiResourceConfig).baseUrl && (
                      <div>
                        Base URL:{" "}
                        {(resource.config as ApiResourceConfig).baseUrl}
                      </div>
                    )}
                    {(resource.config as ApiResourceConfig).model && (
                      <div>
                        Model: {(resource.config as ApiResourceConfig).model}
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {/* Edit actions or Delete */}
            {isEditing ? (
              <div className="space-y-2">
                {updateMutation.isError && (
                  <p className="text-xs text-destructive">
                    {(updateMutation.error as Error)?.message ||
                      t("detail.loadError")}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleSave} disabled={!canSave}>
                    {updateMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    {t("edit.save")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelEditing}
                    disabled={updateMutation.isPending}
                  >
                    {t("edit.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm(t("detail.deleteConfirm"))) {
                    deleteMutation.mutate();
                  }
                }}
              >
                <Trash2 size={14} />
                {t("detail.delete")}
              </Button>
            )}

            <Separator />

            {/* Authorizations */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                {t("detail.authorizations")}
              </h4>
              {(!resource.authorizations ||
                resource.authorizations.length === 0) && (
                <p className="text-xs text-muted-foreground">
                  {t("detail.noAuthorizations")}
                </p>
              )}
              {resource.authorizations?.map((auth) => (
                <div
                  key={`${auth.granteeType}-${auth.granteeId}`}
                  className="flex items-center gap-2 text-xs p-2 rounded border border-border"
                >
                  {auth.granteeType === "user" ? (
                    <User size={12} className="text-muted-foreground" />
                  ) : (
                    <ListChecks size={12} className="text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">
                    {t(`detail.granteeType.${auth.granteeType}`)}:{" "}
                    {auth.granteeId.slice(0, 8)}...
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {t(`detail.permissionLevel.${auth.permissions.level}`)}
                  </Badge>
                </div>
              ))}
            </div>

            <Separator />

            {/* Usage logs */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">{t("detail.usageLogs")}</h4>
              {usageLogs.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("detail.noUsageLogs")}
                </p>
              )}
              {usageLogs.map((log: ResourceUsageLog) => (
                <div
                  key={log.id}
                  className="text-xs p-2 rounded border border-border space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      {t(`actions.${log.action}`, {
                        defaultValue: log.action,
                      })}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    {log.actorType}: {log.actorId.slice(0, 8)}...
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
