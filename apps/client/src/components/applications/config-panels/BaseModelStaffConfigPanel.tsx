import { Bot, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  BaseModelStaffBotInfo,
  OpenClawBotInfo,
} from "@/services/api/applications";
import type { AppConfigPanelProps } from "./registry";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";

/** Maps preset key → display metadata. */
const MODEL_META: Record<string, { emoji: string; provider: string }> = {
  claude: { emoji: "\u{1F7E0}", provider: "Anthropic" },
  chatgpt: { emoji: "\u{1F7E2}", provider: "OpenAI" },
  gemini: { emoji: "\u{1F535}", provider: "Google" },
};

function getModelMeta(agentId: string | undefined) {
  if (!agentId) return null;
  // agentId format: base-model-{key}-{tenantShort}
  for (const key of Object.keys(MODEL_META)) {
    if (agentId.includes(`-${key}-`)) return { key, ...MODEL_META[key] };
  }
  return null;
}

function isBaseModelStaffBot(
  bot: OpenClawBotInfo | BaseModelStaffBotInfo,
): bot is BaseModelStaffBotInfo {
  return "managedMeta" in bot;
}

export function BaseModelStaffBotsTab({ installedApp }: AppConfigPanelProps) {
  const workspaceId = useSelectedWorkspaceId();
  const appId = installedApp.id;

  const {
    data: bots,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["base-model-staff-bots", workspaceId, appId],
    queryFn: async () => {
      const apps = await api.applications.getInstalledApplicationsWithBots();
      const app = apps.find((candidate) => candidate.id === appId);
      return app?.bots.filter(isBaseModelStaffBot) ?? [];
    },
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Failed to load bots
        </CardContent>
      </Card>
    );
  }

  if (!bots || bots.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No bots found for this installation
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Assistants</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {bots.map((bot) => {
            const meta = getModelMeta(bot.managedMeta?.agentId);
            return (
              <div
                key={bot.botId}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl bg-background shrink-0">
                  {meta?.emoji ?? <Bot size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {bot.displayName ?? bot.username}
                    </span>
                    {meta && (
                      <span className="text-xs text-muted-foreground">
                        {meta.provider}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    @{bot.username}
                  </p>
                </div>
                <Badge
                  variant={bot.isActive ? "default" : "secondary"}
                  className="text-[10px] px-1.5 py-0 h-5 gap-1"
                >
                  {bot.isActive ? (
                    <CheckCircle2 size={10} />
                  ) : (
                    <XCircle size={10} />
                  )}
                  {bot.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
