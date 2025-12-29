import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { SubSidebar } from "@/components/layout/SubSidebar";
import { MainContent } from "@/components/layout/MainContent";

export const Route = createFileRoute("/")({
  component: Index,
  loader: async () => {
    /* You can add data loading logic here if needed */
  },
});

function Index() {
  const [activeSection, setActiveSection] = useState("home");

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* Left Sidebar - Main Navigation */}
      <MainSidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />

      {/* Middle Sidebar - Sub Navigation */}
      <SubSidebar activeSection={activeSection} />

      {/* Right Content Area */}
      <MainContent activeSection={activeSection} />
    </div>
  );
}
