import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { MultiUserPicker } from "@/components/ai-staff/MultiUserPicker";
import type {
  DmOutboundPolicy,
  DmOutboundPolicyMode,
} from "@/types/bot-dm-policy";
import type { UserOption } from "@/components/ai-staff/MultiUserPicker";

const DM_POLICY_OPTIONS: {
  value: DmOutboundPolicyMode;
  label: string;
  description: string;
}[] = [
  {
    value: "owner-only",
    label: "Owner only",
    description: "Only the bot owner receives outbound DMs from this staff.",
  },
  {
    value: "same-tenant",
    label: "Same workspace",
    description: "Any member of this workspace can receive outbound DMs.",
  },
  {
    value: "whitelist",
    label: "Whitelist",
    description: "Only the users you specify can receive outbound DMs.",
  },
  {
    value: "anyone",
    label: "Anyone in this tenant",
    description:
      "Any user in this workspace, including members the assistant has never interacted with.",
  },
];

export interface DmOutboundPolicyBlockProps {
  value: DmOutboundPolicy;
  onChange: (next: DmOutboundPolicy) => void;
  /** When true, the owner-only option is hidden (useful for common/shared staff) */
  hideOwnerOnly?: boolean;
  disabled?: boolean;
  /** Selected whitelist users; required when mode = "whitelist" */
  whitelistUsers?: UserOption[];
  onWhitelistUsersChange?: (users: UserOption[]) => void;
}

export function DmOutboundPolicyBlock({
  value,
  onChange,
  hideOwnerOnly = false,
  disabled = false,
  whitelistUsers = [],
  onWhitelistUsersChange,
}: DmOutboundPolicyBlockProps) {
  const visibleOptions = hideOwnerOnly
    ? DM_POLICY_OPTIONS.filter((o) => o.value !== "owner-only")
    : DM_POLICY_OPTIONS;

  const handleModeChange = (mode: string) => {
    const next = mode as DmOutboundPolicyMode;
    // Switching away from whitelist clears the list
    if (next !== "whitelist") {
      onWhitelistUsersChange?.([]);
    }
    onChange({ mode: next });
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">Outbound DM</h4>

      <RadioGroup
        value={value.mode}
        onValueChange={handleModeChange}
        disabled={disabled}
        className="space-y-2"
      >
        {visibleOptions.map((option) => (
          <div key={option.value} className="flex items-start gap-3">
            <RadioGroupItem
              value={option.value}
              id={`dm-policy-${option.value}`}
              className="mt-0.5"
            />
            <Label
              htmlFor={`dm-policy-${option.value}`}
              className="cursor-pointer space-y-0.5"
            >
              <span className="block text-sm font-medium leading-none">
                {option.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {option.description}
              </span>
            </Label>
          </div>
        ))}
      </RadioGroup>

      {value.mode === "whitelist" && (
        <div className="ml-7 mt-2">
          <MultiUserPicker
            value={whitelistUsers}
            onChange={(users) => {
              onWhitelistUsersChange?.(users);
              onChange({
                mode: "whitelist",
                userIds: users.map((u) => u.userId),
              });
            }}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
