import { createFileRoute } from "@tanstack/react-router";
import { HomeSubSidebar } from "@/components/layout/sidebars/HomeSubSidebar";
import { HomeMainContent } from "@/components/layout/contents/HomeMainContent";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { Sheet } from "@/components/ui/sheet";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

function HomePage() {
  const isDesktop = useIsDesktop();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <>
      {/* Desktop: Show SubSidebar inline */}
      {isDesktop ? (
        <>
          <HomeSubSidebar />
          <HomeMainContent />
        </>
      ) : (
        <>
          {/* Mobile: Show SubSidebar in Sheet drawer */}
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen} side="left">
            <HomeSubSidebar />
          </Sheet>
          <HomeMainContent />
        </>
      )}
    </>
  );
}
