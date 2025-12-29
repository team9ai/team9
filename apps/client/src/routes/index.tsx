import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { SubSidebar } from "@/components/layout/SubSidebar";
import { MainContent } from "@/components/layout/MainContent";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { Sheet } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks";

export const Route = createFileRoute("/")({
  component: Index,
  beforeLoad: async () => {
    // Check if user is authenticated
    const token = localStorage.getItem("auth_token");

    if (!token) {
      throw redirect({
        to: "/login",
        search: {
          redirect: "/",
        },
      });
    }
  },
});

function Index() {
  const [activeSection, setActiveSection] = useState("home");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isDesktop = useIsDesktop();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* Desktop: Show MainSidebar */}
      {isDesktop && (
        <MainSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
      )}

      {/* Desktop: Show SubSidebar inline, Mobile: Show in Sheet drawer */}
      {isDesktop ? (
        <SubSidebar activeSection={activeSection} />
      ) : (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen} side="left">
          <SubSidebar activeSection={activeSection} />
        </Sheet>
      )}

      {/* Main Content Area - Always visible */}
      <MainContent activeSection={activeSection} />

      {/* Mobile: Bottom Tab Bar */}
      {!isDesktop && (
        <MobileTabBar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
      )}
    </div>
  );
}
