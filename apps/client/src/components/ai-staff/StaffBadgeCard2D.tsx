import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { StaffBadgeCardProps } from "./StaffBadgeCard";

const FLIP_HINT_HOLD_MS = 900;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function StaffBadgeCard2D({
  displayName,
  roleTitle,
  avatarUrl,
  mentorName,
  mentorAvatarUrl,
  persona,
  modelLabel,
  selected,
  onClick,
  flipHintDelayMs,
}: StaffBadgeCardProps) {
  const { t } = useTranslation("skills");
  const [flipped, setFlipped] = useState(false);
  const initials = getInitials(displayName);
  const mentorInitials = mentorName ? getInitials(mentorName) : "?";

  useEffect(() => {
    if (flipHintDelayMs === undefined) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => {
        setFlipped(true);
        timers.push(setTimeout(() => setFlipped(false), FLIP_HINT_HOLD_MS));
      }, flipHintDelayMs),
    );
    return () => {
      timers.forEach(clearTimeout);
      setFlipped(false);
    };
  }, [flipHintDelayMs]);

  const handleClick = () => {
    setFlipped((prev) => !prev);
    onClick?.();
  };

  return (
    <div
      className={cn(
        "relative cursor-pointer select-none",
        selected && "ring-2 ring-primary ring-offset-2 rounded-2xl",
      )}
      style={{ width: 280, height: 400, perspective: "1000px" }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={`${displayName} badge card${flipped ? " (showing back)" : ""}`}
    >
      {/* Inner flip container */}
      <div
        className="relative w-full h-full transition-transform duration-500"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Front Face */}
        <div
          className="absolute inset-0 rounded-2xl bg-card border border-border shadow-lg overflow-hidden flex flex-col"
          style={{ backfaceVisibility: "hidden" }}
        >
          {/* Gradient header strip */}
          <div className="h-24 bg-gradient-to-br from-primary/20 via-primary/10 to-secondary flex-shrink-0" />

          {/* Avatar — overlapping header */}
          <div className="flex justify-center -mt-12 flex-shrink-0">
            <Avatar className="w-20 h-20 border-4 border-card shadow-md">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
              <AvatarFallback className="bg-primary/10 text-primary font-bold text-xl">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Name & role */}
          <div className="mt-3 px-5 text-center flex-shrink-0">
            <h3 className="font-bold text-lg text-foreground leading-tight truncate">
              {displayName}
            </h3>
            {roleTitle && (
              <p className="text-sm text-muted-foreground mt-0.5 truncate">
                {roleTitle}
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="mx-5 mt-4 border-t border-border flex-shrink-0" />

          {/* Mentor */}
          <div className="mt-4 px-5 flex-shrink-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
              Mentor
            </p>
            {mentorName ? (
              <div className="flex items-center gap-2">
                <Avatar className="w-7 h-7">
                  {mentorAvatarUrl && (
                    <AvatarImage src={mentorAvatarUrl} alt={mentorName} />
                  )}
                  <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                    {mentorInitials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-foreground truncate">
                  {mentorName}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No mentor assigned
              </p>
            )}
          </div>

          {/* Flip hint */}
          <div className="mt-auto pb-4 px-5 text-center flex-shrink-0">
            <p className="text-xs text-muted-foreground/60">Click to flip</p>
          </div>
        </div>

        {/* Back Face */}
        <div
          className="absolute inset-0 rounded-2xl bg-card border border-border shadow-lg overflow-hidden flex flex-col"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          {/* Gradient header strip (accent color) */}
          <div className="h-16 bg-gradient-to-br from-secondary via-secondary/80 to-primary/10 flex-shrink-0 flex items-end px-5 pb-3">
            <h4 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
              {t("badge.about")}
            </h4>
          </div>

          {/* Persona */}
          <div className="flex-1 px-5 pt-4 overflow-hidden">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
              {t("badge.persona")}
            </p>
            <p className="text-sm text-foreground leading-relaxed line-clamp-[9]">
              {persona?.slice(0, 250) || t("badge.noPersona")}
            </p>
          </div>

          {/* Model label at bottom */}
          <div className="flex-shrink-0 px-5 pb-5 pt-3 border-t border-border mt-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                {t("badge.model")}
              </span>
              <span className="text-xs font-mono text-foreground/80 bg-muted px-2 py-0.5 rounded">
                {modelLabel ?? "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
