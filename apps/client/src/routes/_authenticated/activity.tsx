import { createFileRoute } from "@tanstack/react-router";
import { ActivitySubSidebar } from "@/components/layout/sidebars/ActivitySubSidebar";
import { ActivityMainContent } from "@/components/layout/contents/ActivityMainContent";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { Sheet } from "@/components/ui/sheet";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/activity")({
  component: ActivityPage,
});

function ActivityPage() {
  const isDesktop = useIsDesktop();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <>
      {isDesktop ? (
        <>
          <ActivitySubSidebar />
          <ActivityMainContent />
        </>
      ) : (
        <>
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen} side="left">
            <ActivitySubSidebar />
          </Sheet>
          <ActivityMainContent />
        </>
      )}
    </>
  );
}
