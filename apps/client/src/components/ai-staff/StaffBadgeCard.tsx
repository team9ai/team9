import { Skeleton } from "@/components/ui/skeleton";
import { StaffBadgeCard2D } from "./StaffBadgeCard2D";

export interface StaffBadgeCardProps {
  displayName: string;
  roleTitle?: string;
  avatarUrl?: string;
  mentorName?: string;
  mentorAvatarUrl?: string;
  persona?: string;
  modelLabel?: string;
  selected?: boolean;
  onClick?: () => void;
  /**
   * When set to a number, the card auto-flips once after the given delay to
   * hint that it is flippable. Changing the value re-triggers the animation.
   */
  flipHintDelayMs?: number;
}

export function StaffBadgeCard(props: StaffBadgeCardProps) {
  return <StaffBadgeCard2D {...props} />;
}

export function StaffBadgeCardSkeleton() {
  return (
    <div className="relative select-none" style={{ width: 280, height: 400 }}>
      <div className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        <Skeleton className="h-24 flex-shrink-0 rounded-none" />
        <div className="-mt-12 flex flex-shrink-0 justify-center">
          <Skeleton className="h-20 w-20 rounded-full border-4 border-card" />
        </div>
        <div className="mt-3 flex flex-shrink-0 flex-col items-center gap-2 px-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="mx-5 mt-4 flex-shrink-0 border-t border-border" />
        <div className="mt-4 flex-shrink-0 space-y-2 px-5">
          <Skeleton className="h-3 w-16" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}
