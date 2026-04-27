import { useTranslation } from "react-i18next";
import { Bot, Briefcase, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function PermissionsTab() {
  const { t } = useTranslation("ahand");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("devicesTabs.permissionsDescription")}
      </p>
      <ApprovalMethodCard />
      <DefaultPolicyCard />
      <AuthorizedAgentsCard />
    </div>
  );
}

type OptionMeta = {
  key: string;
  todo?: boolean;
};

// Cross-product of `groupKey × option.key` doesn't enumerate cleanly in
// the i18next typed surface (each group only ships keys for its own
// options), so the template-literal call below uses a runtime-only key.
// Cast through `as never` to opt out of TFunction overload checking
// for these dynamic translation keys — i18next resolves them fine at
// runtime, and the keys are exercised by the screenshot tests.
function OptionRow({
  option,
  groupKey,
  selected,
}: {
  option: OptionMeta;
  groupKey: string;
  selected: boolean;
}) {
  const { t } = useTranslation("ahand");
  const id = `${groupKey}-${option.key}`;

  return (
    <div
      className={cn(
        "flex items-start gap-3 py-3 first:pt-0 last:pb-0",
        option.todo && "opacity-60",
      )}
    >
      <RadioGroupItem
        value={option.key}
        id={id}
        disabled={option.todo}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <Label htmlFor={id} className="flex items-center gap-2 cursor-pointer">
          <span className="text-sm font-medium">
            {t(`permissions.${groupKey}.${option.key}.label` as never)}
          </span>
          {option.todo && (
            <Badge
              variant="outline"
              size="sm"
              className="h-5 shrink-0 rounded-md border-border/60 bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground"
            >
              {t("comingSoon")}
            </Badge>
          )}
          {selected && !option.todo && (
            <Badge
              variant="outline"
              size="sm"
              className="h-5 shrink-0 rounded-md border-muted bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground"
            >
              {t("permissions.default")}
            </Badge>
          )}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t(`permissions.${groupKey}.${option.key}.description` as never)}
        </p>
      </div>
    </div>
  );
}

const APPROVAL_OPTIONS: OptionMeta[] = [
  { key: "anyDevice" },
  { key: "thisDevice", todo: true },
];

function ApprovalMethodCard() {
  const { t } = useTranslation("ahand");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {t("permissions.approval.title")}
        </CardTitle>
        <CardDescription>
          {t("permissions.approval.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup value="anyDevice" className="divide-y">
          {APPROVAL_OPTIONS.map((option) => (
            <OptionRow
              key={option.key}
              option={option}
              groupKey="approval"
              selected={option.key === "anyDevice"}
            />
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

const POLICY_OPTIONS: OptionMeta[] = [
  { key: "always" },
  { key: "once" },
  { key: "perCommand", todo: true },
  { key: "onlyWhenAsked" },
];

function DefaultPolicyCard() {
  const { t } = useTranslation("ahand");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {t("permissions.policy.title")}
        </CardTitle>
        <CardDescription>{t("permissions.policy.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup value="onlyWhenAsked" className="divide-y">
          {POLICY_OPTIONS.map((option) => (
            <OptionRow
              key={option.key}
              option={option}
              groupKey="policy"
              selected={option.key === "onlyWhenAsked"}
            />
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

type AgentScopeKind = "workspace" | "agent" | "task";

type AuthorizedEntry = {
  id: string;
  kind: AgentScopeKind;
  primary: string;
  secondary: string;
  policy: string;
};

const AGENT_POLICIES = [
  { value: "always", todo: false },
  { value: "whenTalkingToMe", todo: false },
  { value: "partial", todo: true },
  { value: "onlyWhenAsked", todo: false },
] as const;

const MOCK_ENTRIES: AuthorizedEntry[] = [
  {
    id: "1",
    kind: "agent",
    primary: "Personal Staff",
    secondary: "winrey's Workspace",
    policy: "always",
  },
  {
    id: "2",
    kind: "agent",
    primary: "Idea Curator",
    secondary: "winrey's Workspace",
    policy: "whenTalkingToMe",
  },
  {
    id: "3",
    kind: "workspace",
    primary: "acme-team's Workspace",
    secondary: "",
    policy: "onlyWhenAsked",
  },
];

function AuthorizedAgentsCard() {
  const { t } = useTranslation("ahand");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">
            {t("permissions.agents.title")}
          </CardTitle>
          <Badge
            variant="outline"
            size="sm"
            className="h-5 shrink-0 rounded-md border-border/60 bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground"
          >
            {t("comingSoon")}
          </Badge>
        </div>
        <CardDescription>{t("permissions.agents.description")}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {MOCK_ENTRIES.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <ScopeIcon kind={entry.kind} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{entry.primary}</p>
                <Badge
                  variant="outline"
                  size="sm"
                  className="h-5 shrink-0 rounded-md border-muted bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground"
                >
                  {t(`permissions.scope.${entry.kind}` as const)}
                </Badge>
              </div>
              {entry.secondary && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {entry.secondary}
                </p>
              )}
            </div>
            <Select value={entry.policy} disabled>
              <SelectTrigger className="w-[180px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_POLICIES.map(({ value, todo }) => (
                  <SelectItem key={value} value={value} disabled={todo}>
                    <span className="flex items-center gap-2">
                      {t(`permissions.agentPolicy.${value}.label` as const)}
                      {todo && (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="h-4 shrink-0 rounded border-border/60 bg-background/80 px-1 text-[10px] font-medium text-muted-foreground"
                        >
                          TODO
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ScopeIcon({ kind }: { kind: AgentScopeKind }) {
  const baseClass =
    "h-8 w-8 rounded-md flex items-center justify-center shrink-0";
  if (kind === "workspace") {
    return (
      <div className={cn(baseClass, "bg-sky-50 text-sky-700")}>
        <Briefcase className="h-4 w-4" />
      </div>
    );
  }
  if (kind === "agent") {
    return (
      <div className={cn(baseClass, "bg-emerald-50 text-emerald-700")}>
        <Bot className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className={cn(baseClass, "bg-muted text-muted-foreground")}>
      <User className="h-4 w-4" />
    </div>
  );
}
