import type { KeyboardEventHandler } from "react";
import {
  type LucideIcon,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCreateDirectChannel, useChannelsByType } from "@/hooks/useChannels";
import {
  type DashboardAgent,
  type DashboardAgentModel,
  useDashboardAgents,
} from "@/hooks/useDashboardAgents";
import {
  useWorkspaceBillingOverview,
  useWorkspaceBillingSummary,
} from "@/hooks/useWorkspaceBilling";
import { deepResearchApi } from "@/services/api/deep-research";
import { upsertChannelMessageInCache } from "@/lib/message-query-cache";
import { getHttpErrorMessage, getHttpErrorStatus } from "@/lib/http-error";
import {
  COMMON_STAFF_MODELS,
  DEFAULT_STAFF_MODEL,
} from "@/lib/common-staff-models";
import {
  getBaseModelProductKey,
  getBaseModelProductKeyFromBotIdentity,
} from "@/lib/base-model-agent";
import type { WorkspaceBillingAccount } from "@/types/workspace";
import { useSelectedWorkspaceId } from "@/stores";
import { cn } from "@/lib/utils";

// Deep research / generate image entries temporarily hidden
const DASHBOARD_ACTION_CHIPS: ReadonlyArray<{
  key: string;
  icon: typeof Search;
  className: string;
}> = [];

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
  gemini: "Gemini 3 Flash Preview",
} as const;

function getAgentModelLabel(
  agent: DashboardAgent | null,
  fallbackLabel: string,
) {
  if (!agent) return fallbackLabel;

  if (agent.model) {
    const matchedModel = COMMON_STAFF_MODELS.find(
      (model) =>
        model.provider === agent.model?.provider && model.id === agent.model.id,
    );

    return matchedModel?.label ?? agent.model.id;
  }

  if (agent.canSwitchModel) {
    return DEFAULT_STAFF_MODEL.label;
  }

  const productKey =
    getBaseModelProductKey(agent.managedAgentId) ??
    getBaseModelProductKeyFromBotIdentity({
      isBot: true,
      name: agent.label,
      username: agent.username,
    });

  return productKey ? FIXED_BASE_MODEL_LABELS[productKey] : fallbackLabel;
}

function DashboardModelControl({
  agent,
  fallbackLabel,
  isUpdating,
  onSelectModel,
}: {
  agent: DashboardAgent | null;
  fallbackLabel: string;
  isUpdating: boolean;
  onSelectModel: (model: DashboardAgentModel) => Promise<void>;
}) {
  const currentLabel = getAgentModelLabel(agent, fallbackLabel);
  const currentValue = agent?.model
    ? `${agent.model.provider}::${agent.model.id}`
    : undefined;

  if (!agent?.canSwitchModel) {
    return (
      <div className="dashboard-composer-model inline-flex h-[2.05rem] items-center gap-1.5 rounded-full px-3 text-[0.76rem] text-[#50627f]">
        <Sparkles size={12} className="text-[#2c3647]" />
        <span>{currentLabel}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isUpdating}
          className="dashboard-composer-model inline-flex h-[2.05rem] items-center gap-1.5 rounded-full px-3 text-[0.76rem] text-[#50627f] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUpdating ? (
            <Loader2 size={12} className="animate-spin text-[#2c3647]" />
          ) : (
            <Sparkles size={12} className="text-[#2c3647]" />
          )}
          <span>{currentLabel}</span>
          <ChevronDown size={11} className="text-[#93887b]" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[15rem] rounded-3xl border-white/70 bg-white/95 p-2 shadow-[0_20px_50px_rgba(140,121,93,0.18)] backdrop-blur"
      >
        <DropdownMenuRadioGroup
          value={currentValue}
          onValueChange={(value) => {
            const [provider, id] = value.split("::");
            if (!provider || !id) return;
            void onSelectModel({ provider, id });
          }}
        >
          {COMMON_STAFF_MODELS.map((model) => (
            <DropdownMenuRadioItem
              key={`${model.provider}::${model.id}`}
              value={`${model.provider}::${model.id}`}
              className="!cursor-pointer rounded-2xl py-2.5 pr-3"
            >
              {model.label}
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
  onSelectAgent,
}: {
  agents: DashboardAgent[];
  selectedAgentUserId: string | null;
  creditsLabel: string;
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
                  className="!cursor-pointer rounded-2xl py-2.5 pr-3"
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

                  <div className="min-w-0">
                    <p className="truncate font-medium text-[#312c27]">
                      {agent.label}
                    </p>
                    {agent.username && agent.username !== agent.label ? (
                      <p className="truncate text-xs text-[#8f8578]">
                        @{agent.username}
                      </p>
                    ) : null}
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

      <Button
        variant="ghost"
        onClick={() =>
          navigate({ to: "/subscription", search: { view: "credits" } })
        }
        className="dashboard-landing-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[#8f8578] hover:bg-white/50 hover:text-[#8f8578] h-auto cursor-pointer"
      >
        <Sparkles size={14} className="text-[#9c8f80]" />
        <span>{creditsLabel}</span>
      </Button>
    </header>
  );
}

function DashboardPlanBadge({ planLabel }: { planLabel: string }) {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();

  return (
    <div className="dashboard-landing-pill inline-flex items-center rounded-full p-[0.2rem] text-[0.8rem] text-[#8d8274]">
      <span className="rounded-full px-4 py-1.5">{planLabel}</span>
      <span className="h-4 w-px bg-[#e7ddd0]" />
      <Button
        variant="ghost"
        onClick={() =>
          navigate({ to: "/subscription", search: { view: "plans" } })
        }
        className="rounded-full px-4 py-1.5 font-medium text-[#2f67ff] hover:bg-white/50 hover:text-[#2f67ff] h-auto cursor-pointer"
      >
        {t("dashboardUpgrade")}
      </Button>
    </div>
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

function getWorkspaceCredits(
  account: WorkspaceBillingAccount | null | undefined,
) {
  return (account?.balance ?? 0) + (account?.effectiveQuota ?? 0);
}

function formatDashboardCredits(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function HomeMainContent() {
  const { t } = useTranslation(["navigation", "message"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();
  const { directChannels = [] } = useChannelsByType();
  const createDirectChannel = useCreateDirectChannel();
  const { agents, updateAgentModel, updatingAgentUserId } =
    useDashboardAgents(directChannels);
  const billingSummary = useWorkspaceBillingSummary(workspaceId ?? undefined);
  const billingOverview = useWorkspaceBillingOverview(
    workspaceId ?? undefined,
    billingSummary.data?.managementAllowed ?? false,
  );
  const [prompt, setPrompt] = useState("");
  const [selectedAgentUserId, setSelectedAgentUserId] = useState<string | null>(
    null,
  );
  const [isDeepResearch, setIsDeepResearch] = useState(false);
  const [isCreatingResearch, setIsCreatingResearch] = useState(false);
  const selectedAgent =
    agents.find((agent) => agent.userId === selectedAgentUserId) ??
    pickDefaultAgent(agents);
  const canSubmit =
    prompt.trim().length > 0 &&
    !createDirectChannel.isPending &&
    !isCreatingResearch &&
    (isDeepResearch || !!selectedAgent);
  const isUpdatingSelectedAgentModel =
    !!selectedAgent && updatingAgentUserId === selectedAgent.userId;
  const currentPlanLabel =
    billingSummary.data?.subscription?.product.name || t("dashboardPlan");
  const creditsLabel =
    billingSummary.data?.managementAllowed && billingOverview.data?.account
      ? formatDashboardCredits(
          getWorkspaceCredits(billingOverview.data.account),
        )
      : "—";

  useEffect(() => {
    setSelectedAgentUserId((current) => {
      if (current && agents.some((agent) => agent.userId === current)) {
        return current;
      }

      return pickDefaultAgent(agents)?.userId ?? null;
    });
  }, [agents]);

  const handleSubmit = async () => {
    const draft = prompt.trim();
    if (!draft) return;

    if (isDeepResearch) {
      if (!selectedAgent) return;
      if (isCreatingResearch) return;
      setIsCreatingResearch(true);
      try {
        const channelId =
          selectedAgent.channelId ??
          (await createDirectChannel.mutateAsync(selectedAgent.userId)).id;
        const result = await deepResearchApi.startInChannel(channelId, {
          input: draft,
          origin: "dashboard",
        });
        upsertChannelMessageInCache(queryClient, channelId, result.message);

        setPrompt("");
        setIsDeepResearch(false);
        navigate({
          to: "/channels/$channelId",
          params: { channelId },
          search: { message: result.message.id },
        });
      } catch (error: unknown) {
        const status = getHttpErrorStatus(error);
        if (status === 403) {
          alert(t("dmPermissionDenied"));
          return;
        }
        alert(
          getHttpErrorMessage(error) || t("dashboardDeepResearchCreateFailed"),
        );
      } finally {
        setIsCreatingResearch(false);
      }
      return;
    }

    if (!selectedAgent) return;

    try {
      const channelId =
        selectedAgent.channelId ??
        (await createDirectChannel.mutateAsync(selectedAgent.userId)).id;

      setPrompt("");
      navigate({
        to: "/channels/$channelId",
        params: { channelId },
        search: { draft, autoSend: true },
      });
    } catch (error: unknown) {
      const status = getHttpErrorStatus(error);

      if (status === 403) {
        alert(t("dmPermissionDenied"));
        return;
      }

      alert(getHttpErrorMessage(error) || "Failed to create conversation");
    }
  };

  const handlePromptKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (
    event,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleModelChange = async (model: DashboardAgentModel) => {
    if (!selectedAgent?.canSwitchModel) return;

    if (
      selectedAgent.model?.provider === model.provider &&
      selectedAgent.model?.id === model.id
    ) {
      return;
    }

    try {
      await updateAgentModel(selectedAgent, model);
    } catch (error: unknown) {
      alert(getHttpErrorMessage(error) || "Failed to update model");
    }
  };

  return (
    <main className="dashboard-landing h-full overflow-y-auto">
      <div className="dashboard-landing-shell min-h-full">
        <div className="flex min-h-full w-full flex-col px-4 pb-8 pt-4 sm:px-6 sm:pb-10 lg:px-8">
          <DashboardHeader
            agents={agents}
            selectedAgentUserId={selectedAgent?.userId ?? null}
            creditsLabel={creditsLabel}
            onSelectAgent={setSelectedAgentUserId}
          />

          <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col items-center justify-center gap-5 pb-8 pt-14 sm:gap-6 sm:pb-12 sm:pt-16 lg:pb-[4.5rem] lg:pt-20">
            <DashboardPlanBadge planLabel={currentPlanLabel} />

            <div className="mx-auto flex w-full max-w-[45.5rem] flex-col items-center gap-5">
              <h1 className="dashboard-landing-title max-w-[27.75rem] text-center text-[clamp(2.1rem,4vw,3.35rem)] leading-[0.99] text-[#2d2924]">
                {t("dashboardTitle")}
              </h1>

              <div className="dashboard-landing-surface w-full rounded-[1.9rem] px-3.5 pb-3.5 pt-3 sm:px-4 sm:pb-4 sm:pt-3.5">
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={handlePromptKeyDown}
                  rows={3}
                  placeholder={t(
                    isDeepResearch
                      ? "dashboardDeepResearchPlaceholder"
                      : "dashboardPromptPlaceholder",
                  )}
                  className="min-h-[4rem] resize-none border-0 bg-transparent px-2.5 py-1.5 text-[0.82rem] leading-[1.2rem] text-[#3f3a35] shadow-none placeholder:text-[#c8d5e6] focus-visible:border-transparent focus-visible:ring-0 md:text-[0.82rem]"
                />

                <div className="mt-3 flex flex-col gap-2.5 px-0.5 pt-0.5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="dashboard-composer-plus inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-full text-[#3e4f68]"
                    >
                      <Plus size={17} strokeWidth={2} />
                    </button>

                    {DASHBOARD_ACTION_CHIPS.map((chip) => {
                      const isDeepResearchChip =
                        chip.key === "dashboardActionDeepResearch";
                      return (
                        <DashboardActionChip
                          key={chip.key}
                          label={t(chip.key)}
                          icon={chip.icon}
                          className={chip.className}
                          isActive={isDeepResearchChip && isDeepResearch}
                          onClick={
                            isDeepResearchChip
                              ? () => setIsDeepResearch((prev) => !prev)
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-1.5 sm:justify-end">
                    {isDeepResearch ? null : (
                      <DashboardModelControl
                        agent={selectedAgent}
                        fallbackLabel={t("dashboardModelLabel")}
                        isUpdating={isUpdatingSelectedAgentModel}
                        onSelectModel={handleModelChange}
                      />
                    )}

                    <Button
                      type="button"
                      size="icon"
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      aria-label={t("sendMessage", { ns: "message" })}
                      className="dashboard-composer-send h-[2.375rem] w-[2.375rem] rounded-full bg-[#818894] text-white shadow-none hover:bg-[#727885] disabled:bg-[#ddd7cf] disabled:text-[#a2998d]"
                    >
                      {createDirectChannel.isPending || isCreatingResearch ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <ArrowUp size={16} strokeWidth={2.2} />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* <DashboardTaskPill /> */}
          </div>
        </div>
      </div>
    </main>
  );
}
