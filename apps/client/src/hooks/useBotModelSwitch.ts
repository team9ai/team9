import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import {
  COMMON_STAFF_MODELS,
  DEFAULT_STAFF_MODEL,
} from "@/lib/common-staff-models";

interface BotModelInfo {
  currentModel: { provider: string; id: string } | null;
  currentModelLabel: string;
  canSwitchModel: boolean;
  applicationId: string | null;
  installedApplicationId: string | null;
  botId: string | null;
}

export function useBotModelSwitch(botUserId: string | null) {
  const workspaceId = useSelectedWorkspaceId();
  const queryClient = useQueryClient();

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
          ? COMMON_STAFF_MODELS.find(
              (m) => m.provider === model.provider && m.id === model.id,
            )
          : null;
        const label =
          matchedModel?.label ?? model?.id ?? DEFAULT_STAFF_MODEL.label;

        return {
          currentModel: model,
          currentModelLabel: label,
          canSwitchModel: canSwitch,
          applicationId: app.applicationId,
          installedApplicationId: app.id,
          botId: "botId" in bot ? (bot.botId as string) : null,
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
    };
  }, [installedApps, botUserId]);

  const updateModelMutation = useMutation({
    mutationFn: async (model: { provider: string; id: string }) => {
      if (!botInfo.canSwitchModel || !botInfo.installedApplicationId) {
        throw new Error("This bot does not support model switching");
      }

      if (botInfo.applicationId === "common-staff") {
        if (!botInfo.botId) throw new Error("Missing bot ID");
        await api.applications.updateCommonStaff(
          botInfo.installedApplicationId,
          botInfo.botId,
          { model },
        );
      } else if (botInfo.applicationId === "personal-staff") {
        await api.applications.updatePersonalStaff(
          botInfo.installedApplicationId,
          { model },
        );
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
    isUpdating: updateModelMutation.isPending,
    updateModel: (model: { provider: string; id: string }) =>
      updateModelMutation.mutateAsync(model),
  };
}
