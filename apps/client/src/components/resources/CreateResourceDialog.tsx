import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resourcesApi } from "@/services/api/resources";
import type { ResourceType } from "@/types/resource";

interface CreateResourceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

export function CreateResourceDialog({
  isOpen,
  onClose,
  onCreated,
}: CreateResourceDialogProps) {
  const { t } = useTranslation("resources");
  const queryClient = useQueryClient();

  const [type, setType] = useState<ResourceType>("agent_computer");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Agent Computer fields
  const [connectionType, setConnectionType] = useState<
    "ahand" | "ssh" | "cloud"
  >("ahand");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");

  // API fields
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  const createMutation = useMutation({
    mutationFn: resourcesApi.create,
    onSuccess: (resource) => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      onCreated?.(resource.id);
      handleClose();
    },
  });

  function resetForm() {
    setType("agent_computer");
    setName("");
    setDescription("");
    setConnectionType("ahand");
    setHost("");
    setPort("");
    setProvider("");
    setApiKey("");
    setBaseUrl("");
    setModel("");
  }

  function handleClose() {
    resetForm();
    createMutation.reset();
    onClose();
  }

  function handleSubmit() {
    if (!name.trim()) return;

    const config =
      type === "agent_computer"
        ? {
            connectionType,
            ...(host && { host }),
            ...(port && { port: parseInt(port, 10) }),
          }
        : {
            provider: provider || "custom",
            apiKey,
            ...(baseUrl && { baseUrl }),
            ...(model && { model }),
          };

    createMutation.mutate({
      type,
      name: name.trim(),
      description: description.trim() || undefined,
      config,
    });
  }

  const canSubmit =
    name.trim().length > 0 &&
    (type !== "api" || apiKey.trim().length > 0) &&
    !createMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Type selector */}
          <div className="space-y-1.5">
            <Label>{t("create.selectType")}</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as ResourceType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent_computer">
                  {t("type.agent_computer")}
                </SelectItem>
                <SelectItem value="api">{t("type.api")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label>{t("create.name")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("create.namePlaceholder")}
              maxLength={255}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>{t("create.description")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("create.descriptionPlaceholder")}
              rows={2}
            />
          </div>

          {/* Agent Computer config */}
          {type === "agent_computer" && (
            <>
              <div className="space-y-1.5">
                <Label>{t("create.connectionType")}</Label>
                <Select
                  value={connectionType}
                  onValueChange={(v) =>
                    setConnectionType(v as "ahand" | "ssh" | "cloud")
                  }
                >
                  <SelectTrigger>
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
                <div className="col-span-2 space-y-1.5">
                  <Label>{t("create.host")}</Label>
                  <Input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder={t("create.hostPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("create.port")}</Label>
                  <Input
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="22"
                    type="number"
                  />
                </div>
              </div>
            </>
          )}

          {/* API config */}
          {type === "api" && (
            <>
              <div className="space-y-1.5">
                <Label>{t("create.provider")}</Label>
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder={t("create.providerPlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("create.apiKey")}</Label>
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t("create.apiKeyPlaceholder")}
                  type="password"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("create.baseUrl")}</Label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={t("create.baseUrlPlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("create.model")}</Label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t("create.modelPlaceholder")}
                />
              </div>
            </>
          )}

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {(createMutation.error as Error)?.message ||
                t("detail.loadError")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            {t("create.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {createMutation.isPending && (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            )}
            {t("create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
