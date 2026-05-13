import type { CompositionEventHandler, KeyboardEventHandler } from "react";
import {
  type LucideIcon,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Crown,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Upload,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AgentTypeBadge } from "@/components/ui/agent-type-badge";
import { Badge } from "@/components/ui/badge";
import { StaffModelProviderLogo } from "@/components/ai-staff/StaffModelProviderLogo";
import { useChannelsByType } from "@/hooks/useChannels";
import { useCreateTopicSession } from "@/hooks/useTopicSessions";
import { useFileUpload } from "@/hooks/useFileUpload";
import { AttachmentPreview } from "@/components/channel/editor/AttachmentPreview";
import {
  type DashboardAgent,
  type DashboardAgentModel,
  useDashboardAgents,
} from "@/hooks/useDashboardAgents";
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
  getBaseModelProductKey,
  getBaseModelProductKeyFromBotIdentity,
} from "@/lib/base-model-agent";
import type { WorkspaceBillingAccount } from "@/types/workspace";
import { useSelectedWorkspaceId } from "@/stores";
import { cn } from "@/lib/utils";

const DASHBOARD_ACTION_CHIPS: ReadonlyArray<{
  key: ParseKeys<["navigation", "message"]>;
  templateKey: ParseKeys<["navigation", "message"]>;
  icon: typeof Search;
  className: string;
}> = [
  {
    key: "dashboardActionVideoGeneration",
    templateKey: "dashboardVideoGenerationTemplate",
    icon: Video,
    className: "",
  },
];

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
      <div className="dashboard-composer-model inline-flex h-[2.05rem] items-center gap-1.5 rounded-full px-3 text-[0.76rem] text-[#50627f]">
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
          className="dashboard-composer-model inline-flex h-[2.05rem] max-w-[15rem] cursor-pointer items-center gap-1.5 rounded-full px-3 text-[0.76rem] text-[#50627f] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b58c6a]/25"
        >
          <StaffModelProviderLogo
            model={currentModelLogoIdentity}
            className="size-3.5"
          />
          <span className="min-w-0 truncate">{displayCurrentLabel}</span>
          <ChevronDown size={11} className="text-[#93887b]" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="max-h-[min(21rem,var(--radix-dropdown-menu-content-available-height))] w-max max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[1.1rem] border-[#e8ded3] bg-white/[0.98] p-1.5 text-[#2f333b] shadow-[0_18px_44px_rgba(67,58,48,0.14)] backdrop-blur-xl"
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
              className="!cursor-pointer gap-2 rounded-xl px-2.5 py-2 text-[0.82rem] font-medium leading-none text-[#30343b] transition-colors data-[highlighted]:bg-[#f7f3ee] data-[highlighted]:text-[#30343b] data-[state=checked]:bg-[#f3ece4] data-[state=checked]:text-[#7b5e47] [&>span:first-child]:hidden"
            >
              <StaffModelProviderLogo model={model} />
              <span className="block max-w-[calc(100vw-4rem)] truncate">
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
  subscriptionPlanLabel,
  onSelectAgent,
}: {
  agents: DashboardAgent[];
  selectedAgentUserId: string | null;
  creditsLabel: string;
  isCreditsLow: boolean;
  subscriptionPlanLabel: string | null;
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
        {subscriptionPlanLabel ? (
          <Button
            variant="ghost"
            onClick={() =>
              navigate({
                to: "/subscription",
                search: { view: "plans", source: "home" },
              })
            }
            className="dashboard-landing-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm h-auto cursor-pointer text-[#8f8578] hover:bg-white/50 hover:text-[#8f8578]"
          >
            <Crown size={14} className="text-[#9c8f80]" />
            <span>{subscriptionPlanLabel}</span>
          </Button>
        ) : null}

        <Button
          variant="ghost"
          onClick={() =>
            navigate({
              to: "/subscription",
              search: { view: "credits", source: "manage_credits" },
            })
          }
          title={isCreditsLow ? t("dashboardCreditsLowTitle") : undefined}
          className={cn(
            "dashboard-landing-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm h-auto cursor-pointer",
            isCreditsLow
              ? "bg-red-50 text-red-600 ring-1 ring-red-200 hover:bg-red-100 hover:text-red-700"
              : "text-[#8f8578] hover:bg-white/50 hover:text-[#8f8578]",
          )}
        >
          <Sparkles
            size={14}
            className={cn(isCreditsLow ? "text-red-600" : "text-[#9c8f80]")}
          />
          <span>{creditsLabel}</span>
        </Button>
      </div>
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
          navigate({
            to: "/subscription",
            search: { view: "plans", source: "home" },
          })
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

export function HomeMainContent({
  agentId = null,
}: { agentId?: string | null } = {}) {
  const { t } = useTranslation(["navigation", "message"]);
  const navigate = useNavigate();
  const workspaceId = useSelectedWorkspaceId();
  const { directChannels = [] } = useChannelsByType();
  const createTopicSession = useCreateTopicSession();
  const { agents } = useDashboardAgents(directChannels);
  const billingSummary = useWorkspaceBillingSummary(workspaceId ?? undefined);
  const billingOverview = useWorkspaceBillingOverview(workspaceId ?? undefined);
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const isPromptComposingRef = useRef(false);
  const promptCompositionEndFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerSurfaceRef = useRef<HTMLDivElement | null>(null);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  // Dashboard composer has no channelId yet (channel is created on submit),
  // so files are uploaded as workspace-visible. Once the topic-session
  // channel is provisioned, the message-attachment row references the
  // fileKey and access is gated by the message reader's channel membership
  // — the looser file-API visibility never grants extra reach.
  const {
    uploadingFiles,
    addFiles,
    removeFile,
    retryFile,
    getAttachments,
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
  const effectiveModel = sessionModelOverride ?? selectedAgent?.model ?? null;
  const isSubmitting = createTopicSession.isPending;
  // Allow send if either the prompt has text or there's at least one
  // completed attachment ready to ship — matches MessageInput's
  // "image-only message" UX. Still requires uploads to be settled and
  // an agent to be selected.
  const hasReadyAttachment = uploadingFiles.some(
    (f) => f.status === "completed",
  );
  const canSubmit =
    (prompt.trim().length > 0 || hasReadyAttachment) &&
    !isSubmitting &&
    !isUploading &&
    !!selectedAgent;
  const activeSubscription = billingSummary.data?.subscription ?? null;
  const isSubscribed = !!activeSubscription;
  const currentPlanLabel =
    activeSubscription?.product.name || t("dashboardPlan");
  const subscriptionPlanLabel = activeSubscription?.product.name ?? null;
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
    setSelectedAgentUserId((current) => {
      if (current && agents.some((agent) => agent.userId === current)) {
        return current;
      }

      return pickDefaultAgent(agents)?.userId ?? null;
    });
  }, [agents]);

  // Reset session model override when the user switches agents — each agent
  // should present its own default model until the user picks one again.
  useEffect(() => {
    setSessionModelOverride(null);
  }, [selectedAgentUserId]);

  const insertTemplate = (
    templateKey: ParseKeys<["navigation", "message"]>,
  ) => {
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

  const handleSubmit = async () => {
    const draft = prompt.trim();
    if (!selectedAgent) return;
    // Defensive: canSubmit already gates this, but if a stray Enter slips
    // through while uploads are in-flight we'd otherwise drop the file
    // references. Mirror MessageInput's early-return.
    if (isUploading) return;

    const attachments = getAttachments();
    // Empty draft is OK only when at least one attachment is ready —
    // server-side ValidateIf relaxes IsNotEmpty under the same condition.
    if (!draft && attachments.length === 0) return;

    try {
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
      });

      setPrompt("");
      clearFiles();
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

  return (
    <main className="dashboard-landing h-full overflow-y-auto">
      <div className="dashboard-landing-shell min-h-full">
        <div className="flex min-h-full w-full flex-col px-4 pb-8 pt-4 sm:px-6 sm:pb-10 lg:px-8">
          <DashboardHeader
            agents={agents}
            selectedAgentUserId={selectedAgent?.userId ?? null}
            creditsLabel={creditsLabel}
            isCreditsLow={isCreditsLow}
            subscriptionPlanLabel={subscriptionPlanLabel}
            onSelectAgent={setSelectedAgentUserId}
          />

          <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col items-center justify-center gap-8 pb-8 pt-14 sm:gap-10 sm:pb-12 sm:pt-16 lg:pb-[4.5rem] lg:pt-20">
            {!isSubscribed ? (
              <DashboardPlanBadge planLabel={currentPlanLabel} />
            ) : null}

            <div className="mx-auto flex w-full max-w-[45.5rem] flex-col items-center gap-8 sm:gap-10">
              <h1 className="dashboard-landing-title text-center text-[clamp(1.6rem,2.8vw,2.5rem)] leading-[1.05] text-[#2d2924]">
                {t("dashboardTitle")}
              </h1>

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
                  onChange={(event) => setPrompt(event.target.value)}
                  onCompositionStart={handlePromptCompositionStart}
                  onCompositionEnd={handlePromptCompositionEnd}
                  onKeyDown={handlePromptKeyDown}
                  rows={3}
                  placeholder={t("dashboardPromptPlaceholder")}
                  className="min-h-[4rem] resize-none border-0 bg-transparent px-2.5 py-1.5 text-[0.82rem] leading-[1.2rem] text-[#3f3a35] shadow-none placeholder:text-[#c8d5e6] focus-visible:border-transparent focus-visible:ring-0 md:text-[0.82rem]"
                />

                {uploadingFiles.length > 0 && (
                  <div className="-mx-2 -mt-1">
                    <AttachmentPreview
                      files={uploadingFiles}
                      onRemove={removeFile}
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

                    {DASHBOARD_ACTION_CHIPS.map((chip) => (
                      <DashboardActionChip
                        key={chip.key}
                        label={t(chip.key)}
                        icon={chip.icon}
                        className={chip.className}
                        onClick={() => insertTemplate(chip.templateKey)}
                      />
                    ))}
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
                      className="dashboard-composer-send h-[2.375rem] w-[2.375rem] rounded-full bg-[#818894] text-white shadow-none hover:bg-[#727885] disabled:bg-[#ddd7cf] disabled:text-[#a2998d]"
                    >
                      {isSubmitting ? (
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
