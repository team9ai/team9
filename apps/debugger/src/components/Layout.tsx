import { TopBar } from "./TopBar";
import { BottomBar } from "./BottomBar";
import type { ReactNode } from "react";

interface LayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export function Layout({ left, center, right }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <div className="w-60 border-r border-slate-700 flex flex-col overflow-y-auto">
          {left}
        </div>
        <div className="flex-1 flex flex-col min-w-0">{center}</div>
        <div className="w-80 border-l border-slate-700 flex flex-col overflow-y-auto">
          {right}
        </div>
      </div>
      <BottomBar />
    </div>
  );
}
