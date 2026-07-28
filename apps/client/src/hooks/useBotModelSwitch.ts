import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import type { StaffModelFamily } from "@/lib/common-staff-models";
import {
  BASE_MODEL_PRODUCT_FAMILY,
  getBaseModelProductKey,
} from "@/lib/base-model-agent";
import {
  invalidateStaffModelCatalog,
  useStaffModelCatalog,
} from "./useStaffModelCatalog";
import {
  createModelChangeIdempotencyKey,
  isUnsupportedModelError,
  waitForModelChangeAttempt,
} from "./model-change-mutation";

interface BotModelInfo {
  currentModel: { provider: string; id: string } | null;
  currentModelLabel: string;
  canSwitchModel: boolean;
  applicationId: string | null;
  installedApplicationId: string | null;
  botId: string | null;
  // Non-null only for base-model agents whose `managedMeta.agentId` matches a
  // known preset (claude/chatgpt/gemini). Picker UIs use this to lock the
  // dropdown to a single model family. `null` = no filter (common/personal
  // staff, or unrecognized base-model bot).
  agentModelFamily: StaffModelFamily | null;
}

export function useBotModelSwitch(botUserId: string | null) {
  const workspaceId = useSelectedWorkspaceId();
  const queryClient = useQueryClient();
  const modelCatalog = useStaffModelCatalog();

  const { data: installedApps } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: () => api.applications.getInstalledApplicationsWithBots(),
    enabled: !!workspaceId && !!botUserId,
    staleTime: 30_000,
  });

  const botInfo = useMemo<BotModelInfo>(() => {
    if (!installedApps || !botUserId) {
      return {
        currentModel: null,
        currentModelLabel: "",
        canSwitchModel: false,
        applicationId: null,
        installedApplicationId: null,
        botId: null,
        agentModelFamily: null,
      };
    }

    for (const app of installedApps) {
      for (const bot of app.bots) {
        if (bot.userId !== botUserId) continue;

        const canSwitch =
          app.applicationId === "common-staff" ||
          app.applicationId === "personal-staff";
        const model =
          "model" in bot
            ? ((bot.model as { provider: string; id: string } | undefined) ??
              null)
            : null;
        const matchedModel = model
          ? modelCatalog.models.find(
              (m) => m.provider === model.provider && m.id === model.id,
            )
          : null;
        const label = matchedModel?.label ?? model?.id ?? "";

        let agentModelFamily: StaffModelFamily | null = null;
        if (app.applicationId === "base-model-staff") {
          const agentId =
            "managedMeta" in bot ? (bot.managedMeta?.agentId ?? null) : null;
          const productKey = getBaseModelProductKey(agentId);
          agentModelFamily = productKey
            ? BASE_MODEL_PRODUCT_FAMILY[productKey]
            : null;
        }

        return {
          currentModel: model,
          currentModelLabel: label,
          canSwitchModel: canSwitch,
          applicationId: app.applicationId,
          installedApplicationId: app.id,
          botId: "botId" in bot ? (bot.botId as string) : null,
          agentModelFamily,
        };
      }
    }

    return {
      currentModel: null,
      currentModelLabel: "",
      canSwitchModel: false,
      applicationId: null,
      installedApplicationId: null,
      botId: null,
      agentModelFamily: null,
    };
  }, [installedApps, botUserId, modelCatalog.models]);

  const updateModelMutation = useMutation({
    mutationFn: async (model: { provider: string; id: string }) => {
      if (!botInfo.canSwitchModel || !modelCatalog.canMutate) {
        throw new Error("This bot does not support model switching");
      }
      if (!botInfo.botId) throw new Error("Missing bot ID");
      try {
        const result = await api.im.bots.updateModel(
          botInfo.botId,
          model,
          createModelChangeIdempotencyKey(),
        );
        if (result.state === "pending") {
          await waitForModelChangeAttempt(result.attemptId);
        }
      } catch (error) {
        if (isUnsupportedModelError(error)) {
          await invalidateStaffModelCatalog(queryClient);
        }
        throw error;
      }
    },
    onSettled: () => {
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: ["installed-applications-with-bots", workspaceId],
        });
      }
    },
  });

  return {
    ...botInfo,
    canSwitchModel: botInfo.canSwitchModel && modelCatalog.canMutate,
    models: modelCatalog.models,
    runtimeReady: modelCatalog.runtimeReady,
    isUpdating: updateModelMutation.isPending,
    updateModel: (model: { provider: string; id: string }) =>
      updateModelMutation.mutateAsync(model),
  };
}
