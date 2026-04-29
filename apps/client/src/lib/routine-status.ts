import type { RoutineStatus } from "@/types/routine";

export const STATUS_COLORS: Record<RoutineStatus, string> = {
  draft: "bg-yellow-400",
  in_progress: "bg-blue-500",
  upcoming: "bg-gray-400",
  paused: "bg-yellow-500",
  pending_action: "bg-orange-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  stopped: "bg-gray-500",
  timeout: "bg-red-400",
};
