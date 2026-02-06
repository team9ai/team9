import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface BotStartupOverlayProps {
  phase: "countdown" | "ready";
  remainingSeconds: number;
  onStartChatting: () => void;
}

export function BotStartupOverlay({
  phase,
  remainingSeconds,
  onStartChatting,
}: BotStartupOverlayProps) {
  const { t } = useTranslation("channel");

  return (
    <div className="flex-1 flex items-center justify-center bg-muted/30">
      <Card className="w-[400px] border shadow-lg">
        <CardContent className="p-8 flex flex-col items-center text-center gap-6">
          <img
            src="/whale.webp"
            alt="OpenClaw Bot"
            className="w-20 h-20  shadow-md"
          />

          {phase === "countdown" ? (
            <>
              <p className="text-lg font-bold text-muted-foreground leading-relaxed">
                {t("botStartupCountdownMessage")}
              </p>
              <div className="text-5xl font-extrabold text-primary tabular-nums">
                {remainingSeconds}S
              </div>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-foreground leading-relaxed">
                {t("botStartupSuccessMessage")}
              </p>
              <Button
                onClick={onStartChatting}
                className="bg-info hover:bg-info/90 text-primary-foreground px-8 rounded-lg cursor-pointer"
              >
                {t("botStartChatting")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
