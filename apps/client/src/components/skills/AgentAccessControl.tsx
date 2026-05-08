import { useTranslation } from "react-i18next";
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
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{t("agentAccess.label")}</legend>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as SkillAgentAccess)}
      >
        {(["none", "read", "write"] as const).map((opt) => (
          <label
            key={opt}
            className="flex items-start gap-2 rounded border p-2 cursor-pointer"
          >
            <RadioGroupItem value={opt} id={`access-${opt}`} />
            <div>
              <Label htmlFor={`access-${opt}`} className="font-medium">
                {t(`agentAccess.${opt}.title`)}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(`agentAccess.${opt}.help`)}
              </p>
            </div>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
