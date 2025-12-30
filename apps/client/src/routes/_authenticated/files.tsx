import { createFileRoute } from "@tanstack/react-router";
import { FilesSubSidebar } from "@/components/layout/sidebars/FilesSubSidebar";
import { FilesMainContent } from "@/components/layout/contents/FilesMainContent";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { Sheet } from "@/components/ui/sheet";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/files")({
  component: FilesPage,
});

function FilesPage() {
  const isDesktop = useIsDesktop();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <>
      {isDesktop ? (
        <>
          <FilesSubSidebar />
          <FilesMainContent />
        </>
      ) : (
        <>
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen} side="left">
            <FilesSubSidebar />
          </Sheet>
          <FilesMainContent />
        </>
      )}
    </>
  );
}
