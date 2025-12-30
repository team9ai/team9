import { createFileRoute } from "@tanstack/react-router";
import { MoreSubSidebar } from "@/components/layout/sidebars/MoreSubSidebar";
import { MoreMainContent } from "@/components/layout/contents/MoreMainContent";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { Sheet } from "@/components/ui/sheet";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/more")({
  component: MorePage,
});

function MorePage() {
  const isDesktop = useIsDesktop();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <>
      {isDesktop ? (
        <>
          <MoreSubSidebar />
          <MoreMainContent />
        </>
      ) : (
        <>
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen} side="left">
            <MoreSubSidebar />
          </Sheet>
          <MoreMainContent />
        </>
      )}
    </>
  );
}
