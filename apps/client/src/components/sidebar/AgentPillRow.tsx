import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type AgentStaffKind = "common" | "personal" | "other";

export interface AgentPillRowProps {
  staffKind: AgentStaffKind;
  roleTitle?: string | null;
  ownerName?: string | null;
}

const basePill =
  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none";
const neutralPill = cn(basePill, "bg-nav-hover text-nav-foreground-muted");
const accentPill = cn(basePill, "bg-primary/15 text-primary");
const truncatedPill = cn(neutralPill, "truncate max-w-[12ch]");

export function AgentPillRow({
  staffKind,
  roleTitle,
  ownerName,
}: AgentPillRowProps) {
  const { t } = useTranslation("navigation");
  const aiLabel = t("agentPillAi");

  if (staffKind === "common") {
    return (
      <div className="mt-0.5 flex items-center gap-1 overflow-hidden">
        <span className={accentPill}>{aiLabel}</span>
        {roleTitle ? (
          <span className={truncatedPill} title={roleTitle}>
            {roleTitle}
          </span>
        ) : null}
      </div>
    );
  }

  if (staffKind === "personal") {
    return (
      <div className="mt-0.5 flex items-center gap-1 overflow-hidden">
        <span className={accentPill}>{aiLabel}</span>
        <span className={neutralPill}>{t("agentPillPersonalAssistant")}</span>
        {ownerName ? (
          <span className={truncatedPill} title={ownerName}>
            {ownerName}
          </span>
        ) : null}
      </div>
    );
  }

  // staffKind === "other"
  return (
    <div className="mt-0.5 flex items-center gap-1 overflow-hidden">
      <span className={accentPill}>{aiLabel}</span>
      <span className={neutralPill}>{t("agentPillModel")}</span>
    </div>
  );
}
