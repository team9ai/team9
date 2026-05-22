import type { CompositionEventHandler, KeyboardEventHandler } from "react";
import {
  type LucideIcon,
  ArrowUp,
  Brain,
  ChevronDown,
  ChevronRight,
  Clock,
  Crown,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Upload,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AgentTypeBadge } from "@/components/ui/agent-type-badge";
import { Badge } from "@/components/ui/badge";
import { StaffModelProviderLogo } from "@/components/ai-staff/StaffModelProviderLogo";
import { useChannelsByType } from "@/hooks/useChannels";
import { useCreateTopicSession } from "@/hooks/useTopicSessions";
import { useFileUpload, type UploadingFile } from "@/hooks/useFileUpload";
import { tasksApi } from "@/services/api/tasks";
import { AttachmentPreview } from "@/components/channel/editor/AttachmentPreview";
import {
  type DashboardAgent,
  type DashboardAgentModel,
  useDashboardAgents,
} from "@/hooks/useDashboardAgents";
import { useSkills } from "@/hooks/useSkills";
import {
  useWorkspaceBillingOverview,
  useWorkspaceBillingSummary,
} from "@/hooks/useWorkspaceBilling";
import { getHttpErrorMessage, getHttpErrorStatus } from "@/lib/http-error";
import { SHOW_COMPOSER_MODEL_CONTROL } from "@/lib/composer-flags";
import {
  COMMON_STAFF_MODELS,
  DEFAULT_STAFF_MODEL,
  formatStaffModelDisplayLabel,
  type StaffModelFamily,
} from "@/lib/common-staff-models";
import {
  DEFAULT_DEEP_RESEARCH_CONFIG,
  buildDeepResearchRequestMetadata,
  type DeepResearchComposerConfig,
} from "@/lib/deep-research";
import {
  getBaseModelProductKey,
  getBaseModelProductKeyFromBotIdentity,
} from "@/lib/base-model-agent";
import type { WorkspaceBillingAccount } from "@/types/workspace";
import type { AttachmentDto } from "@/types/im";
import type { Skill } from "@/types/skill";
import {
  HOME_ENTRY_PATH,
  TASK_ENTRY_PATH,
  useSelectedWorkspaceId,
} from "@/stores";
import { cn } from "@/lib/utils";

const CONVERSATION_DASHBOARD_ACTION_CHIPS: ReadonlyArray<{
  key: ParseKeys<["navigation", "message"]>;
  templateKey?: ParseKeys<["navigation", "message"]>;
  icon: typeof Search;
  className: string;
  mode?: "deep-research";
}> = [
  {
    key: "dashboardActionDeepResearch",
    icon: Search,
    className: "",
    mode: "deep-research",
  },
  {
    key: "dashboardActionVideoGeneration",
    templateKey: "dashboardVideoGenerationTemplate",
    icon: Video,
    className: "",
  },
];

const SHOW_TASK_AGENT_SUGGESTIONS = false;
const EMPTY_SKILLS: Skill[] = [];

type DashboardMode = "conversation" | "task";

type DashboardTaskTriggerMode = "immediate" | "scheduled" | "create_only";

const TASK_TITLE_MAX_LENGTH = 80;

function pickDefaultAgent(agents: DashboardAgent[]): DashboardAgent | null {
  return (
    agents.find((agent) => agent.applicationId === "personal-staff") ??
    agents[0] ??
    null
  );
}

const FIXED_BASE_MODEL_LABELS = {
  claude: "Claude Sonnet 4.6",
  chatgpt: "GPT-5.4 Mini",
  gemini: "Gemini 3.5 Flash",
} as const;

function getAgentModelLabel(
  agent: DashboardAgent | null,
  model: DashboardAgentModel | null,
  fallbackLabel: string,
) {
  if (!agent) return fallbackLabel;

  if (model) {
    const matchedModel = COMMON_STAFF_MODELS.find(
      (candidate) =>
        candidate.provider === model.provider && candidate.id === model.id,
    );

    return matchedModel?.label ?? model.id;
  }

  if (agent.canSwitchModel && agent.agentModelFamily === null) {
    return DEFAULT_STAFF_MODEL.label;
  }

  const productKey =
    getBaseModelProductKey(agent.managedAgentId) ??
    getBaseModelProductKeyFromBotIdentity({
      isBot: true,
      name: agent.label,
      username: agent.username,
    });

  if (productKey) {
    return FIXED_BASE_MODEL_LABELS[productKey];
  }

  if (agent.canSwitchModel) {
    return DEFAULT_STAFF_MODEL.label;
  }

  return fallbackLabel;
}

function DashboardModelControl({
  agent,
  model,
  fallbackLabel,
  onSelectModel,
}: {
  agent: DashboardAgent | null;
  model: DashboardAgentModel | null;
  fallbackLabel: string;
  onSelectModel: (model: DashboardAgentModel) => void;
}) {
  const currentLabel = getAgentModelLabel(agent, model, fallbackLabel);
  const displayCurrentLabel = formatStaffModelDisplayLabel(currentLabel);
  const currentModelLogoIdentity = model
    ? { ...model, label: currentLabel }
    : { label: currentLabel };
  const currentValue = model ? `${model.provider}::${model.id}` : undefined;
  const agentModelFamily: StaffModelFamily | null =
    agent?.agentModelFamily ?? null;
  const availableModels = agentModelFamily
    ? COMMON_STAFF_MODELS.filter((m) => m.family === agentModelFamily)
    : COMMON_STAFF_MODELS;

  if (!agent?.canSwitchModel) {
    return (
      <div className="dashboard-composer-model inline-flex h-[2.05rem] items-center gap-1.5 rounded-full px-3 text-[0.76rem] text-[#50627f] dark:border-white/10 dark:bg-white/[0.08] dark:text-[#d8d0c5]">
        <StaffModelProviderLogo
          model={currentModelLogoIdentity}
          className="size-3.5"
        />
        <span className="max-w-[11rem] truncate">{displayCurrentLabel}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="dashboard-composer-model inline-flex h-[2.05rem] max-w-[15rem] cursor-pointer items-center gap-1.5 rounded-full px-3 text-[0.76rem] text-[#50627f] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b58c6a]/25 dark:border-white/10 dark:bg-white/[0.08] dark:text-[#d8d0c5] dark:hover:bg-white/[0.12] dark:focus-visible:ring-white/15"
        >
          <StaffModelProviderLogo
            model={currentModelLogoIdentity}
            className="size-3.5"
          />
          <span className="min-w-0 truncate">{displayCurrentLabel}</span>
          <ChevronDown
            size={11}
            className="text-[#93887b] dark:text-[#bdb5aa]"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="max-h-[min(21rem,var(--radix-dropdown-menu-content-available-height))] w-max max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[1.1rem] border-[#e8ded3] bg-white/[0.98] p-1.5 text-[#2f333b] shadow-[0_18px_44px_rgba(67,58,48,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-[#2b2521]/95 dark:text-[#ece5dc] dark:shadow-[0_18px_44px_rgba(0,0,0,0.28)]"
      >
        <DropdownMenuRadioGroup
          value={currentValue}
          onValueChange={(value) => {
            const [provider, id] = value.split("::");
            if (!provider || !id) return;
            onSelectModel({ provider, id });
          }}
        >
          {availableModels.map((model) => (
            <DropdownMenuRadioItem
              key={`${model.provider}::${model.id}`}
              value={`${model.provider}::${model.id}`}
              className="!cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-[0.82rem] font-medium leading-none text-[#30343b] transition-colors data-[highlighted]:bg-[#f7f3ee] data-[highlighted]:text-[#30343b] data-[state=checked]:bg-[#f3ece4] data-[state=checked]:text-[#7b5e47] dark:text-[#e7ded3] dark:data-[highlighted]:bg-white/[0.08] dark:data-[highlighted]:text-[#f4ece3] dark:data-[state=checked]:bg-[#6e5a45]/35 dark:data-[state=checked]:text-[#f4d2a8] [&>span:first-child]:hidden"
            >
              <StaffModelProviderLogo model={model} />
              <span className="inline-flex max-w-[calc(100vw-4rem)] items-center truncate">
                {formatStaffModelDisplayLabel(model.label)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DashboardHeader({
  agents,
  selectedAgentUserId,
  creditsLabel,
  isCreditsLow,
  planLabel,
  showUpgrade,
  onSelectAgent,
}: {
  agents: DashboardAgent[];
  selectedAgentUserId: string | null;
  creditsLabel: string;
  isCreditsLow: boolean;
  planLabel: string;
  showUpgrade: boolean;
  onSelectAgent: (userId: string) => void;
}) {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const selectedAgent =
    agents.find((agent) => agent.userId === selectedAgentUserId) ?? null;

  return (
    <header className="flex items-center justify-between gap-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex max-w-[18rem] items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-[#312c27] transition-colors hover:bg-white/50 cursor-pointer"
          >
            {selectedAgent ? (
              <UserAvatar
                userId={selectedAgent.userId}
                name={selectedAgent.label}
                username={selectedAgent.username}
                avatarUrl={selectedAgent.avatarUrl}
                isBot
                className="size-7 ring-1 ring-white/75"
                fallbackClassName="text-[0.72rem] font-semibold"
              />
            ) : null}
            <span className="truncate">
              {selectedAgent?.label ?? t("dashboardBrand")}
            </span>
            <ChevronDown size={14} className="shrink-0 text-[#8f8578]" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="w-[18rem] rounded-3xl border-white/70 bg-white/95 p-2 shadow-[0_20px_50px_rgba(140,121,93,0.18)] backdrop-blur"
        >
          {agents.length > 0 ? (
            <DropdownMenuRadioGroup
              value={selectedAgentUserId ?? undefined}
              onValueChange={onSelectAgent}
            >
              {agents.map((agent) => (
                <DropdownMenuRadioItem
                  key={agent.userId}
                  value={agent.userId}
                  className="!cursor-pointer rounded-2xl gap-3 py-2.5 px-3 [&>span:first-child]:hidden data-[state=checked]:bg-[#f3ede3]"
                >
                  <UserAvatar
                    userId={agent.userId}
                    name={agent.label}
                    username={agent.username}
                    avatarUrl={agent.avatarUrl}
                    isBot
                    className="size-9 shrink-0 ring-1 ring-black/5"
                    fallbackClassName="text-[0.78rem] font-semibold"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="truncate font-medium text-[#312c27]">
                        {agent.label}
                      </p>
                      <AgentTypeBadge agentType={agent.agentType} />
                      {agent.staffKind === "personal" && (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="h-5 shrink-0 rounded-md border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700"
                        >
                          {t("agentBadgeAide")}
                        </Badge>
                      )}
                    </div>
                    {(() => {
                      const subtitle =
                        agent.roleTitle ??
                        (agent.staffKind === "personal" && agent.ownerName
                          ? t("agentPillPersonalAssistantOf", {
                              owner: agent.ownerName,
                              defaultValue: `${agent.ownerName}'s ${t("agentPillPersonalAssistant")}`,
                            })
                          : null);
                      if (subtitle) {
                        return (
                          <p className="truncate text-xs text-[#8f8578]">
                            {subtitle}
                          </p>
                        );
                      }
                      return agent.username &&
                        agent.username !== agent.label ? (
                        <p className="truncate text-xs text-[#8f8578]">
                          @{agent.username}
                        </p>
                      ) : null;
                    })()}
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          ) : (
            <p className="px-3 py-2 text-sm text-[#8f8578]">
              {t("dashboardNoBotDescription")}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-2">
        <div
          data-testid="dashboard-plan-credits-pill"
          title={isCreditsLow ? t("dashboardCreditsLowTitle") : undefined}
          className={cn(
            "dashboard-landing-pill inline-flex h-auto items-center gap-2 rounded-full px-3 py-2 text-sm",
            isCreditsLow
              ? "bg-red-50 text-red-600 ring-1 ring-red-200"
              : "text-[#8f8578]",
          )}
        >
          <Crown
            size={14}
            className={cn(isCreditsLow ? "text-red-600" : "text-[#9c8f80]")}
          />
          <span>{planLabel}</span>
          {showUpgrade ? (
            <>
              <span className="h-4 w-px bg-[#e7ddd0]" />
              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/subscription",
                    search: { view: "plans", source: "home" },
                  })
                }
                className="rounded-full px-1 font-medium text-[#2f67ff] transition-colors hover:text-[#1f55df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f67ff]/20"
              >
                {t("dashboardUpgrade")}
              </button>
            </>
          ) : null}
          <span className="h-4 w-px bg-[#e7ddd0]" />
          <button
            type="button"
            onClick={() =>
              navigate({
                to: "/subscription",
                search: { view: "credits", source: "manage_credits" },
              })
            }
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b58c6a]/25",
              isCreditsLow
                ? "text-red-600 hover:text-red-700"
                : "text-[#8f8578] hover:text-[#6c6258]",
            )}
          >
            <Sparkles
              size={14}
              className={cn(isCreditsLow ? "text-red-600" : "text-[#9c8f80]")}
            />
            <span>{creditsLabel}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function DashboardModeSwitch({
  mode,
  onModeChange,
}: {
  mode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
}) {
  const { t } = useTranslation("navigation");
  const isTaskMode = mode === "task";

  const setMode = (nextMode: DashboardMode) => {
    if (nextMode === mode) return;
    onModeChange(nextMode);
  };

  return (
    <div
      role="tablist"
      aria-label={t("dashboardModeSwitchLabel")}
      className="dashboard-landing-pill relative inline-grid grid-cols-2 items-center rounded-full p-1 text-[0.8rem] text-[#8d8274]"
    >
      <span
        data-testid="dashboard-mode-switch-indicator"
        aria-hidden="true"
        className={cn(
          "absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-[0_6px_18px_rgba(132,114,88,0.12)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          isTaskMode && "translate-x-[calc(100%+0.25rem)]",
        )}
      />
      <button
        type="button"
        role="tab"
        aria-selected={!isTaskMode}
        onClick={() => setMode("conversation")}
        className={cn(
          "relative z-10 min-w-20 rounded-full px-4 py-1.5 font-medium transition-colors duration-200",
          !isTaskMode
            ? "text-[#312c27]"
            : "text-[#8d8274] hover:bg-white/45 hover:text-[#4d4339]",
        )}
      >
        {t("dashboardActionConversationMode")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={isTaskMode}
        onClick={() => setMode("task")}
        className={cn(
          "relative z-10 min-w-20 rounded-full px-4 py-1.5 font-medium transition-colors duration-200",
          isTaskMode
            ? "text-[#312c27]"
            : "text-[#8d8274] hover:bg-white/45 hover:text-[#4d4339]",
        )}
      >
        {t("dashboardActionTaskMode")}
      </button>
    </div>
  );
}

function DashboardModeTitle({ mode }: { mode: DashboardMode }) {
  const { t } = useTranslation("navigation");
  const isTaskMode = mode === "task";
  const title = isTaskMode ? t("dashboardTaskTitle") : t("dashboardTitle");

  return (
    <h1
      aria-label={title}
      className="dashboard-landing-title relative min-h-[2.7rem] text-center text-[clamp(1.6rem,2.8vw,2.5rem)] leading-[1.05] text-[#2d2924]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "block transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          isTaskMode ? "-translate-y-2 opacity-0" : "translate-y-0 opacity-100",
        )}
      >
        {t("dashboardTitle")}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          isTaskMode ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        {t("dashboardTaskTitle")}
      </span>
    </h1>
  );
}

function DashboardActionChip({
  label,
  icon: Icon,
  className,
  onClick,
  isActive,
}: {
  label: string;
  icon: LucideIcon;
  className?: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  // Use a button when clickable so keyboard and accessibility work correctly;
  // fall back to a plain div for purely decorative chips.
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? isActive : undefined}
      className={cn(
        "dashboard-composer-chip inline-flex h-[2.375rem] items-center gap-1.5 rounded-full px-3.5 text-[0.78rem] font-medium transition-colors",
        onClick && "cursor-pointer hover:opacity-80",
        isActive &&
          "bg-[#2f67ff] text-white shadow-[0_6px_16px_rgba(47,103,255,0.28)] hover:opacity-90",
        !isActive && className,
      )}
    >
      <Icon size={14} strokeWidth={1.8} />
      <span>{label}</span>
    </Component>
  );
}

function DashboardSkillMultiSelect({
  skills,
  selectedSkillIds,
  isLoading,
  onToggleSkill,
}: {
  skills: Skill[];
  selectedSkillIds: string[];
  isLoading: boolean;
  onToggleSkill: (skillId: string) => void;
}) {
  const { t } = useTranslation("navigation");
  const selectedSkills = skills.filter((skill) =>
    selectedSkillIds.includes(skill.id),
  );
  const selectedLabel =
    selectedSkills.length === 0
      ? t("dashboardActionSelectSkills")
      : selectedSkills.length === 1
        ? selectedSkills[0].name
        : t("dashboardSkillsSelectedCount", {
            count: selectedSkills.length,
          });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={selectedLabel}
          className="dashboard-composer-chip inline-flex h-[2.375rem] max-w-[14rem] cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[0.78rem] font-medium text-[#6c6359] transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b58c6a]/25"
        >
          <Sparkles size={14} strokeWidth={1.8} />
          <span className="min-w-0 truncate">{selectedLabel}</span>
          <ChevronDown size={12} strokeWidth={1.8} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] w-[18rem] overflow-y-auto rounded-2xl border-[#e8ded3] bg-white/[0.98] p-1.5 text-[#2f333b] shadow-[0_18px_44px_rgba(67,58,48,0.14)] backdrop-blur-xl"
      >
        {isLoading ? (
          <DropdownMenuItem disabled className="rounded-xl px-3 py-2 text-sm">
            {t("dashboardSkillsLoading")}
          </DropdownMenuItem>
        ) : skills.length > 0 ? (
          skills.map((skill) => (
            <DropdownMenuCheckboxItem
              key={skill.id}
              checked={selectedSkillIds.includes(skill.id)}
              onCheckedChange={() => onToggleSkill(skill.id)}
              onSelect={(event) => event.preventDefault()}
              className="!cursor-pointer items-start gap-2 rounded-xl py-2 pl-8 pr-3 text-left text-sm data-[highlighted]:bg-[#f7f3ee] data-[highlighted]:text-[#30343b]"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-[#30343b]">
                  {skill.name}
                </span>
                {skill.description ? (
                  <span className="mt-0.5 block line-clamp-2 text-xs text-[#817568]">
                    {skill.description}
                  </span>
                ) : null}
              </span>
            </DropdownMenuCheckboxItem>
          ))
        ) : (
          <DropdownMenuItem disabled className="rounded-xl px-3 py-2 text-sm">
            {t("dashboardSkillsEmpty")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getDefaultScheduledAtInputValue() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDashboardTaskTriggerLabel(
  mode: DashboardTaskTriggerMode,
  t: (key: ParseKeys<"navigation">) => string,
) {
  if (mode === "scheduled") return t("dashboardTaskTriggerScheduled");
  if (mode === "create_only") return t("dashboardTaskTriggerCreateOnly");
  return t("dashboardTaskExecuteImmediately");
}

function DashboardTaskTriggerSettingsDialog({
  triggerMode,
  scheduledAt,
  onTriggerModeChange,
  onScheduledAtChange,
}: {
  triggerMode: DashboardTaskTriggerMode;
  scheduledAt: string;
  onTriggerModeChange: (mode: DashboardTaskTriggerMode) => void;
  onScheduledAtChange: (scheduledAt: string) => void;
}) {
  const { t } = useTranslation("navigation");
  const selectedLabel = getDashboardTaskTriggerLabel(triggerMode, t);

  const handleModeChange = (value: string) => {
    const nextMode = value as DashboardTaskTriggerMode;
    onTriggerModeChange(nextMode);
    if (nextMode === "scheduled" && !scheduledAt) {
      onScheduledAtChange(getDefaultScheduledAtInputValue());
    }
  };

  const options: ReadonlyArray<{
    value: DashboardTaskTriggerMode;
    label: string;
  }> = [
    {
      value: "immediate",
      label: t("dashboardTaskExecuteImmediately"),
    },
    {
      value: "scheduled",
      label: t("dashboardTaskTriggerScheduled"),
    },
    {
      value: "create_only",
      label: t("dashboardTaskTriggerCreateOnly"),
    },
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="dashboard-composer-chip inline-flex h-[2.375rem] cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[0.78rem] font-medium text-[#6c6359] transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b58c6a]/25"
        >
          <Clock size={14} strokeWidth={1.8} />
          <span>{selectedLabel}</span>
          <ChevronDown size={12} strokeWidth={1.8} />
        </button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[28rem] rounded-3xl border-[#e8ded3] bg-[#fffaf4] p-5 text-[#302b25] shadow-[0_24px_70px_rgba(70,55,38,0.22)]"
      >
        <DialogHeader>
          <DialogTitle className="text-base">
            {t("dashboardTaskTriggerSettings")}
          </DialogTitle>
        </DialogHeader>

        <RadioGroup
          value={triggerMode}
          onValueChange={handleModeChange}
          className="gap-2"
        >
          {options.map((option) => {
            const id = `dashboard-task-trigger-${option.value}`;
            return (
              <label
                key={option.value}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 text-sm font-medium transition-colors",
                  triggerMode === option.value
                    ? "border-[#cbb9a6] bg-[#f8efe5] text-[#34291f]"
                    : "border-[#e8ded3] bg-white/70 text-[#74685e] hover:bg-white",
                )}
              >
                <RadioGroupItem
                  id={id}
                  value={option.value}
                  className="border-[#b8a895] text-[#6e513b]"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </RadioGroup>

        {triggerMode === "scheduled" ? (
          <div className="space-y-1.5">
            <label
              htmlFor="dashboard-task-scheduled-at"
              className="text-sm font-medium text-[#6c6258]"
            >
              {t("dashboardTaskTriggerScheduledAt")}
            </label>
            <Input
              id="dashboard-task-scheduled-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => onScheduledAtChange(event.target.value)}
              className="h-10 rounded-2xl border-[#ded4c8] bg-white/80 text-sm"
            />
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              className="h-9 rounded-full bg-[#3d2413] px-4 text-sm text-white hover:bg-[#4a2d18]"
            >
              {t("dashboardTaskTriggerDone")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Temporarily hidden from landing — keep for reintroduction
export function DashboardTaskPill() {
  const { t } = useTranslation("navigation");

  return (
    <div className="dashboard-landing-pill inline-flex items-center gap-2.5 rounded-full px-4.5 py-2 text-[0.8rem] text-[#6c6359]">
      <span className="rounded-full bg-[#edf2ff] px-2 py-0.5 text-[0.64rem] font-medium text-[#6e89b5]">
        {t("dashboardMockLabel")}
      </span>
      <span className="text-[#b0a79d]">{t("dashboardTaskEmptyValue")}</span>
      <span className="font-medium text-[#564d45]">
        {t("dashboardNoActiveTask")}
      </span>
      <span className="font-medium text-[#2f67ff]">
        {t("dashboardCreateTask")}
      </span>
      <ChevronRight size={13} className="text-[#8d8377]" />
    </div>
  );
}

function getDashboardTaskAgentSubtitle(agent: DashboardAgent) {
  if (agent.roleTitle) return agent.roleTitle;

  if (agent.staffKind === "personal" && agent.ownerName) {
    return agent.ownerName;
  }

  if (agent.shortRoleTitle) return agent.shortRoleTitle;
  if (agent.username && agent.username !== agent.label)
    return `@${agent.username}`;

  return null;
}

function DashboardTaskAgentSuggestions({
  agents,
  selectedAgentUserId,
  onSelectAgent,
}: {
  agents: DashboardAgent[];
  selectedAgentUserId: string | null;
  onSelectAgent: (userId: string) => void;
}) {
  const { t } = useTranslation("navigation");

  return (
    <section className="dashboard-landing-surface w-full overflow-hidden rounded-[1.25rem] px-0 py-0">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <h2 className="text-sm font-semibold text-[#6a5e52]">
          {t("dashboardTaskAgentGroupTitle", { count: agents.length })}
        </h2>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#6a5e52] transition-colors hover:text-[#2d2924]"
        >
          {t("dashboardTaskAgentsViewAll")}
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="divide-y divide-[#e8ded3]">
        {agents.length > 0 ? (
          agents.map((agent) => {
            const isSelected = agent.userId === selectedAgentUserId;
            const subtitle = getDashboardTaskAgentSubtitle(agent);

            return (
              <button
                key={agent.userId}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelectAgent(agent.userId)}
                className={cn(
                  "flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[#f8f3ec]",
                  isSelected && "bg-[#f4ede4]",
                )}
              >
                <UserAvatar
                  userId={agent.userId}
                  name={agent.label}
                  username={agent.username}
                  avatarUrl={agent.avatarUrl}
                  isBot
                  className="size-11 shrink-0 ring-1 ring-black/5"
                  fallbackClassName="text-[0.78rem] font-semibold"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[0.95rem] font-semibold text-[#2e405c]">
                      {agent.label}
                    </span>
                    <AgentTypeBadge agentType={agent.agentType} />
                    {agent.staffKind === "personal" && (
                      <Badge
                        variant="outline"
                        size="sm"
                        className="h-5 shrink-0 rounded-md border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700"
                      >
                        {t("agentBadgeAide")}
                      </Badge>
                    )}
                  </span>
                  {subtitle ? (
                    <span className="mt-1 block truncate text-sm text-[#786d62]">
                      {subtitle}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })
        ) : (
          <div className="px-5 py-5 text-sm text-[#786d62]">
            {t("dashboardNoBotDescription")}
          </div>
        )}
      </div>
    </section>
  );
}

function getWorkspaceCredits(
  account: WorkspaceBillingAccount | null | undefined,
) {
  return (
    (account?.balance ?? 0) +
    (account?.effectiveQuota ?? 0) +
    (account?.grantBalance ?? 0)
  );
}

const LOW_CREDITS_THRESHOLD = 400;

function formatDashboardCredits(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.floor(value));
}

function DashboardDeepResearchOptions({
  config,
  onChange,
}: {
  config: DeepResearchComposerConfig;
  onChange: (config: DeepResearchComposerConfig) => void;
}) {
  const { t } = useTranslation("navigation");

  return (
    <div className="mx-1 mt-2 rounded-2xl border border-[#e7ded2] bg-white/60 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#5f564d]">
        <Brain size={14} className="text-[#6f7d93]" />
        <span>{t("dashboardDeepResearchOptions")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-[#ede6dc] p-0.5">
          {(
            [
              ["standard", "dashboardDeepResearchModeStandard"],
              ["max", "dashboardDeepResearchModeMax"],
            ] as const
          ).map(([mode, labelKey]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={config.mode === mode}
              onClick={() => onChange({ ...config, mode })}
              className={cn(
                "h-7 rounded-full px-3 text-xs font-medium transition-colors",
                config.mode === mode
                  ? "bg-white text-[#2f3642] shadow-sm"
                  : "text-[#7d7368] hover:text-[#2f3642]",
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-pressed={config.visualization === "auto"}
          onClick={() =>
            onChange({
              ...config,
              visualization: config.visualization === "auto" ? "off" : "auto",
            })
          }
          className={cn(
            "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
            config.visualization === "auto"
              ? "border-[#b9c7df] bg-[#edf2ff] text-[#4a6288]"
              : "border-[#e0d6ca] bg-white/70 text-[#83786d]",
          )}
        >
          {config.visualization === "auto"
            ? t("dashboardDeepResearchVisualsOn")
            : t("dashboardDeepResearchVisualsOff")}
        </button>
      </div>
    </div>
  );
}

interface DashboardComposerDraft {
  prompt: string;
  attachments: AttachmentDto[];
  savedAt: number;
}

const DASHBOARD_COMPOSER_DRAFT_STORAGE_PREFIX = "team9.dashboard.composerDraft";
const RESTORED_ATTACHMENT_ID_PREFIX = "draft-attachment:";

function buildDashboardComposerDraftKey(
  workspaceId: string,
  agentUserId: string,
) {
  return `${DASHBOARD_COMPOSER_DRAFT_STORAGE_PREFIX}.${workspaceId}.${agentUserId}`;
}

function deriveTaskTitle(prompt: string) {
  const firstLine =
    prompt
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "新任务";

  if (firstLine.length <= TASK_TITLE_MAX_LENGTH) {
    return firstLine;
  }

  return `${firstLine.slice(0, TASK_TITLE_MAX_LENGTH - 1)}…`;
}

function readDashboardComposerDraft(
  key: string,
): DashboardComposerDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") return null;

    const draft = parsed as DashboardComposerDraft;
    if (
      typeof draft.prompt !== "string" ||
      typeof draft.savedAt !== "number" ||
      !Array.isArray(draft.attachments)
    ) {
      return null;
    }

    const attachments = draft.attachments.filter(
      (attachment): attachment is AttachmentDto =>
        !!attachment &&
        typeof attachment.fileKey === "string" &&
        typeof attachment.fileName === "string" &&
        typeof attachment.fileSize === "number" &&
        typeof attachment.mimeType === "string",
    );

    return {
      prompt: draft.prompt,
      attachments,
      savedAt: draft.savedAt,
    };
  } catch {
    return null;
  }
}

function mergeDashboardDraftAttachments(
  ...attachmentGroups: AttachmentDto[][]
): AttachmentDto[] {
  const merged = new Map<string, AttachmentDto>();

  for (const attachments of attachmentGroups) {
    for (const attachment of attachments) {
      merged.set(attachment.fileKey, attachment);
    }
  }

  return Array.from(merged.values());
}

function writeDashboardComposerDraft(
  key: string,
  prompt: string,
  attachments: AttachmentDto[],
) {
  const normalizedAttachments = mergeDashboardDraftAttachments(attachments);

  try {
    if (!prompt && normalizedAttachments.length === 0) {
      localStorage.removeItem(key);
      return;
    }

    const draft: DashboardComposerDraft = {
      prompt,
      attachments: normalizedAttachments,
      savedAt: Date.now(),
    };

    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable or full; keep the in-memory composer usable.
  }
}

function clearDashboardComposerDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function uploadToDraftAttachment(file: UploadingFile): AttachmentDto | null {
  if (file.status !== "completed" || !file.result) return null;

  return {
    fileKey: file.result.key,
    fileName: file.result.fileName,
    fileSize: file.result.fileSize,
    mimeType: file.result.mimeType,
  };
}

function restoredAttachmentToUploadingFile(
  attachment: AttachmentDto,
): UploadingFile {
  return {
    id: `${RESTORED_ATTACHMENT_ID_PREFIX}${attachment.fileKey}`,
    file: new File([], attachment.fileName, { type: attachment.mimeType }),
    progress: 100,
    status: "completed",
    result: {
      key: attachment.fileKey,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
    },
  };
}

export function HomeMainContent({
  agentId = null,
  mode: initialMode = "conversation",
}: { agentId?: string | null; mode?: DashboardMode } = {}) {
  const { t } = useTranslation(["navigation", "message"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();
  const { directChannels = [] } = useChannelsByType();
  const createTopicSession = useCreateTopicSession();
  const createTaskRun = useMutation({
    mutationFn: (dto: Parameters<typeof tasksApi.create>[0]) =>
      tasksApi.create(dto),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const { agents } = useDashboardAgents(directChannels);
  const billingSummary = useWorkspaceBillingSummary(workspaceId ?? undefined);
  const billingOverview = useWorkspaceBillingOverview(workspaceId ?? undefined);
  const [mode, setMode] = useState<DashboardMode>(initialMode);
  const isTaskMode = mode === "task";
  const skillsQuery = useSkills(undefined, { enabled: isTaskMode });
  const skills = skillsQuery.data ?? EMPTY_SKILLS;
  const areSkillsLoading = skillsQuery.isLoading;
  const [prompt, setPrompt] = useState("");
  const [taskTriggerMode, setTaskTriggerMode] =
    useState<DashboardTaskTriggerMode>("immediate");
  const [taskScheduledAt, setTaskScheduledAt] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [deepResearchConfig, setDeepResearchConfig] =
    useState<DeepResearchComposerConfig | null>(null);
  const [draftAttachments, setDraftAttachments] = useState<AttachmentDto[]>([]);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const promptValueRef = useRef("");
  const draftAttachmentsRef = useRef<AttachmentDto[]>([]);
  const completedUploadDraftAttachmentsRef = useRef<AttachmentDto[]>([]);
  const activeDraftKeyRef = useRef<string | null>(null);
  const skipNextDraftAutosaveRef = useRef(false);
  const isPromptComposingRef = useRef(false);
  const promptCompositionEndFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerSurfaceRef = useRef<HTMLDivElement | null>(null);
  const dragCounterRef = useRef(0);
  const submitInFlightRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  // Dashboard composer has no channelId yet (channel is created on submit),
  // so files are uploaded as workspace-visible. Once the topic-session
  // channel is provisioned, the message-attachment row references the
  // fileKey and access is gated by the message reader's channel membership
  // — the looser file-API visibility never grants extra reach.
  const {
    uploadingFiles,
    addFiles,
    retryFile,
    removeFile,
    isUploading,
    clearFiles,
  } = useFileUpload({ visibility: "workspace" });
  const [selectedAgentUserId, setSelectedAgentUserId] = useState<string | null>(
    agentId,
  );
  // Session-scoped model override: chosen in the dashboard dropdown, applied
  // only to the next topic session the user creates. Never written back to
  // the agent's persistent default. Cleared when the user switches agents.
  const [sessionModelOverride, setSessionModelOverride] =
    useState<DashboardAgentModel | null>(null);
  const selectedAgent =
    agents.find((agent) => agent.userId === selectedAgentUserId) ??
    pickDefaultAgent(agents);
  const draftKey =
    workspaceId && selectedAgent
      ? buildDashboardComposerDraftKey(workspaceId, selectedAgent.userId)
      : null;
  const completedUploadDraftAttachments = useMemo(
    () =>
      uploadingFiles.flatMap((file) => {
        const attachment = uploadToDraftAttachment(file);
        return attachment ? [attachment] : [];
      }),
    [uploadingFiles],
  );
  const currentDraftAttachments = useMemo(
    () =>
      mergeDashboardDraftAttachments(
        draftAttachments,
        completedUploadDraftAttachments,
      ),
    [completedUploadDraftAttachments, draftAttachments],
  );
  const previewFiles = useMemo(() => {
    const uploadedKeys = new Set(
      completedUploadDraftAttachments.map((attachment) => attachment.fileKey),
    );
    const restoredFiles = draftAttachments
      .filter((attachment) => !uploadedKeys.has(attachment.fileKey))
      .map(restoredAttachmentToUploadingFile);

    return [...restoredFiles, ...uploadingFiles];
  }, [completedUploadDraftAttachments, draftAttachments, uploadingFiles]);
  const effectiveModel = sessionModelOverride ?? selectedAgent?.model ?? null;
  const isSubmitting = isTaskMode
    ? createTaskRun.isPending
    : createTopicSession.isPending;
  // Allow send if either the prompt has text or there's at least one
  // completed attachment ready to ship — matches MessageInput's
  // "image-only message" UX. Still requires uploads to be settled and
  // an agent to be selected.
  const hasReadyAttachment = uploadingFiles.some(
    (f) => f.status === "completed",
  );
  const hasDraftAttachment = currentDraftAttachments.length > 0;
  const hasValidTaskTrigger =
    taskTriggerMode !== "scheduled" || taskScheduledAt.trim().length > 0;
  const canSubmit = isTaskMode
    ? prompt.trim().length > 0 &&
      hasValidTaskTrigger &&
      !isSubmitting &&
      !isUploading
    : (prompt.trim().length > 0 || hasReadyAttachment || hasDraftAttachment) &&
      !isSubmitting &&
      !isUploading &&
      !!selectedAgent;
  const activeSubscription = billingSummary.data?.subscription ?? null;
  const currentPlanLabel =
    activeSubscription?.product.name || t("dashboardPlan");
  const totalCredits = billingOverview.data?.account
    ? getWorkspaceCredits(billingOverview.data.account)
    : null;
  const creditsLabel =
    totalCredits !== null ? formatDashboardCredits(totalCredits) : "—";
  const isCreditsLow =
    totalCredits !== null && totalCredits < LOW_CREDITS_THRESHOLD;

  useEffect(() => {
    if (!agentId) return;
    setSelectedAgentUserId(agentId);
  }, [agentId]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (isTaskMode) {
      setDeepResearchConfig(null);
    }
  }, [isTaskMode]);

  useEffect(() => {
    const validSkillIds = new Set(skills.map((skill) => skill.id));
    setSelectedSkillIds((current) => {
      const next = current.filter((skillId) => validSkillIds.has(skillId));
      return next.length === current.length ? current : next;
    });
  }, [skills]);

  useEffect(() => {
    setSelectedAgentUserId((current) => {
      if (current && agents.some((agent) => agent.userId === current)) {
        return current;
      }

      return pickDefaultAgent(agents)?.userId ?? null;
    });
  }, [agents]);

  useEffect(() => {
    const previousDraftKey = activeDraftKeyRef.current;
    if (previousDraftKey && previousDraftKey !== draftKey) {
      writeDashboardComposerDraft(
        previousDraftKey,
        promptValueRef.current,
        mergeDashboardDraftAttachments(
          draftAttachmentsRef.current,
          completedUploadDraftAttachmentsRef.current,
        ),
      );
    }

    activeDraftKeyRef.current = draftKey;
    skipNextDraftAutosaveRef.current = true;
    clearFiles();

    if (!draftKey) {
      setPrompt("");
      setDraftAttachments([]);
      return;
    }

    const draft = readDashboardComposerDraft(draftKey);
    setPrompt(draft?.prompt ?? "");
    setDraftAttachments(draft?.attachments ?? []);
  }, [clearFiles, draftKey]);

  useEffect(() => {
    promptValueRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    draftAttachmentsRef.current = draftAttachments;
  }, [draftAttachments]);

  useEffect(() => {
    completedUploadDraftAttachmentsRef.current =
      completedUploadDraftAttachments;
  }, [completedUploadDraftAttachments]);

  useEffect(() => {
    if (!draftKey) return;

    if (skipNextDraftAutosaveRef.current) {
      skipNextDraftAutosaveRef.current = false;
      return;
    }

    writeDashboardComposerDraft(draftKey, prompt, currentDraftAttachments);
  }, [currentDraftAttachments, draftKey, prompt]);

  // Reset session model override when the user switches agents — each agent
  // should present its own default model until the user picks one again.
  useEffect(() => {
    setSessionModelOverride(null);
  }, [selectedAgentUserId]);

  const insertTemplate = (
    templateKey: ParseKeys<["navigation", "message"]>,
    mode?: "deep-research",
  ) => {
    setDeepResearchConfig(
      mode === "deep-research" ? DEFAULT_DEEP_RESEARCH_CONFIG : null,
    );
    const tpl = t(templateKey);
    setPrompt((prev) => (prev.trim() ? `${prev}\n\n${tpl}` : tpl));
    requestAnimationFrame(() => {
      const el = promptRef.current;
      if (!el) return;
      el.focus();
      const match = /\[([^\]]+)\]/.exec(el.value);
      if (match) {
        const start = match.index;
        el.setSelectionRange(start, start + match[0].length);
      }
    });
  };

  const handleActionChip = (
    chip: (typeof CONVERSATION_DASHBOARD_ACTION_CHIPS)[number],
  ) => {
    if (chip.mode === "deep-research") {
      setDeepResearchConfig((current) =>
        current ? null : DEFAULT_DEEP_RESEARCH_CONFIG,
      );
      requestAnimationFrame(() => promptRef.current?.focus());
      return;
    }

    if (chip.templateKey) {
      insertTemplate(chip.templateKey);
    }
  };

  const handleToggleSkill = useCallback((skillId: string) => {
    setSelectedSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId],
    );
  }, []);

  const handlePromptChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setPrompt(event.target.value);
  };

  const handleRemoveFile = useCallback(
    (id: string) => {
      if (id.startsWith(RESTORED_ATTACHMENT_ID_PREFIX)) {
        const fileKey = id.slice(RESTORED_ATTACHMENT_ID_PREFIX.length);
        setDraftAttachments((current) =>
          current.filter((attachment) => attachment.fileKey !== fileKey),
        );
        return;
      }

      removeFile(id);
    },
    [removeFile],
  );

  const handleSubmit = async () => {
    const draft = prompt.trim();
    if (!isTaskMode && !selectedAgent) return;
    // Defensive: canSubmit already gates this, but if a stray Enter slips
    // through while uploads are in-flight we'd otherwise drop the file
    // references. Mirror MessageInput's early-return.
    if (isUploading) return;

    const attachments = currentDraftAttachments;
    // Empty draft is OK only when at least one attachment is ready —
    // server-side ValidateIf relaxes IsNotEmpty under the same condition.
    if (isTaskMode ? !draft : !draft && attachments.length === 0) return;
    if (submitInFlightRef.current) return;

    submitInFlightRef.current = true;
    try {
      if (isTaskMode) {
        const task = await createTaskRun.mutateAsync({
          title: deriveTaskTitle(draft),
          description: draft,
          executeImmediately: taskTriggerMode === "immediate",
          triggerMode: taskTriggerMode,
          ...(taskTriggerMode === "scheduled" && taskScheduledAt
            ? { scheduledAt: taskScheduledAt }
            : {}),
          ...(selectedAgent?.botId ? { botId: selectedAgent.botId } : {}),
        });

        setPrompt("");
        setSelectedSkillIds([]);
        setDraftAttachments([]);
        clearFiles();
        if (draftKey) {
          clearDashboardComposerDraft(draftKey);
        }
        navigate({
          to: "/tasks/$taskId",
          params: { taskId: task.id },
        });
        return;
      }

      if (!selectedAgent) return;
      // Create a fresh topic session for this prompt. The server persists
      // the first user message inside the same saga, so we can navigate
      // straight to the new channel without draft/autoSend URL params.
      // effectiveModel carries the session-scoped override (if any) or
      // falls back to the agent's stored default — either way it stays
      // local to this session and never mutates the agent's config.
      const result = await createTopicSession.mutateAsync({
        botUserId: selectedAgent.userId,
        initialMessage: draft,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(deepResearchConfig
          ? {
              metadata: buildDeepResearchRequestMetadata(deepResearchConfig, {
                attachmentCount: attachments.length,
              }),
            }
          : {}),
      });

      setPrompt("");
      setDeepResearchConfig(null);
      setDraftAttachments([]);
      clearFiles();
      if (draftKey) {
        clearDashboardComposerDraft(draftKey);
      }
      navigate({
        to: "/channels/$channelId",
        params: { channelId: result.channelId },
      });
    } catch (error: unknown) {
      const status = getHttpErrorStatus(error);

      if (status === 403) {
        alert(t("dmPermissionDenied"));
        return;
      }

      alert(getHttpErrorMessage(error) || "Failed to create conversation");
    } finally {
      submitInFlightRef.current = false;
    }
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        addFiles(files);
      }
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            // Pasted screenshots often lack a meaningful name — generate one
            if (!file.name || file.name.trim().length === 0) {
              const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
              const extension = file.type.split("/")[1] || "bin";
              pastedFiles.push(
                new File([file], `pasted-${timestamp}.${extension}`, {
                  type: file.type,
                }),
              );
            } else {
              pastedFiles.push(file);
            }
          }
        }
      }

      if (pastedFiles.length > 0) {
        const dataTransfer = new DataTransfer();
        pastedFiles.forEach((file) => dataTransfer.items.add(file));
        addFiles(dataTransfer.files);
      }
    },
    [addFiles],
  );

  useEffect(() => {
    const surface = composerSurfaceRef.current;
    if (!surface) return;

    surface.addEventListener("paste", handlePaste);
    return () => {
      surface.removeEventListener("paste", handlePaste);
    };
  }, [handlePaste]);

  useEffect(() => {
    return () => {
      if (promptCompositionEndFrameRef.current !== null) {
        cancelAnimationFrame(promptCompositionEndFrameRef.current);
        promptCompositionEndFrameRef.current = null;
      }
      isPromptComposingRef.current = false;
    };
  }, []);

  const handlePromptCompositionStart: CompositionEventHandler<
    HTMLTextAreaElement
  > = () => {
    if (promptCompositionEndFrameRef.current !== null) {
      cancelAnimationFrame(promptCompositionEndFrameRef.current);
      promptCompositionEndFrameRef.current = null;
    }
    isPromptComposingRef.current = true;
  };

  const handlePromptCompositionEnd: CompositionEventHandler<
    HTMLTextAreaElement
  > = () => {
    if (promptCompositionEndFrameRef.current !== null) {
      cancelAnimationFrame(promptCompositionEndFrameRef.current);
    }
    // WKWebView/Safari can fire compositionend before the Enter keydown that
    // commits the IME candidate, so keep the guard alive for that same tick.
    promptCompositionEndFrameRef.current = requestAnimationFrame(() => {
      promptCompositionEndFrameRef.current = null;
      isPromptComposingRef.current = false;
    });
  };

  const handlePromptKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (
    event,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      if (
        isPromptComposingRef.current ||
        event.nativeEvent.isComposing ||
        event.keyCode === 229
      ) {
        return;
      }
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleModelChange = (model: DashboardAgentModel) => {
    if (!selectedAgent?.canSwitchModel) return;

    if (
      effectiveModel?.provider === model.provider &&
      effectiveModel?.id === model.id
    ) {
      return;
    }

    setSessionModelOverride(model);
  };

  const handleModeChange = useCallback(
    (nextMode: DashboardMode) => {
      setMode(nextMode);
      void navigate({
        to: nextMode === "task" ? TASK_ENTRY_PATH : HOME_ENTRY_PATH,
      });
    },
    [navigate],
  );

  return (
    <main className="dashboard-landing h-full overflow-y-auto">
      <div className="dashboard-landing-shell min-h-full">
        <div className="flex min-h-full w-full flex-col px-4 pb-8 pt-4 sm:px-6 sm:pb-10 lg:px-8">
          <DashboardHeader
            agents={agents}
            selectedAgentUserId={selectedAgent?.userId ?? null}
            creditsLabel={creditsLabel}
            isCreditsLow={isCreditsLow}
            planLabel={currentPlanLabel}
            showUpgrade={!activeSubscription}
            onSelectAgent={setSelectedAgentUserId}
          />

          <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col items-center justify-center gap-8 pb-8 pt-14 sm:gap-10 sm:pb-12 sm:pt-16 lg:pb-[4.5rem] lg:pt-20">
            <DashboardModeSwitch mode={mode} onModeChange={handleModeChange} />

            <div className="mx-auto flex w-full max-w-[45.5rem] flex-col items-center gap-8 sm:gap-10">
              <DashboardModeTitle mode={mode} />

              <div
                ref={composerSurfaceRef}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={cn(
                  "dashboard-landing-surface relative w-full rounded-[1.9rem] px-3.5 pb-3.5 pt-3 transition-colors sm:px-4 sm:pb-4 sm:pt-3.5",
                  isDragging && "ring-2 ring-info/40 ring-offset-2",
                )}
              >
                {isDragging && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[1.9rem] border-2 border-dashed border-info/40 bg-info/10 pointer-events-none">
                    <div className="flex flex-col items-center gap-2 text-info">
                      <Upload size={28} />
                      <span className="text-sm font-medium">
                        {t("message:dragToUpload")}
                      </span>
                    </div>
                  </div>
                )}

                <Textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={handlePromptChange}
                  onCompositionStart={handlePromptCompositionStart}
                  onCompositionEnd={handlePromptCompositionEnd}
                  onKeyDown={handlePromptKeyDown}
                  rows={3}
                  placeholder={
                    isTaskMode
                      ? t("dashboardTaskPromptPlaceholder")
                      : t("dashboardPromptPlaceholder")
                  }
                  className="min-h-[4rem] resize-none border-0 bg-transparent px-2.5 py-1.5 text-[0.82rem] leading-[1.2rem] text-[#3f3a35] shadow-none placeholder:text-[#c8d5e6] focus-visible:border-transparent focus-visible:ring-0 md:text-[0.82rem]"
                />

                {previewFiles.length > 0 && (
                  <div className="-mx-2 -mt-1">
                    <AttachmentPreview
                      files={previewFiles}
                      onRemove={handleRemoveFile}
                      onRetry={retryFile}
                    />
                  </div>
                )}

                <div className="mt-3 flex flex-col gap-2.5 px-0.5 pt-0.5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("uploadFile", { ns: "common" })}
                          className="dashboard-composer-plus inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-full text-[#3e4f68] hover:bg-[#3e4f68]/10 transition-colors cursor-pointer"
                        >
                          <Plus size={17} strokeWidth={2} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="min-w-[160px]"
                      >
                        <DropdownMenuItem
                          onSelect={() => fileInputRef.current?.click()}
                          className="gap-2 text-sm cursor-pointer"
                        >
                          <Paperclip size={14} />
                          {t("uploadFile", { ns: "common" })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) {
                          addFiles(files);
                        }
                        // Reset so picking the same filename again still fires onChange
                        e.target.value = "";
                      }}
                    />

                    {isTaskMode ? (
                      <>
                        <DashboardSkillMultiSelect
                          skills={skills}
                          selectedSkillIds={selectedSkillIds}
                          isLoading={areSkillsLoading}
                          onToggleSkill={handleToggleSkill}
                        />
                        <DashboardTaskTriggerSettingsDialog
                          triggerMode={taskTriggerMode}
                          scheduledAt={taskScheduledAt}
                          onTriggerModeChange={setTaskTriggerMode}
                          onScheduledAtChange={setTaskScheduledAt}
                        />
                      </>
                    ) : (
                      CONVERSATION_DASHBOARD_ACTION_CHIPS.map((chip) => (
                        <DashboardActionChip
                          key={chip.key}
                          label={t(chip.key)}
                          icon={chip.icon}
                          className={chip.className}
                          onClick={() => handleActionChip(chip)}
                          isActive={
                            chip.mode === "deep-research" &&
                            deepResearchConfig !== null
                          }
                        />
                      ))
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-1.5 sm:justify-end">
                    {SHOW_COMPOSER_MODEL_CONTROL ? (
                      <DashboardModelControl
                        agent={selectedAgent}
                        model={effectiveModel}
                        fallbackLabel={t("dashboardModelLabel")}
                        onSelectModel={handleModelChange}
                      />
                    ) : null}

                    <Button
                      type="button"
                      size="icon"
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      aria-label={t("sendMessage", { ns: "message" })}
                      className="dashboard-composer-send h-[2.375rem] w-[2.375rem] rounded-full bg-[#818894] text-white shadow-none hover:bg-[#727885] disabled:bg-[#ddd7cf] disabled:text-[#a2998d] dark:bg-[#726f68] dark:text-[#f6f0e8] dark:hover:bg-[#838077] dark:disabled:bg-white/[0.08] dark:disabled:text-white/30 dark:disabled:ring-1 dark:disabled:ring-white/[0.06]"
                    >
                      {isSubmitting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <ArrowUp size={16} strokeWidth={2.2} />
                      )}
                    </Button>
                  </div>
                </div>
                {deepResearchConfig && (
                  <DashboardDeepResearchOptions
                    config={deepResearchConfig}
                    onChange={setDeepResearchConfig}
                  />
                )}
              </div>

              {SHOW_TASK_AGENT_SUGGESTIONS ? (
                <div
                  aria-hidden={!isTaskMode}
                  className={cn(
                    "grid w-full transition-[grid-template-rows,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                    isTaskMode
                      ? "grid-rows-[1fr] translate-y-0 opacity-100"
                      : "pointer-events-none grid-rows-[0fr] -translate-y-2 opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <DashboardTaskAgentSuggestions
                      agents={agents}
                      selectedAgentUserId={selectedAgent?.userId ?? null}
                      onSelectAgent={setSelectedAgentUserId}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* <DashboardTaskPill /> */}
          </div>
        </div>
      </div>
    </main>
  );
}
