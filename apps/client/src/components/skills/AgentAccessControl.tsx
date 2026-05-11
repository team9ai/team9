import { useTranslation } from "react-i18next";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { SkillAgentAccess } from "@/types/skill";

interface AgentAccessControlProps {
  value: SkillAgentAccess;
  onChange: (next: SkillAgentAccess) => void;
  disabled?: boolean;
}

export function AgentAccessControl({
  value,
  onChange,
  disabled,
}: AgentAccessControlProps) {
  const { t } = useTranslation("skills");
  const currentLabel = t(`agentAccess.${value}.buttonTitle`, {
    defaultValue: t(`agentAccess.${value}.title`),
  });
  const sectionTitle = t("agentAccess.sectionTitle", {
    defaultValue: t("agentAccess.label"),
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`${t("agentAccess.label")}: ${currentLabel}`}
        >
          <ShieldCheck className="size-4" />
          <span className="hidden sm:inline">{t("agentAccess.label")}</span>
          <span className="text-muted-foreground">{currentLabel}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{sectionTitle}</DialogTitle>
        </DialogHeader>

        <fieldset className="space-y-2" disabled={disabled}>
          <RadioGroup
            value={value}
            onValueChange={(v) => onChange(v as SkillAgentAccess)}
          >
            {(["none", "read", "write"] as const).map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent/40"
              >
                <RadioGroupItem
                  value={opt}
                  id={`access-${opt}`}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <Label htmlFor={`access-${opt}`} className="font-medium">
                    {t(`agentAccess.${opt}.title`)}
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(`agentAccess.${opt}.help`)}
                  </p>
                </div>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}
