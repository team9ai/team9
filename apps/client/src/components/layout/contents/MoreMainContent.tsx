import {
  Settings,
  HelpCircle,
  Info,
  Bell,
  Lock,
  Palette,
  Globe,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";

const settingsGroups = [
  {
    title: "Preferences",
    items: [
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "privacy", label: "Privacy", icon: Lock },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "language", label: "Language", icon: Globe },
    ],
  },
  {
    title: "Support",
    items: [
      { id: "help", label: "Help Center", icon: HelpCircle },
      { id: "about", label: "About", icon: Info },
    ],
  },
];

export function MoreMainContent() {
  return (
    <main className="flex-1 flex flex-col bg-white">
      {/* Content Header */}
      <header className="h-14 bg-white flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-purple-600" />
          <h2 className="font-semibold text-lg text-slate-900">
            Settings & More
          </h2>
        </div>
      </header>

      <Separator />

      {/* Settings Content */}
      <ScrollArea className="flex-1 bg-slate-50">
        <div className="p-4">
          <div className="max-w-2xl space-y-6">
            {settingsGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
                  {group.title}
                </h3>
                <Card className="p-2">
                  {group.items.map((item, index) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.id}>
                        <Button
                          variant="ghost"
                          className="w-full justify-between h-auto py-3 px-3 hover:bg-purple-50"
                        >
                          <div className="flex items-center gap-3">
                            <Icon
                              size={18}
                              className="text-slate-600 shrink-0"
                            />
                            <span className="text-sm font-medium text-slate-900">
                              {item.label}
                            </span>
                          </div>
                          <ChevronRight size={16} className="text-slate-400" />
                        </Button>
                        {index < group.items.length - 1 && (
                          <Separator className="my-1" />
                        )}
                      </div>
                    );
                  })}
                </Card>
              </div>
            ))}

            {/* App Info */}
            <Card className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-purple-600 rounded-2xl flex items-center justify-center">
                <span className="text-3xl">🏋</span>
              </div>
              <h3 className="font-semibold text-lg mb-1">Weight Watch</h3>
              <p className="text-sm text-slate-500 mb-2">Version 1.0.0</p>
              <p className="text-xs text-slate-400">
                © 2025 Weight Watch Team. All rights reserved.
              </p>
            </Card>
          </div>
        </div>
      </ScrollArea>
    </main>
  );
}
