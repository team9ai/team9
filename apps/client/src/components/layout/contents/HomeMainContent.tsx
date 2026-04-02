import type { KeyboardEventHandler } from "react";
import {
  type LucideIcon,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Loader2,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/stores";
import { useChannelsByType } from "@/hooks/useChannels";
import { cn } from "@/lib/utils";

const DASHBOARD_ACTION_CHIPS = [
  {
    key: "dashboardActionDeepResearch",
    icon: Search,
    className: "text-[#675f56]",
  },
  {
    key: "dashboardActionGenerateImage",
    icon: ImagePlus,
    className: "text-[#675f56]",
  },
] as const;

function DashboardHeader() {
  const { t } = useTranslation("navigation");

  return (
    <header className="flex items-center justify-between gap-4">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-[#312c27] transition-colors hover:bg-white/50"
      >
        <span className="truncate">{t("dashboardBrand")}</span>
        <ChevronDown size={14} className="text-[#8f8578]" />
      </button>

      <div className="dashboard-landing-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[#8f8578]">
        <Sparkles size={14} className="text-[#9c8f80]" />
        <span>{t("dashboardUsageValue")}</span>
      </div>
    </header>
  );
}

function DashboardPlanBadge() {
  const { t } = useTranslation("navigation");

  return (
    <div className="dashboard-landing-pill inline-flex items-center rounded-full p-[0.2rem] text-[0.8rem] text-[#8d8274]">
      <span className="rounded-full px-4 py-1.5">{t("dashboardPlan")}</span>
      <span className="h-4 w-px bg-[#e7ddd0]" />
      <span className="rounded-full px-4 py-1.5 font-medium text-[#2f67ff]">
        {t("dashboardUpgrade")}
      </span>
    </div>
  );
}

function DashboardActionChip({
  label,
  icon: Icon,
  className,
}: {
  label: string;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "dashboard-composer-chip inline-flex h-[2.375rem] items-center gap-1.5 rounded-full px-3.5 text-[0.78rem] font-medium",
        className,
      )}
    >
      <Icon size={14} strokeWidth={1.8} />
      <span>{label}</span>
    </div>
  );
}

function DashboardTaskPill() {
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

export function HomeMainContent() {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const { directChannels = [] } = useChannelsByType();
  const user = useUser();
  const [prompt, setPrompt] = useState("");
  const [isWarmupDismissed, setIsWarmupDismissed] = useState(false);

  const defaultBotChannel = directChannels.find(
    (channel) => channel.otherUser?.userType === "bot",
  );
  const isNewUser =
    !!user?.createdAt &&
    Date.now() - new Date(user.createdAt).getTime() < 10 * 60 * 1000;
  const canSubmit = !!defaultBotChannel && prompt.trim().length > 0;

  const handleSubmit = () => {
    if (!defaultBotChannel) return;

    const draft = prompt.trim();
    if (!draft) return;

    setPrompt("");
    navigate({
      to: "/channels/$channelId",
      params: { channelId: defaultBotChannel.id },
      search: { draft },
    });
  };

  const handlePromptKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (
    event,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <main className="dashboard-landing h-full overflow-y-auto">
      <div className="dashboard-landing-shell min-h-full">
        <div className="flex min-h-full w-full flex-col px-4 pb-8 pt-4 sm:px-6 sm:pb-10 lg:px-8">
          <DashboardHeader />

          <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col items-center justify-center gap-5 pb-8 pt-2 sm:gap-6 sm:pb-12 sm:pt-4 lg:pb-[4.5rem] lg:pt-3">
            <DashboardPlanBadge />

            {isNewUser && !isWarmupDismissed ? (
              <div className="dashboard-landing-pill flex w-full max-w-[36rem] items-start gap-2.5 rounded-[1.2rem] px-3.5 py-2.5 text-[0.78rem] text-[#6e655b] sm:items-center">
                <Loader2
                  size={14}
                  className="mt-0.5 shrink-0 animate-spin text-[#7b8dcb] sm:mt-0"
                />
                <p className="flex-1">
                  {t("dashboardWarmupNotice", { name: user?.name })}
                </p>
                <button
                  type="button"
                  onClick={() => setIsWarmupDismissed(true)}
                  className="rounded-full p-1 text-[#a89c8d] transition-colors hover:bg-white/55 hover:text-[#6e655b]"
                  aria-label={t("cancel")}
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}

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
                  placeholder={t("dashboardPromptPlaceholder")}
                  className="min-h-[7rem] resize-none border-0 bg-transparent px-2.5 py-1.5 text-[0.82rem] leading-[1.2rem] text-[#3f3a35] shadow-none placeholder:text-[#c8d5e6] focus-visible:border-transparent focus-visible:ring-0 md:text-[0.82rem]"
                />

                <div className="mt-3 flex flex-col gap-2.5 px-0.5 pt-0.5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="dashboard-composer-plus inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-full text-[#3e4f68]"
                    >
                      <Plus size={17} strokeWidth={2} />
                    </button>

                    {DASHBOARD_ACTION_CHIPS.map((chip) => (
                      <DashboardActionChip
                        key={chip.key}
                        label={t(chip.key)}
                        icon={chip.icon}
                        className={chip.className}
                      />
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-1.5 sm:justify-end">
                    <div className="dashboard-composer-model inline-flex h-[2.05rem] items-center gap-1.5 rounded-full px-3 text-[0.76rem] text-[#50627f]">
                      <Sparkles size={12} className="text-[#2c3647]" />
                      <span>{t("dashboardModelLabel")}</span>
                      <ChevronDown size={11} className="text-[#93887b]" />
                    </div>

                    <Button
                      type="button"
                      size="icon"
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      className="dashboard-composer-send h-[2.375rem] w-[2.375rem] rounded-full bg-[#818894] text-white shadow-none hover:bg-[#727885] disabled:bg-[#ddd7cf] disabled:text-[#a2998d]"
                    >
                      <ArrowUp size={16} strokeWidth={2.2} />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <DashboardTaskPill />
          </div>
        </div>
      </div>
    </main>
  );
}
