import { useState } from "react";
import { QuickActions } from "./QuickActions";
import { JsonEditor } from "./JsonEditor";
import { Inspector } from "./Inspector";

const TABS = [
  { id: "actions", label: "Quick Actions" },
  { id: "json", label: "JSON Editor" },
  { id: "inspector", label: "Inspector" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ActionPanel() {
  const [activeTab, setActiveTab] = useState<TabId>("actions");

  return (
    <div className="flex flex-col h-full">
      <div className="flex bg-slate-900 border-b border-slate-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 text-[11px] text-center ${
              activeTab === tab.id
                ? "text-sky-400 border-b-2 border-sky-400"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeTab === "actions" && <QuickActions />}
        {activeTab === "json" && <JsonEditor />}
        {activeTab === "inspector" && <Inspector />}
      </div>
    </div>
  );
}
