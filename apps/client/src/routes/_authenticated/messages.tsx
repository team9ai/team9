import { createFileRoute } from "@tanstack/react-router";
import { MessagesSubSidebar } from "@/components/layout/sidebars/MessagesSubSidebar";
import { MessagesMainContent } from "@/components/layout/contents/MessagesMainContent";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { Sheet } from "@/components/ui/sheet";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/messages")({
  component: MessagesPage,
});

function MessagesPage() {
  const isDesktop = useIsDesktop();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <>
      {isDesktop ? (
        <>
          <MessagesSubSidebar />
          <MessagesMainContent />
        </>
      ) : (
        <>
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen} side="left">
            <MessagesSubSidebar />
          </Sheet>
          <MessagesMainContent />
        </>
      )}
    </>
  );
}
