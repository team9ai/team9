import { lazy, Suspense } from "react";
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
}

const StaffBadgeCard3D = lazy(() => import("./StaffBadgeCard3D"));

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// Evaluated once at module load time — safe for Tauri/browser environments.
const hasWebGL = typeof document !== "undefined" ? detectWebGL() : false;

export function StaffBadgeCard(props: StaffBadgeCardProps) {
  if (!hasWebGL) {
    return <StaffBadgeCard2D {...props} />;
  }

  return (
    <Suspense fallback={<StaffBadgeCard2D {...props} />}>
      <StaffBadgeCard3D {...props} />
    </Suspense>
  );
}
