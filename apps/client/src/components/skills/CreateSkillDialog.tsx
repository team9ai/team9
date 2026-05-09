import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSkill } from "@/hooks/useSkills";
import { getHttpErrorMessage } from "@/lib/http-error";
import type { SkillAgentAccess } from "@/types/skill";
import { AgentAccessControl } from "./AgentAccessControl";

interface CreateSkillDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateSkillDialog({ isOpen, onClose }: CreateSkillDialogProps) {
  const { t } = useTranslation("skills");
  const createMutation = useCreateSkill();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentAccess, setAgentAccess] = useState<SkillAgentAccess>("read");

  function handleClose() {
    setName("");
    setDescription("");
    setAgentAccess("read");
    createMutation.reset();
    onClose();
  }

  function handleCreate() {
    createMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        type: "general",
        agentAccess,
      },
      { onSuccess: handleClose },
    );
  }

  const canCreate = name.trim().length > 0 && !createMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("create.name")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("create.namePlaceholder")}
              maxLength={255}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("create.description")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("create.descriptionPlaceholder")}
              rows={3}
              className="resize-none"
            />
          </div>

          <AgentAccessControl value={agentAccess} onChange={setAgentAccess} />

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {getHttpErrorMessage(createMutation.error) ||
                t("create.creating")}
            </p>
          )}

          <div className="flex justify-end pt-2">
            <Button onClick={handleCreate} disabled={!canCreate}>
              {createMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              )}
              {t("create.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
