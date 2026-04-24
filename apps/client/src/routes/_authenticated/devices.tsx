import { createFileRoute } from "@tanstack/react-router";
import { DevicesContent } from "@/components/layout/contents/DevicesContent";

export const Route = createFileRoute("/_authenticated/devices" as never)({
  component: DevicesPage,
});

function DevicesPage() {
  return <DevicesContent />;
}
