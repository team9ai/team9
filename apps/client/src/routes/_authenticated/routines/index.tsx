import { createFileRoute } from "@tanstack/react-router";
import { RoutineList } from "@/components/routines/RoutineList";

export const Route = createFileRoute("/_authenticated/routines/")({
  component: RoutinesPage,
});

function RoutinesPage() {
  return (
    <div className="h-full overflow-hidden">
      <RoutineList />
    </div>
  );
}
