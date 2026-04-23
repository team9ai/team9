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
// Fixed-content pills (AI / 个人助理 / 模型) never shrink — they're short and
// must remain readable.
const neutralPill = cn(
  basePill,
  "bg-nav-hover text-nav-foreground-muted shrink-0",
);
const accentPill = cn(basePill, "bg-primary/15 text-primary shrink-0");
// Variable-content pills (roleTitle / ownerName) can shrink to fit and
// truncate with an ellipsis. Uses inline-block (not inline-flex) so
// text-overflow: ellipsis actually applies — flex containers aren't block
// containers, so `truncate` on an inline-flex pill silently fails to clip
// and the row overflows the sidebar.
const truncatedPill = cn(
  "inline-block align-middle rounded-full px-1.5 py-0.5 text-[10px] leading-none",
  "bg-nav-hover text-nav-foreground-muted min-w-0 truncate",
);

const rowClass = "mt-0.5 flex w-full items-center gap-1 min-w-0";

export function AgentPillRow({
  staffKind,
  roleTitle,
  ownerName,
}: AgentPillRowProps) {
  const { t } = useTranslation("navigation");
  const aiLabel = t("agentPillAi");

  if (staffKind === "common") {
    return (
      <div className={rowClass}>
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
      <div className={rowClass}>
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
    <div className={rowClass}>
      <span className={accentPill}>{aiLabel}</span>
      <span className={neutralPill}>{t("agentPillModel")}</span>
    </div>
  );
}
