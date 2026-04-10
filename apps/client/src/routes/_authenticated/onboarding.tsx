import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/query-client";
import { usePostHogAnalytics } from "@/analytics/posthog/hooks";
import { openExternalUrl } from "@/lib/open-external-url";
import { getErrorMessage } from "@/services/http";
import {
  useCreateInvitation,
  useUserWorkspaces,
  useWorkspaceInvitations,
} from "@/hooks/useWorkspace";
import {
  useCompleteWorkspaceOnboarding,
  useGenerateOnboardingAgents,
  useGenerateOnboardingChannels,
  useGenerateOnboardingTasks,
  useOnboardingRoles,
  useUpdateWorkspaceOnboarding,
  useWorkspaceOnboarding,
} from "@/hooks/useWorkspaceOnboarding";
import {
  useCreateWorkspaceBillingCheckout,
  useWorkspaceBillingProducts,
} from "@/hooks/useWorkspaceBilling";
import { workspaceActions, useSelectedWorkspaceId } from "@/stores";
import { cn } from "@/lib/utils";
import type {
  BillingProduct,
  OnboardingAgentsSelection,
  OnboardingChannelDraft,
  OnboardingChannelsSelection,
  OnboardingGeneratedTask,
  OnboardingInviteSelection,
  OnboardingPlanSelection,
  OnboardingRoleCatalogItem,
  OnboardingRoleSelection,
  OnboardingTasksSelection,
  WorkspaceInvitation,
  WorkspaceOnboardingStepData,
} from "@/types/workspace";

type OnboardingSearch = {
  step?: number;
  result?: "success" | "cancel";
  workspaceId?: string;
};

const TOTAL_STEPS = 6;
const DEFAULT_INVITATION_OPTIONS = {
  role: "member" as const,
  maxUses: 1000,
  expiresInDays: 100,
};
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;
const CATEGORY_ORDER = [
  "recommended",
  "finance",
  "legal",
  "consulting",
  "marketing",
  "sales",
  "ecommerce",
  "creator",
  "influencer",
  "design",
  "engineering",
  "ai",
  "education",
  "business_functions",
] as const;

export const Route = createFileRoute("/_authenticated/onboarding")({
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => ({
    step:
      typeof search.step === "string" && Number.isFinite(Number(search.step))
        ? Number(search.step)
        : undefined,
    result:
      search.result === "success" || search.result === "cancel"
        ? search.result
        : undefined,
    workspaceId:
      typeof search.workspaceId === "string" ? search.workspaceId : undefined,
  }),
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { t: rawT, i18n } = useTranslation("onboarding");
  const t = rawT as unknown as TranslateFn;
  const selectedWorkspaceId = useSelectedWorkspaceId();
  const { data: workspaces = [] } = useUserWorkspaces();

  const workspaceId =
    search.workspaceId ?? selectedWorkspaceId ?? workspaces[0]?.id ?? undefined;
  const workspace =
    workspaces.find((item) => item.id === workspaceId) ?? workspaces[0] ?? null;
  const language = (i18n.resolvedLanguage ?? i18n.language).startsWith("en")
    ? "en"
    : "zh";

  const onboardingQuery = useWorkspaceOnboarding(workspaceId);
  const rolesQuery = useOnboardingRoles(language);
  const invitationsQuery = useWorkspaceInvitations(workspaceId);
  const billingProductsQuery = useWorkspaceBillingProducts(workspaceId);

  const updateOnboarding = useUpdateWorkspaceOnboarding(workspaceId);
  const generateTasks = useGenerateOnboardingTasks(workspaceId);
  const generateChannels = useGenerateOnboardingChannels(workspaceId);
  const generateAgents = useGenerateOnboardingAgents(workspaceId);
  const createInvitation = useCreateInvitation(workspaceId);
  const checkout = useCreateWorkspaceBillingCheckout(workspaceId);
  const completeOnboarding = useCompleteWorkspaceOnboarding(workspaceId);
  const { capture } = usePostHogAnalytics();

  const [currentStep, setCurrentStep] = useState(1);
  const [roleState, setRoleState] = useState<OnboardingRoleSelection>({
    description: "",
    selectedRoleId: null,
    selectedRoleSlug: null,
    selectedRoleLabel: null,
    selectedTag: "recommended",
    selectedRoleCategoryKey: null,
  });
  const [tasksState, setTasksState] = useState<OnboardingTasksSelection>({
    generatedTasks: [],
    selectedTaskIds: [],
    customTask: "",
  });
  const [channelsState, setChannelsState] =
    useState<OnboardingChannelsSelection>({
      channelDrafts: [],
      activeChannelId: null,
    });
  const [agentsState, setAgentsState] = useState<OnboardingAgentsSelection>({});
  const [inviteState, setInviteState] = useState<OnboardingInviteSelection>({});
  const [planState, setPlanState] = useState<OnboardingPlanSelection>({
    selectedPlan: null,
    checkoutCompleted: false,
  });
  const [pageError, setPageError] = useState("");
  const [flashTone, setFlashTone] = useState<"success" | "warning" | null>(
    null,
  );
  const [flashMessage, setFlashMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [editingChildAgentId, setEditingChildAgentId] = useState("");

  const initializedWorkspaceIdRef = useRef<string | null>(null);
  const taskSignatureRef = useRef("");
  const channelSignatureRef = useRef("");
  const agentSignatureRef = useRef("");
  const taskInFlightSignatureRef = useRef("");
  const channelInFlightSignatureRef = useRef("");
  const agentInFlightSignatureRef = useRef("");
  const inviteCreationRequestedRef = useRef<string | null>(null);
  const checkoutResultRef = useRef<string | null>(null);

  useEffect(() => {
    taskInFlightSignatureRef.current = "";
    channelInFlightSignatureRef.current = "";
    agentInFlightSignatureRef.current = "";
    inviteCreationRequestedRef.current = null;
    setEditingChildAgentId("");
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId && workspaceId !== selectedWorkspaceId) {
      workspaceActions.setSelectedWorkspaceId(workspaceId);
    }
  }, [selectedWorkspaceId, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    if (onboardingQuery.isLoading) return;

    if (!onboardingQuery.data) {
      setPageError(t("errors.loadFailed"));
      return;
    }

    const shouldInitialize =
      initializedWorkspaceIdRef.current !== workspaceId ||
      initializedWorkspaceIdRef.current === null;

    if (!shouldInitialize) {
      return;
    }

    initializedWorkspaceIdRef.current = workspaceId;
    setPageError("");

    const stepData = onboardingQuery.data.stepData ?? {};
    const initialStep = clampStep(
      search.step ?? onboardingQuery.data.currentStep,
    );

    const nextRole: OnboardingRoleSelection = {
      description: stepData.role?.description ?? "",
      selectedRoleId: stepData.role?.selectedRoleId ?? null,
      selectedRoleSlug: stepData.role?.selectedRoleSlug ?? null,
      selectedRoleLabel: stepData.role?.selectedRoleLabel ?? null,
      selectedTag:
        normalizeTag(
          stepData.role?.selectedTag,
          stepData.role?.selectedRoleCategoryKey,
        ) ?? "recommended",
      selectedRoleCategoryKey: stepData.role?.selectedRoleCategoryKey ?? null,
    };
    const nextTasks: OnboardingTasksSelection = {
      generatedTasks: stepData.tasks?.generatedTasks ?? [],
      selectedTaskIds: stepData.tasks?.selectedTaskIds ?? [],
      customTask: stepData.tasks?.customTask ?? "",
    };
    const nextChannels: OnboardingChannelsSelection = {
      channelDrafts: stepData.channels?.channelDrafts ?? [],
      activeChannelId:
        stepData.channels?.activeChannelId ??
        stepData.channels?.channelDrafts?.[0]?.id ??
        null,
    };
    const nextAgents: OnboardingAgentsSelection = {
      main: stepData.agents?.main,
      children: stepData.agents?.children ?? [],
    };
    const nextInvite: OnboardingInviteSelection = {
      invitationCode: stepData.invite?.invitationCode,
      invitationUrl: stepData.invite?.invitationUrl,
    };
    const nextPlan: OnboardingPlanSelection = {
      selectedPlan: stepData.plan?.selectedPlan ?? null,
      checkoutCompleted: stepData.plan?.checkoutCompleted ?? false,
    };

    setCurrentStep(initialStep);
    setRoleState(nextRole);
    setTasksState(nextTasks);
    setChannelsState(nextChannels);
    setAgentsState(nextAgents);
    setInviteState(nextInvite);
    setPlanState(nextPlan);
    setEditingChildAgentId("");

    taskSignatureRef.current = buildRoleSignature(nextRole, language);
    channelSignatureRef.current = buildTaskSignature(
      nextRole,
      nextTasks,
      language,
    );
    agentSignatureRef.current = buildTaskSignature(
      nextRole,
      nextTasks,
      language,
    );
  }, [
    language,
    onboardingQuery.data,
    onboardingQuery.isLoading,
    search.step,
    t,
    workspaceId,
  ]);

  const availableRoles = rolesQuery.data ?? [];
  const filteredRoles =
    roleState.selectedTag === "recommended"
      ? availableRoles.filter((role) => role.featured)
      : availableRoles.filter(
          (role) => role.categoryKey === roleState.selectedTag,
        );
  const activeChannel =
    channelsState.channelDrafts?.find(
      (channel) => channel.id === channelsState.activeChannelId,
    ) ?? channelsState.channelDrafts?.[0];
  const selectedTaskTitles =
    tasksState.generatedTasks
      ?.filter((task) => tasksState.selectedTaskIds?.includes(task.id))
      .map((task) => task.title) ?? [];
  const validInvitation = findValidInvitation(invitationsQuery.data ?? []);
  const planProducts = billingProductsQuery.data ?? [];

  const canContinueFromStepOne = Boolean(
    roleState.description?.trim() || roleState.selectedRoleId,
  );
  const canContinueFromStepTwo = Boolean(
    (tasksState.selectedTaskIds?.length ?? 0) > 0 ||
    tasksState.customTask?.trim(),
  );
  const canContinueFromStepThree = Boolean(
    (channelsState.channelDrafts?.length ?? 0) > 0,
  );

  const buildStepData = useEffectEvent(
    (overrides: Partial<WorkspaceOnboardingStepData> = {}) => ({
      role: overrides.role ?? roleState,
      tasks: overrides.tasks ?? tasksState,
      channels: overrides.channels ?? channelsState,
      agents: overrides.agents ?? agentsState,
      invite: overrides.invite ?? inviteState,
      plan: overrides.plan ?? planState,
    }),
  );

  const persistProgress = useEffectEvent(
    async ({
      nextStep = currentStep,
      status,
      overrides,
    }: {
      nextStep?: number;
      status?: "in_progress" | "completed";
      overrides?: Partial<WorkspaceOnboardingStepData>;
    } = {}) => {
      if (!workspaceId) {
        return null;
      }

      const payload = {
        currentStep: nextStep,
        ...(status ? { status } : {}),
        stepData: buildStepData(overrides),
      };

      const backoff = [0, 300, 1200];
      let lastError: unknown = null;

      for (const delayMs of backoff) {
        if (delayMs > 0) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, delayMs);
          });
        }

        try {
          const updated = await updateOnboarding.mutateAsync(payload);
          setPageError("");
          return updated;
        } catch (error) {
          lastError = error;
        }
      }

      setPageError(getErrorMessage(lastError, t("errors.saveFailed")));
      throw lastError;
    },
  );

  const ensureTasks = useEffectEvent(async (force = false) => {
    if (!workspaceId || !canContinueFromStepOne) {
      return;
    }

    const signature = buildRoleSignature(roleState, language);
    if (taskInFlightSignatureRef.current === signature) {
      return;
    }
    if (
      !force &&
      taskSignatureRef.current === signature &&
      (tasksState.generatedTasks?.length ?? 0) > 0
    ) {
      return;
    }

    setPageError("");
    taskInFlightSignatureRef.current = signature;

    try {
      const response = await generateTasks.mutateAsync({
        role: roleState,
        lang: language,
      });

      if (taskInFlightSignatureRef.current !== signature) {
        return;
      }

      const nextTasks: OnboardingTasksSelection = {
        generatedTasks: response.tasks ?? [],
        selectedTaskIds: [],
        customTask: tasksState.customTask ?? "",
      };
      const nextChannels: OnboardingChannelsSelection = {
        channelDrafts: [],
        activeChannelId: null,
      };
      const nextAgents: OnboardingAgentsSelection = {};

      setTasksState(nextTasks);
      setChannelsState(nextChannels);
      setAgentsState(nextAgents);
      taskSignatureRef.current = signature;
      channelSignatureRef.current = "";
      agentSignatureRef.current = "";

      await persistProgress({
        nextStep: 2,
        overrides: {
          tasks: nextTasks,
          channels: nextChannels,
          agents: nextAgents,
        },
      });
    } finally {
      if (taskInFlightSignatureRef.current === signature) {
        taskInFlightSignatureRef.current = "";
      }
    }
  });

  const ensureChannels = useEffectEvent(async (force = false) => {
    if (!workspaceId || !canContinueFromStepTwo) {
      return;
    }

    const signature = buildTaskSignature(roleState, tasksState, language);
    if (channelInFlightSignatureRef.current === signature) {
      return;
    }
    if (
      !force &&
      channelSignatureRef.current === signature &&
      (channelsState.channelDrafts?.length ?? 0) >= 4
    ) {
      return;
    }

    setPageError("");
    channelInFlightSignatureRef.current = signature;

    try {
      const response = await generateChannels.mutateAsync({
        role: roleState,
        tasks: tasksState,
        lang: language,
      });

      if (channelInFlightSignatureRef.current !== signature) {
        return;
      }

      const nextChannels: OnboardingChannelsSelection = {
        channelDrafts: response.channels ?? [],
        activeChannelId: response.channels?.[0]?.id ?? null,
      };
      const nextAgents: OnboardingAgentsSelection = {};

      setChannelsState(nextChannels);
      setAgentsState(nextAgents);
      channelSignatureRef.current = signature;
      agentSignatureRef.current = "";

      await persistProgress({
        nextStep: 3,
        overrides: {
          channels: nextChannels,
          agents: nextAgents,
        },
      });
    } finally {
      if (channelInFlightSignatureRef.current === signature) {
        channelInFlightSignatureRef.current = "";
      }
    }
  });

  const ensureAgents = useEffectEvent(async (force = false) => {
    if (!workspaceId || !canContinueFromStepTwo) {
      return;
    }

    const signature = buildTaskSignature(roleState, tasksState, language);
    if (agentInFlightSignatureRef.current === signature) {
      return;
    }
    if (
      !force &&
      agentSignatureRef.current === signature &&
      Boolean(agentsState.main) &&
      (agentsState.children?.length ?? 0) > 0
    ) {
      return;
    }

    setPageError("");
    agentInFlightSignatureRef.current = signature;

    try {
      const response = await generateAgents.mutateAsync({
        role: roleState,
        tasks: tasksState,
        lang: language,
      });

      if (agentInFlightSignatureRef.current !== signature) {
        return;
      }

      const nextAgents: OnboardingAgentsSelection = {
        main: response.agents?.main,
        children: response.agents?.children ?? [],
      };

      setAgentsState(nextAgents);
      setEditingChildAgentId("");
      agentSignatureRef.current = signature;

      await persistProgress({
        nextStep: 4,
        overrides: {
          agents: nextAgents,
        },
      });
    } finally {
      if (agentInFlightSignatureRef.current === signature) {
        agentInFlightSignatureRef.current = "";
      }
    }
  });

  useEffect(() => {
    if (!workspaceId) return;

    if (currentStep === 2 && canContinueFromStepOne) {
      void ensureTasks(false).catch((error) => {
        setPageError(getErrorMessage(error, t("errors.saveFailed")));
      });
    }

    if (currentStep === 3 && canContinueFromStepTwo) {
      void ensureChannels(false).catch((error) => {
        setPageError(getErrorMessage(error, t("errors.saveFailed")));
      });
    }

    if (currentStep === 4 && canContinueFromStepTwo) {
      void ensureAgents(false).catch((error) => {
        setPageError(getErrorMessage(error, t("errors.saveFailed")));
      });
    }
  }, [
    canContinueFromStepOne,
    canContinueFromStepTwo,
    currentStep,
    ensureAgents,
    ensureChannels,
    ensureTasks,
    t,
    workspaceId,
  ]);

  useEffect(() => {
    if (currentStep !== 5) return;
    if (!workspaceId) return;

    const syncInvite = async () => {
      if (validInvitation) {
        inviteCreationRequestedRef.current = null;
        const nextInvite = {
          invitationCode: validInvitation.code,
          invitationUrl: validInvitation.url,
        };

        if (
          inviteState.invitationCode !== nextInvite.invitationCode ||
          inviteState.invitationUrl !== nextInvite.invitationUrl
        ) {
          setInviteState(nextInvite);
          await persistProgress({
            nextStep: 5,
            overrides: { invite: nextInvite },
          });
        }
        return;
      }

      if (inviteState.invitationCode && inviteState.invitationUrl) {
        return;
      }

      if (
        inviteCreationRequestedRef.current === workspaceId ||
        invitationsQuery.isLoading ||
        invitationsQuery.isFetching ||
        createInvitation.isPending
      ) {
        return;
      }

      inviteCreationRequestedRef.current = workspaceId;

      try {
        const invitation = await createInvitation.mutateAsync(
          DEFAULT_INVITATION_OPTIONS,
        );
        capture("member_invited", {
          workspace_id: workspaceId,
        });
        const nextInvite = {
          invitationCode: invitation.code,
          invitationUrl: invitation.url,
        };
        setInviteState(nextInvite);
        await persistProgress({
          nextStep: 5,
          overrides: { invite: nextInvite },
        });
      } catch (error) {
        inviteCreationRequestedRef.current = null;
        throw error;
      }
    };

    void syncInvite().catch((error) => {
      setPageError(getErrorMessage(error, t("errors.saveFailed")));
    });
  }, [
    capture,
    createInvitation,
    currentStep,
    invitationsQuery.isFetching,
    invitationsQuery.isLoading,
    inviteState.invitationCode,
    inviteState.invitationUrl,
    persistProgress,
    t,
    validInvitation,
    workspaceId,
  ]);

  useEffect(() => {
    if (search.result == null || checkoutResultRef.current === search.result) {
      return;
    }

    checkoutResultRef.current = search.result;

    const nextPlan: OnboardingPlanSelection = {
      selectedPlan: planState.selectedPlan ?? null,
      checkoutCompleted: search.result === "success",
    };

    setPlanState(nextPlan);
    setFlashTone(search.result === "success" ? "success" : "warning");
    setFlashMessage(
      search.result === "success" ? t("plan.success") : t("plan.cancel"),
    );

    void persistProgress({
      nextStep: 6,
      overrides: { plan: nextPlan },
    }).finally(() => {
      navigate({
        to: "/onboarding",
        replace: true,
        search: workspaceId ? { step: 6, workspaceId } : { step: 6 },
      });
    });
  }, [
    navigate,
    persistProgress,
    planState.selectedPlan,
    search.result,
    t,
    workspaceId,
  ]);

  const goBack = async () => {
    if (currentStep === 1) {
      return;
    }

    const nextStep = currentStep - 1;
    await persistProgress({ nextStep });
    setCurrentStep(nextStep);
  };

  const handleContinue = async () => {
    if (!workspaceId) {
      setPageError(t("errors.workspaceRequired"));
      return;
    }

    if (currentStep === 1 && !canContinueFromStepOne) {
      setPageError(t("errors.roleRequired"));
      return;
    }

    if (currentStep === 2 && !canContinueFromStepTwo) {
      setPageError(t("errors.taskRequired"));
      return;
    }

    if (currentStep === 3 && !canContinueFromStepThree) {
      setPageError(t("errors.channelRequired"));
      return;
    }

    setPageError("");

    if (currentStep === TOTAL_STEPS) {
      setIsFinishing(true);
      try {
        await persistProgress({ nextStep: 6, status: "completed" });
        const result = await completeOnboarding.mutateAsync({ lang: language });
        capture("onboarding_completed", {
          workspace_id: workspaceId,
        });
        queryClient.setQueryData(["workspace-onboarding", workspaceId], result);

        if (result.status === "failed") {
          setPageError(t("errors.provisionFailed"));
          return;
        }

        await queryClient.invalidateQueries({ queryKey: ["user-workspaces"] });
        await navigate({ to: "/" });
      } finally {
        setIsFinishing(false);
      }
      return;
    }

    const nextStep = currentStep + 1;
    await persistProgress({ nextStep });
    capture("onboarding_step_completed", {
      step: currentStep,
      workspace_id: workspaceId,
    });
    setCurrentStep(nextStep);
  };

  const handleCheckout = async (product: BillingProduct) => {
    if (!workspaceId) {
      return;
    }

    const nextPlan: OnboardingPlanSelection = {
      selectedPlan: product.stripePriceId,
      checkoutCompleted: false,
    };

    setPlanState(nextPlan);
    await persistProgress({
      nextStep: 6,
      overrides: { plan: nextPlan },
    });

    try {
      const response = await checkout.mutateAsync({
        priceId: product.stripePriceId,
        type: product.type ?? "subscription",
        view: "plans",
        successPath: "/onboarding?step=6&result=success",
        cancelPath: "/onboarding?step=6&result=cancel",
      });
      await openExternalUrl(response.checkoutUrl);
    } catch (error) {
      setPageError(getErrorMessage(error, t("errors.checkoutFailed")));
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteState.invitationUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteState.invitationUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setPageError(getErrorMessage(error, t("errors.copyFailed")));
    }
  };

  const retryProvisioning = async () => {
    if (!workspaceId) {
      return;
    }

    setIsFinishing(true);
    try {
      const result = await completeOnboarding.mutateAsync({ lang: language });
      queryClient.setQueryData(["workspace-onboarding", workspaceId], result);
      if (result.status === "provisioned") {
        await navigate({ to: "/" });
      } else {
        setPageError(t("errors.provisionFailed"));
      }
    } finally {
      setIsFinishing(false);
    }
  };

  const onboarding = onboardingQuery.data;

  if (!workspaceId) {
    return (
      <StatusScene
        title={t("errors.workspaceRequired")}
        description={t("welcome")}
        actionLabel={t("actions.back")}
        onAction={() => navigate({ to: "/" })}
      />
    );
  }

  if (
    onboardingQuery.isLoading ||
    initializedWorkspaceIdRef.current !== workspaceId
  ) {
    return (
      <StatusScene title={t("eyebrow")} description={t("welcome")} loading />
    );
  }

  if (
    onboarding?.status === "provisioning" ||
    (isFinishing && completeOnboarding.isPending)
  ) {
    return (
      <StatusScene
        title={t("status.provisioningTitle")}
        description={t("status.provisioningDescription")}
        loading
      />
    );
  }

  if (onboarding?.status === "failed") {
    return (
      <StatusScene
        title={t("status.failedTitle")}
        description={pageError || t("status.failedDescription")}
        actionLabel={t("actions.retryProvision")}
        onAction={() => {
          void retryProvisioning();
        }}
        loading={isFinishing}
      />
    );
  }

  const stepTitle = t(`steps.${currentStep}.title`);
  const stepDescription = t(`steps.${currentStep}.description`);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#e9f2ff,transparent_30%),radial-gradient(circle_at_bottom_right,#f8efe5,transparent_24%),#eef2f7] px-6 py-10">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
        className={cn(
          "relative grid w-full max-w-[1240px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[36px] border border-slate-200/90 bg-white/90 shadow-[0_24px_64px_rgba(64,88,122,0.08),0_6px_18px_rgba(64,88,122,0.06)] backdrop-blur lg:grid-rows-none",
          currentStep === 6
            ? "h-[min(720px,calc(100dvh-48px))] max-h-[calc(100dvh-48px)] lg:grid-cols-[minmax(320px,0.84fr)_minmax(520px,1.16fr)]"
            : "h-[min(780px,calc(100dvh-80px))] max-h-[calc(100dvh-80px)] lg:grid-cols-[minmax(320px,0.84fr)_minmax(520px,1.16fr)]",
        )}
      >
        {currentStep > 1 && (
          <div className="absolute right-7 top-7 z-10 sm:right-9 sm:top-9 lg:hidden">
            <GhostButton
              onClick={() => {
                void goBack();
              }}
              disabled={isFinishing || generateTasks.isPending}
            >
              <ArrowLeft className="h-4 w-4" />
              {t("actions.back")}
            </GhostButton>
          </div>
        )}

        <aside className="min-h-0 overflow-y-auto border-b border-slate-200/90 bg-[radial-gradient(circle_at_top_left,rgba(26,115,232,0.16),transparent_38%),linear-gradient(180deg,rgba(248,250,255,0.96),rgba(240,244,251,0.88))] p-7 pt-24 sm:p-10 sm:pt-28 lg:border-b-0 lg:border-r lg:p-12 lg:pt-12">
          <div className="flex h-full flex-col gap-7">
            <span className="inline-flex w-fit items-center rounded-full bg-[rgba(26,115,232,0.1)] px-3 py-2 text-[0.76rem] font-extrabold uppercase tracking-[0.14em] text-[#1a73e8]">
              {String(currentStep).padStart(2, "0")}
            </span>

            <div className="grid gap-3">
              <h1 className="max-w-[9ch] text-[clamp(3.2rem,4.8vw,5.25rem)] font-bold leading-[1.02] tracking-[-0.065em] text-slate-900">
                {stepTitle}
              </h1>
              <p className="max-w-[30ch] text-[1.02rem] font-medium leading-[1.72] text-slate-600/90">
                {stepDescription}
              </p>
            </div>

            {currentStep === 6 && (
              <div className="mt-2 grid max-w-[320px] gap-2 rounded-[24px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(243,247,253,0.84))] p-5 text-slate-700 shadow-[0_18px_42px_rgba(100,116,139,0.1)]">
                <strong className="text-base text-slate-800">
                  {workspace?.name ?? t("workspaceFallback")}
                </strong>
                <p className="text-sm leading-6 text-slate-600/85">
                  {t("plan.note")}
                </p>
                <span className="text-sm leading-6 text-slate-500">
                  {t("welcome")}
                </span>
              </div>
            )}

            {currentStep > 1 && (
              <div className="mt-auto hidden lg:flex">
                <GhostButton
                  onClick={() => {
                    void goBack();
                  }}
                  disabled={isFinishing || generateTasks.isPending}
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t("actions.back")}
                </GhostButton>
              </div>
            )}
          </div>
        </aside>

        <div className="min-h-0 overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(251,252,255,0.98))] p-7 sm:p-10 lg:p-12">
          <div
            className={cn(
              "mx-auto flex h-full w-full flex-col overflow-hidden",
              currentStep === 6
                ? "max-w-[1040px] justify-center"
                : "max-w-[760px] justify-center",
            )}
          >
            {(pageError || flashMessage) && (
              <div
                className={cn(
                  "mb-5 rounded-[24px] border px-5 py-4 text-sm leading-6",
                  pageError &&
                    "border-destructive/20 bg-destructive/10 text-destructive",
                  !pageError &&
                    flashTone === "success" &&
                    "border-emerald-200 bg-emerald-50 text-emerald-700",
                  !pageError &&
                    flashTone === "warning" &&
                    "border-amber-200 bg-amber-50 text-amber-700",
                )}
              >
                {pageError || flashMessage}
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="h-full overflow-y-auto pr-1"
              >
                {currentStep === 1 && (
                  <StepOne
                    t={t}
                    roleState={roleState}
                    roles={filteredRoles}
                    allRoles={availableRoles}
                    canContinue={canContinueFromStepOne}
                    onContinue={() => {
                      void handleContinue();
                    }}
                    onDescriptionChange={(value) =>
                      setRoleState((current) => ({
                        ...current,
                        description: value,
                      }))
                    }
                    onSelectTag={(tag) =>
                      setRoleState((current) => ({
                        ...current,
                        selectedTag: tag,
                      }))
                    }
                    onSelectRole={(role) =>
                      setRoleState((current) => ({
                        ...current,
                        selectedRoleId:
                          current.selectedRoleId === role.id ? null : role.id,
                        selectedRoleSlug:
                          current.selectedRoleId === role.id ? null : role.slug,
                        selectedRoleLabel:
                          current.selectedRoleId === role.id
                            ? null
                            : role.label,
                        selectedRoleCategoryKey:
                          current.selectedRoleId === role.id
                            ? null
                            : String(role.categoryKey),
                        selectedTag: normalizeTag(
                          current.selectedTag,
                          current.selectedRoleId === role.id
                            ? null
                            : String(role.categoryKey),
                        ),
                      }))
                    }
                  />
                )}

                {currentStep === 2 && (
                  <StepTwo
                    t={t}
                    tasks={tasksState.generatedTasks ?? []}
                    selectedTaskIds={tasksState.selectedTaskIds ?? []}
                    customTask={tasksState.customTask ?? ""}
                    loading={generateTasks.isPending}
                    canContinue={canContinueFromStepTwo}
                    onContinue={() => {
                      void handleContinue();
                    }}
                    onToggleTask={(taskId) =>
                      setTasksState((current) => {
                        const selected = new Set(current.selectedTaskIds ?? []);
                        if (selected.has(taskId)) {
                          selected.delete(taskId);
                        } else {
                          selected.add(taskId);
                        }
                        return {
                          ...current,
                          selectedTaskIds: [...selected],
                        };
                      })
                    }
                    onCustomTaskChange={(value) =>
                      setTasksState((current) => ({
                        ...current,
                        customTask: value,
                      }))
                    }
                    onRegenerate={() => {
                      void ensureTasks(true);
                    }}
                  />
                )}

                {currentStep === 3 && (
                  <StepThree
                    t={t}
                    workspaceName={workspace?.name ?? t("workspaceFallback")}
                    roleLabel={
                      roleState.selectedRoleLabel ?? roleState.description ?? ""
                    }
                    channels={channelsState.channelDrafts ?? []}
                    activeChannelId={channelsState.activeChannelId ?? null}
                    loading={generateChannels.isPending}
                    canContinue={canContinueFromStepThree}
                    onContinue={() => {
                      void handleContinue();
                    }}
                    onSelectChannel={(channelId) =>
                      setChannelsState((current) => ({
                        ...current,
                        activeChannelId: channelId,
                      }))
                    }
                    onChangeChannelName={(channelId, name) =>
                      setChannelsState((current) => ({
                        ...current,
                        channelDrafts:
                          current.channelDrafts?.map((channel) =>
                            channel.id === channelId
                              ? { ...channel, name }
                              : channel,
                          ) ?? [],
                      }))
                    }
                    onRegenerate={() => {
                      void ensureChannels(true);
                    }}
                    selectedTasks={selectedTaskTitles}
                    customTask={tasksState.customTask ?? ""}
                    activeChannel={activeChannel}
                  />
                )}

                {currentStep === 4 && (
                  <StepFour
                    t={t}
                    agents={agentsState}
                    loading={generateAgents.isPending}
                    editingChildAgentId={editingChildAgentId}
                    onContinue={() => {
                      void handleContinue();
                    }}
                    onRegenerate={() => {
                      void ensureAgents(true);
                    }}
                    onToggleChildEdit={(agentId) =>
                      setEditingChildAgentId((current) =>
                        current === agentId ? "" : agentId,
                      )
                    }
                    onChangeMainDescription={(value) =>
                      setAgentsState((current) => ({
                        ...current,
                        main: current.main
                          ? { ...current.main, description: value }
                          : current.main,
                      }))
                    }
                    onChangeChildName={(agentId, name) =>
                      setAgentsState((current) => ({
                        ...current,
                        children:
                          current.children?.map((agent) =>
                            agent.id === agentId ? { ...agent, name } : agent,
                          ) ?? [],
                      }))
                    }
                  />
                )}

                {currentStep === 5 && (
                  <StepFive
                    t={t}
                    inviteUrl={inviteState.invitationUrl}
                    copied={copied}
                    loading={
                      invitationsQuery.isLoading || createInvitation.isPending
                    }
                    onCopy={handleCopyInvite}
                    onContinue={() => {
                      void handleContinue();
                    }}
                  />
                )}

                {currentStep === 6 && (
                  <StepSix
                    t={t}
                    products={planProducts}
                    selectedPlanId={planState.selectedPlan ?? null}
                    checkoutCompleted={Boolean(planState.checkoutCompleted)}
                    loading={billingProductsQuery.isLoading}
                    checkoutPending={checkout.isPending || isFinishing}
                    onSelectPlan={(product) =>
                      setPlanState((current) => ({
                        ...current,
                        selectedPlan: product.stripePriceId,
                      }))
                    }
                    onCheckout={(product) => {
                      void handleCheckout(product);
                    }}
                    onFinish={() => {
                      void handleContinue();
                    }}
                    onContinueWithoutPlan={() => {
                      void handleContinue();
                    }}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.section>
    </main>
  );
}

function StepOne({
  t,
  roleState,
  roles,
  allRoles,
  canContinue,
  onContinue,
  onDescriptionChange,
  onSelectTag,
  onSelectRole,
}: {
  t: TranslateFn;
  roleState: OnboardingRoleSelection;
  roles: OnboardingRoleCatalogItem[];
  allRoles: OnboardingRoleCatalogItem[];
  canContinue: boolean;
  onContinue: () => void;
  onDescriptionChange: (value: string) => void;
  onSelectTag: (tag: string) => void;
  onSelectRole: (role: OnboardingRoleCatalogItem) => void;
}) {
  const tags = CATEGORY_ORDER.filter((tag) =>
    tag === "recommended"
      ? allRoles.some((role) => role.featured)
      : allRoles.some((role) => role.categoryKey === tag),
  );

  const labelByTag = (tag: string) => {
    if (tag === "recommended") {
      return t("role.featured");
    }

    return allRoles.find((role) => role.categoryKey === tag)?.category ?? tag;
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-5">
        <div className="grid gap-3">
          <h2 className="text-[1.15rem] font-bold text-slate-900">
            {t("role.inputLabel")}
          </h2>
          <Input
            value={roleState.description ?? ""}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder={t("role.inputPlaceholder")}
            className="h-auto rounded-[24px] border-slate-200 bg-white px-6 py-6 text-[1.05rem] shadow-none transition-[border-color,box-shadow,transform] focus-visible:border-[#1a73e8]/70 focus-visible:ring-[5px] focus-visible:ring-[#1a73e8]/12"
          />
        </div>

        <Divider label={t("role.or")} />

        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2.5">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onSelectTag(tag)}
                className={cn(
                  "rounded-full border px-4 py-3 text-sm font-bold transition-all",
                  roleState.selectedTag === tag
                    ? "border-[#1a73e8]/40 bg-[#1a73e8]/8 text-[#1a73e8]"
                    : "border-slate-200 bg-slate-50/90 text-slate-500 hover:-translate-y-0.5 hover:border-[#1a73e8]/30",
                )}
              >
                {labelByTag(tag)}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {roles.map((role, index) => {
              const selected = roleState.selectedRoleId === role.id;
              return (
                <motion.button
                  key={role.id}
                  type="button"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.26,
                    delay: Math.min(index * 0.025, 0.22),
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  onClick={() => onSelectRole(role)}
                  className={cn(
                    "grid min-h-[76px] w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-3 rounded-[24px] border bg-white px-4 py-4 text-left text-[0.92rem] font-semibold text-slate-900 transition-all",
                    selected
                      ? "border-[#1a73e8]/55 bg-[#1a73e8]/8 text-[#1a73e8]"
                      : "border-slate-200 hover:-translate-y-0.5 hover:border-[#1a73e8]/35 hover:shadow-[0_10px_24px_rgba(26,115,232,0.12)]",
                  )}
                >
                  <span className="flex h-6 w-6 items-center justify-center text-[1.1rem]">
                    {role.emoji}
                  </span>
                  <span className="line-clamp-2 leading-[1.3]">
                    {role.label}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>

      <StepActionDock>
        <ContinueButton disabled={!canContinue} onClick={onContinue}>
          {t("actions.continue")}
        </ContinueButton>
      </StepActionDock>
    </div>
  );
}

function StepTwo({
  t,
  tasks,
  selectedTaskIds,
  customTask,
  loading,
  canContinue,
  onContinue,
  onToggleTask,
  onCustomTaskChange,
  onRegenerate,
}: {
  t: TranslateFn;
  tasks: OnboardingGeneratedTask[];
  selectedTaskIds: string[];
  customTask: string;
  loading: boolean;
  canContinue: boolean;
  onContinue: () => void;
  onToggleTask: (taskId: string) => void;
  onCustomTaskChange: (value: string) => void;
  onRegenerate: () => void;
}) {
  if (loading && tasks.length === 0) {
    return (
      <GenerationState
        title={t("tasks.loadingTitle")}
        description={t("tasks.loading")}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <ActionHeader
        title={t("steps.2.title")}
        subtitle={t("steps.2.description")}
        actions={
          <GhostButton onClick={onRegenerate} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("actions.regenerate")}
          </GhostButton>
        }
      />

      <div className="grid gap-3" role="group" aria-label={t("steps.2.title")}>
        {tasks.map((task) => {
          const selected = selectedTaskIds.includes(task.id);
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onToggleTask(task.id)}
              className={cn(
                "grid w-full grid-cols-[20px_minmax(0,1fr)] items-center gap-4 rounded-[24px] border bg-white px-5 py-[18px] text-left transition-all",
                selected
                  ? "border-[#1a73e8]/50 bg-[#1a73e8]/6"
                  : "border-slate-200 hover:-translate-y-0.5 hover:border-[#1a73e8]/32 hover:shadow-[0_10px_24px_rgba(26,115,232,0.1)]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-5 w-5 rounded-full border-2 border-slate-300 transition-all",
                  selected &&
                    "border-[#1a73e8] bg-[radial-gradient(circle,#1a73e8_0_45%,transparent_50%_100%)]",
                )}
              />
              <span className="line-clamp-2 leading-[1.45] text-slate-900">
                {task.title}
              </span>
            </button>
          );
        })}
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-6 text-sm text-slate-500">
          {t("tasks.empty")}
        </div>
      ) : null}

      <Divider label={t("tasks.customDivider")} />

      <Textarea
        value={customTask}
        onChange={(event) => onCustomTaskChange(event.target.value)}
        placeholder={t("tasks.customPlaceholder")}
        className="min-h-[86px] resize-none rounded-[18px] border-slate-200 px-4 py-4 shadow-none focus-visible:border-[#1a73e8]/70 focus-visible:ring-[5px] focus-visible:ring-[#1a73e8]/12"
        rows={2}
      />

      <StepActionDock>
        <ContinueButton disabled={!canContinue} onClick={onContinue}>
          {t("actions.continue")}
        </ContinueButton>
      </StepActionDock>
    </div>
  );
}

function StepThree({
  t,
  workspaceName,
  roleLabel,
  channels,
  activeChannelId,
  activeChannel,
  selectedTasks,
  customTask,
  loading,
  canContinue,
  onContinue,
  onSelectChannel,
  onChangeChannelName,
  onRegenerate,
}: {
  t: TranslateFn;
  workspaceName: string;
  roleLabel: string;
  channels: OnboardingChannelDraft[];
  activeChannelId: string | null;
  activeChannel?: OnboardingChannelDraft;
  selectedTasks: string[];
  customTask: string;
  loading: boolean;
  canContinue: boolean;
  onContinue: () => void;
  onSelectChannel: (channelId: string) => void;
  onChangeChannelName: (channelId: string, value: string) => void;
  onRegenerate: () => void;
}) {
  if (channels.length === 0) {
    return loading ? (
      <GenerationState
        title={t("channels.loadingTitle")}
        description={t("channels.loading")}
      />
    ) : (
      <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-6 text-sm text-slate-500">
        {t("channels.loading")}
      </div>
    );
  }

  const preview = buildChannelPreviewModel({
    t,
    roleLabel,
    channels,
    activeChannel,
    selectedTasks,
    customTask,
  });

  return (
    <div className="grid gap-6">
      <ActionHeader
        title={t("steps.3.title")}
        subtitle={t("steps.3.description")}
        actions={
          <GhostButton onClick={onRegenerate} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("actions.regenerate")}
          </GhostButton>
        }
      />

      <div className="grid min-h-[520px] overflow-hidden rounded-[28px] border border-white/12 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_28%),linear-gradient(160deg,rgba(35,38,44,0.9),rgba(18,20,24,0.86))] shadow-[0_22px_48px_rgba(10,12,16,0.28)] backdrop-blur-[24px] lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="grid content-start gap-5 border-b border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.1),transparent_32%),linear-gradient(180deg,rgba(41,44,51,0.78),rgba(24,26,31,0.7))] p-5 text-white/90 backdrop-blur-[22px] lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/10 font-extrabold text-white/95">
              {workspaceName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong className="block text-sm">{workspaceName}</strong>
              <p className="m-0 text-sm text-white/65">
                {roleLabel || t("channels.sidebarTitle")}
              </p>
            </div>
          </div>

          <div className="grid gap-2.5">
            <span className="text-[0.78rem] font-extrabold uppercase tracking-[0.08em] text-white/55">
              {t("channels.sidebarTitle")}
            </span>
            <div className="grid gap-1.5">
              {channels.map((channel) => {
                const active =
                  (activeChannelId ?? channels[0]?.id) === channel.id;
                return (
                  <div
                    key={channel.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectChannel(channel.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectChannel(channel.id);
                      }
                    }}
                    className={cn(
                      "grid cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-center gap-1.5 rounded-[14px] border border-transparent p-1 transition-all",
                      active &&
                        "border-white/12 bg-white/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                    )}
                  >
                    <button
                      type="button"
                      className="grid h-7 w-7 place-items-center rounded-lg bg-transparent font-extrabold text-white/55"
                      aria-label={channel.name}
                    >
                      #
                    </button>
                    <Input
                      value={channel.name.replace(/^#/, "")}
                      onFocus={() => onSelectChannel(channel.id)}
                      onChange={(event) =>
                        onChangeChannelName(
                          channel.id,
                          event.target.value.trimStart(),
                        )
                      }
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="h-auto border-none bg-transparent px-1 py-2 text-sm text-white/90 shadow-none focus-visible:bg-white/8 focus-visible:ring-0"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="grid content-start gap-5 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_24%),linear-gradient(180deg,rgba(24,27,33,0.76),rgba(13,15,19,0.7))] p-6 text-white backdrop-blur-[24px]">
          <header className="flex items-start justify-between gap-4 border-b border-white/8 pb-4">
            <div className="grid gap-2">
              <h3 className="text-[1.3rem] font-semibold text-white/95">
                {activeChannel?.name || t("channels.placeholder")}
              </h3>
              <p className="m-0 text-sm leading-6 text-white/65">
                {preview.purpose}
              </p>
            </div>
            <span className="rounded-full border border-white/8 bg-white/8 px-3 py-1 text-xs font-semibold text-white/75">
              {t("channels.activeThread")}
            </span>
          </header>

          <div className="grid gap-3">
            <SlackPreviewMessage
              author={t("channels.previewAuthorA")}
              time={t("channels.previewNow")}
              body={preview.primaryMessage}
            />
            <SlackPreviewMessage
              author={t("channels.previewAuthorB")}
              time={t("channels.previewToday")}
              body={preview.secondaryMessage}
            />
          </div>
        </section>
      </div>

      <StepActionDock>
        <ContinueButton disabled={!canContinue} onClick={onContinue}>
          {t("actions.continue")}
        </ContinueButton>
      </StepActionDock>
    </div>
  );
}

function StepFour({
  t,
  agents,
  loading,
  editingChildAgentId,
  onContinue,
  onRegenerate,
  onToggleChildEdit,
  onChangeMainDescription,
  onChangeChildName,
}: {
  t: TranslateFn;
  agents: OnboardingAgentsSelection;
  loading: boolean;
  editingChildAgentId: string;
  onContinue: () => void;
  onRegenerate: () => void;
  onToggleChildEdit: (agentId: string) => void;
  onChangeMainDescription: (value: string) => void;
  onChangeChildName: (agentId: string, name: string) => void;
}) {
  if (loading && !agents.main) {
    return (
      <GenerationState
        title={t("agents.loadingTitle")}
        description={t("agents.loading")}
      />
    );
  }

  if (!agents.main) {
    return (
      <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-6 text-sm text-slate-500">
        {t("agents.empty")}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <ActionHeader
        title={t("steps.4.title")}
        subtitle={t("steps.4.description")}
        actions={
          <GhostButton onClick={onRegenerate} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("actions.regenerate")}
          </GhostButton>
        }
      />

      <div className="grid gap-5">
        <div className="grid justify-items-center gap-4">
          <div className="w-full max-w-[420px] rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(247,250,255,0.74))] px-6 py-6 text-center shadow-[0_18px_40px_rgba(90,106,133,0.08)] backdrop-blur-[16px]">
            <span className="inline-flex text-[0.76rem] font-extrabold uppercase tracking-[0.08em] text-[#1a73e8]">
              {t("agents.mainAgent")}
            </span>
            <div className="mx-auto mt-4 grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-[#1a73e8]/8 text-[1.4rem]">
              {agents.main.emoji ?? "🧑‍💼"}
            </div>
            <strong className="mt-3 block text-[1.08rem] text-slate-900">
              {agents.main.name ?? "Personal Staff"}
            </strong>
            <Textarea
              value={agents.main.description ?? ""}
              onChange={(event) => onChangeMainDescription(event.target.value)}
              placeholder={t("agents.mainDescriptionPlaceholder")}
              className="mt-4 min-h-[112px] rounded-[18px] border-slate-200 bg-white/90 px-4 py-3 text-sm leading-6 shadow-none focus-visible:border-[#1a73e8]/70 focus-visible:ring-[5px] focus-visible:ring-[#1a73e8]/12"
            />
          </div>

          <div className="h-11 w-0.5 rounded-full bg-[linear-gradient(180deg,rgba(26,115,232,0.22),rgba(26,115,232,0.04))]" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {(agents.children ?? []).map((agent) => {
            const editing = editingChildAgentId === agent.id;
            return (
              <div
                key={agent.id}
                className="relative rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(247,250,255,0.74))] shadow-[0_18px_40px_rgba(90,106,133,0.08)] transition-all hover:-translate-y-0.5 hover:border-[#1a73e8]/32 hover:shadow-[0_16px_34px_rgba(26,115,232,0.12)]"
              >
                <button
                  type="button"
                  onClick={() => onToggleChildEdit(agent.id)}
                  className="absolute right-3 top-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100"
                >
                  {t("actions.edit")}
                </button>

                <div className="grid h-full gap-3 p-5 text-left">
                  <span className="inline-flex text-[0.76rem] font-extrabold uppercase tracking-[0.08em] text-[#1a73e8]">
                    {t("agents.childAgents")}
                  </span>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-[#1a73e8]/8 text-[1.4rem]">
                    {agent.emoji}
                  </div>
                  {editing ? (
                    <Input
                      value={agent.name}
                      onChange={(event) =>
                        onChangeChildName(agent.id, event.target.value)
                      }
                      className="rounded-[14px] border-slate-200 bg-white/90 px-3 py-2 text-base font-bold shadow-none focus-visible:border-[#1a73e8]/70 focus-visible:ring-[5px] focus-visible:ring-[#1a73e8]/12"
                    />
                  ) : (
                    <strong className="block text-[1.08rem] text-slate-900">
                      {agent.name}
                    </strong>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <StepActionDock>
        <ContinueButton onClick={onContinue}>
          {t("actions.continue")}
        </ContinueButton>
      </StepActionDock>
    </div>
  );
}

function StepFive({
  t,
  inviteUrl,
  copied,
  loading,
  onCopy,
  onContinue,
}: {
  t: TranslateFn;
  inviteUrl?: string;
  copied: boolean;
  loading: boolean;
  onCopy: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="grid gap-6">
      <ActionHeader
        title={t("steps.5.title")}
        subtitle={t("steps.5.description")}
      />

      <div className="grid gap-5 rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.1),transparent_28%),linear-gradient(160deg,rgba(35,38,44,0.9),rgba(18,20,24,0.86))] p-6 text-white shadow-[0_22px_48px_rgba(10,12,16,0.28)] backdrop-blur-[24px]">
        <div className="grid gap-2 rounded-[22px] border border-white/12 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_32%),linear-gradient(180deg,rgba(41,44,51,0.78),rgba(24,26,31,0.7))] px-5 py-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-white/55">
            {t("invite.title")}
          </span>
          <strong className="break-all text-base font-semibold leading-7 text-white/95">
            {loading ? t("invite.loading") : inviteUrl}
          </strong>
        </div>

        <p className="text-sm leading-7 text-white/70">{t("invite.hint")}</p>

        <div className="flex flex-wrap gap-3">
          <GhostButton
            onClick={onCopy}
            disabled={!inviteUrl}
            className="border-white/15 bg-white/8 text-white/90 hover:border-white/25 hover:bg-white/12 hover:text-white"
          >
            <Copy className="h-4 w-4" />
            {copied ? t("actions.copied") : t("actions.copy")}
          </GhostButton>
        </div>
      </div>

      <StepActionDock>
        <ContinueButton onClick={onContinue} disabled={!inviteUrl}>
          {t("actions.next")}
        </ContinueButton>
      </StepActionDock>
    </div>
  );
}

function StepSix({
  t,
  products,
  selectedPlanId,
  checkoutCompleted,
  loading,
  checkoutPending,
  onSelectPlan,
  onCheckout,
  onFinish,
  onContinueWithoutPlan,
}: {
  t: TranslateFn;
  products: BillingProduct[];
  selectedPlanId: string | null;
  checkoutCompleted: boolean;
  loading: boolean;
  checkoutPending: boolean;
  onSelectPlan: (product: BillingProduct) => void;
  onCheckout: (product: BillingProduct) => void;
  onFinish: () => void;
  onContinueWithoutPlan: () => void;
}) {
  if (loading) {
    return (
      <GenerationState
        title={t("plan.loadingTitle")}
        description={t("plan.empty")}
      />
    );
  }

  const selectedProduct =
    products.find((product) => product.stripePriceId === selectedPlanId) ??
    null;

  return (
    <div className="grid gap-6">
      {checkoutCompleted ? (
        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
          {t("plan.success")}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {products.map((product) => {
          const selected = product.stripePriceId === selectedPlanId;
          return (
            <div
              key={product.stripePriceId}
              role="button"
              tabIndex={0}
              onClick={() => onSelectPlan(product)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectPlan(product);
                }
              }}
              className={cn(
                "grid gap-[18px] rounded-[28px] border p-6 text-left transition-all",
                selected
                  ? "border-[rgba(184,146,49,0.76)] bg-[linear-gradient(180deg,rgba(255,250,239,0.98),rgba(248,236,194,0.84))] text-slate-900 shadow-[0_20px_42px_rgba(171,139,65,0.2)]"
                  : "border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,244,232,0.88))] text-slate-900 shadow-[0_16px_38px_rgba(118,126,148,0.12)] hover:-translate-y-0.5 hover:border-[rgba(192,156,66,0.6)]",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex rounded-full bg-[rgba(247,228,177,0.88)] px-3 py-1 text-xs font-bold text-[rgba(124,89,19,0.9)]">
                    {product.name}
                  </div>
                  <div className="mt-4 text-[30px] font-semibold leading-none tracking-[-0.05em]">
                    {product.name}
                  </div>
                </div>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-lg border bg-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
                    selected
                      ? "border-[#205ecf]/80 bg-[#ebf3ff]"
                      : "border-slate-300",
                  )}
                >
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-[4px] transition-all",
                      selected
                        ? "scale-100 bg-[#1f6feb]"
                        : "scale-50 bg-transparent",
                    )}
                  />
                </span>
              </div>

              <div className="grid gap-2">
                <div className="text-[30px] font-semibold leading-none">
                  {formatPrice(product.amountCents)}
                  <span className="ml-2 text-base font-medium text-slate-500">
                    {t("plan.perMonth")}
                  </span>
                </div>
                <p className="m-0 text-xl font-bold text-slate-800">
                  {t("plan.credits", { count: product.credits ?? 0 })}
                </p>
                <span className="text-sm leading-6 text-slate-500">
                  {t("plan.priceHint", {
                    amount: formatPrice(product.amountCents),
                  })}
                </span>
              </div>

              <div className="grid gap-2.5">
                {(product.display.features ?? []).map((feature) => (
                  <div
                    key={feature}
                    className="flex items-start gap-3 rounded-[18px] border border-slate-200 bg-slate-50/80 px-3 py-3 text-sm text-slate-700"
                  >
                    <span className="mt-0.5 inline-grid h-[18px] w-[18px] place-items-center rounded-full bg-[#1a73e8]/12 text-[12px] font-bold text-[#1f6feb]">
                      ✓
                    </span>
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {products.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-6 text-sm text-slate-500">
          {t("plan.empty")}
        </div>
      ) : null}

      <StepActionDock>
        {checkoutCompleted ? (
          <ContinueButton
            onClick={onFinish}
            disabled={checkoutPending}
            className="shadow-[0_18px_36px_rgba(31,111,235,0.22)]"
          >
            {t("actions.finish")}
          </ContinueButton>
        ) : (
          <>
            <ContinueButton
              disabled={checkoutPending || !selectedProduct}
              onClick={() => {
                if (selectedProduct) {
                  onCheckout(selectedProduct);
                }
              }}
              className="shadow-[0_18px_36px_rgba(31,111,235,0.22)]"
            >
              {checkoutPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {t("actions.startCheckout")}
            </ContinueButton>
            <GhostButton
              onClick={onContinueWithoutPlan}
              disabled={checkoutPending}
              className="bg-white/86 text-slate-600"
            >
              {t("actions.continueWithoutPlan")}
            </GhostButton>
          </>
        )}
      </StepActionDock>
    </div>
  );
}

function GhostButton({
  className,
  children,
  ...props
}: ComponentProps<"button"> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm font-bold text-slate-500 transition-all hover:-translate-y-0.5 hover:border-[#1a73e8]/28 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function ContinueButton({
  className,
  children,
  ...props
}: ComponentProps<"button"> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#1f6feb,#3b82f6)] px-6 py-3 text-sm font-bold text-white shadow-[0_16px_34px_rgba(31,111,235,0.22)] transition-all hover:-translate-y-0.5 hover:bg-[linear-gradient(135deg,#1763d6,#2f73e8)] disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function ActionHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1">
        <h2 className="text-[1.15rem] font-bold text-slate-900">{title}</h2>
        {subtitle ? (
          <p className="mt-2 text-sm leading-7 text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex justify-end">{actions}</div> : null}
    </div>
  );
}

function StepActionDock({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 mt-auto bg-[linear-gradient(180deg,rgba(251,252,255,0)_0%,rgba(251,252,255,0.92)_26%,rgba(251,252,255,0.98)_100%)] pb-1 pt-5">
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-400">
      <div className="h-px flex-1 bg-[linear-gradient(90deg,rgba(216,223,233,0.15),rgba(216,223,233,1),rgba(216,223,233,0.15))]" />
      <span className="px-0.5">{label}</span>
      <div className="h-px flex-1 bg-[linear-gradient(90deg,rgba(216,223,233,0.15),rgba(216,223,233,1),rgba(216,223,233,0.15))]" />
    </div>
  );
}

function GenerationState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-6 text-center">
      <div className="h-[68px] w-[68px] animate-spin rounded-full border-[6px] border-[#1a73e8]/12 border-t-[#1a73e8]" />
      <div className="grid gap-2">
        <h2 className="text-[1.3rem] font-semibold text-slate-900">{title}</h2>
        <p className="max-w-[32rem] text-sm leading-7 text-slate-500">
          {description}
        </p>
      </div>
    </div>
  );
}

function SlackPreviewMessage({
  author,
  time,
  body,
}: {
  author: string;
  time: string;
  body: string;
}) {
  return (
    <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-b border-white/6 py-3 last:border-b-0">
      <div className="grid h-9 w-9 place-items-center rounded-[10px] border border-white/8 bg-white/10 text-sm font-bold text-white/90">
        {author.slice(0, 1).toUpperCase()}
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2 text-sm">
          <strong className="text-white/95">{author}</strong>
          <span className="text-white/45">{time}</span>
        </div>
        <p className="m-0 line-clamp-3 text-sm leading-7 text-white/78">
          {body}
        </p>
      </div>
    </div>
  );
}

function StatusScene({
  title,
  description,
  actionLabel,
  onAction,
  loading = false,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#e5f0ff,transparent_32%),#f4f7fb] px-6">
      <Card className="w-full max-w-xl rounded-[2rem] border-slate-200 bg-white shadow-[0_40px_110px_-56px_rgba(15,23,42,0.32)]">
        <CardContent className="p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white">
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Bot className="h-6 w-6" />
            )}
          </div>
          <div className="mt-6 text-3xl font-semibold tracking-[-0.05em] text-slate-950">
            {title}
          </div>
          <div className="mt-3 text-sm leading-7 text-slate-500">
            {description}
          </div>
          {actionLabel && onAction ? (
            <Button className="mt-8 h-11 rounded-full px-6" onClick={onAction}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {actionLabel}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function clampStep(value?: number) {
  if (!value || Number.isNaN(value)) return 1;
  return Math.max(1, Math.min(TOTAL_STEPS, Math.trunc(value)));
}

function normalizeTag(tag?: string | null, categoryKey?: string | null) {
  if (tag && CATEGORY_ORDER.includes(tag as (typeof CATEGORY_ORDER)[number])) {
    return tag;
  }

  if (
    categoryKey &&
    CATEGORY_ORDER.includes(categoryKey as (typeof CATEGORY_ORDER)[number])
  ) {
    return categoryKey;
  }

  return "recommended";
}

function buildRoleSignature(role: OnboardingRoleSelection, language: string) {
  return [
    language,
    role.selectedRoleSlug ?? "",
    role.selectedRoleLabel ?? "",
    role.description?.trim() ?? "",
  ].join("::");
}

function buildTaskSignature(
  role: OnboardingRoleSelection,
  tasks: OnboardingTasksSelection,
  language: string,
) {
  return [
    buildRoleSignature(role, language),
    [...(tasks.selectedTaskIds ?? [])].sort().join(","),
    tasks.customTask?.trim() ?? "",
  ].join("::");
}

function buildChannelPreviewModel({
  t,
  roleLabel,
  channels,
  activeChannel,
  selectedTasks,
  customTask,
}: {
  t: TranslateFn;
  roleLabel: string;
  channels: OnboardingChannelDraft[];
  activeChannel?: OnboardingChannelDraft;
  selectedTasks: string[];
  customTask: string;
}) {
  const currentChannel = activeChannel ?? channels[0];
  const normalizedTasks = [
    ...selectedTasks.map((task) => task.trim()),
    customTask.trim(),
  ].filter(Boolean);
  const currentIndex = Math.max(
    0,
    channels.findIndex((channel) => channel.id === currentChannel?.id),
  );
  const primaryTask =
    normalizedTasks[currentIndex] ??
    normalizedTasks[0] ??
    t("channels.previewLine1");
  const secondaryTask =
    normalizedTasks.length > 1
      ? normalizedTasks[(currentIndex + 1) % normalizedTasks.length]
      : t("channels.previewLine2");
  const owner = roleLabel.trim() || t("channels.sidebarTitle");
  const channelLabel = currentChannel?.name || t("channels.placeholder");

  return {
    purpose: t("channels.previewPurpose", { topic: channelLabel }),
    primaryMessage: t("channels.previewInsight", {
      role: owner,
      task: primaryTask,
    }),
    secondaryMessage: t("channels.previewThread", {
      task: secondaryTask,
      topic: channelLabel,
    }),
  };
}

function findValidInvitation(invitations: WorkspaceInvitation[]) {
  return invitations.find((invitation) => {
    if (!invitation.isActive) return false;
    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      return false;
    }
    if (invitation.maxUses && invitation.usedCount >= invitation.maxUses) {
      return false;
    }
    return true;
  });
}

function formatPrice(amountCents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

async function _goBackTo(
  step: number,
  persistProgress: (args?: {
    nextStep?: number;
    status?: "in_progress" | "completed";
    overrides?: Partial<WorkspaceOnboardingStepData>;
  }) => Promise<unknown>,
  setCurrentStep: (step: number) => void,
) {
  await persistProgress({ nextStep: step });
  setCurrentStep(step);
}
