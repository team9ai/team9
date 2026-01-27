import { Search, ArrowLeft, ArrowRight, History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser, useWorkspaceStore } from "@/stores";
import { useUserWorkspaces } from "@/hooks/useWorkspace";

export function GlobalTopBar() {
  const { t } = useTranslation("common");
  const user = useUser();
  const { selectedWorkspaceId } = useWorkspaceStore();
  const { data: workspaces } = useUserWorkspaces();

  const currentWorkspace = workspaces?.find(
    (w) => w.id === selectedWorkspaceId,
  );
  const workspaceName = currentWorkspace?.name || "Workspace";

  return (
    <header className="h-11 bg-[#3f1651] flex items-center px-2 gap-2 shrink-0">
      {/* Left section - Navigation buttons */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
          onClick={() => window.history.back()}
        >
          <ArrowLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
          onClick={() => window.history.forward()}
        >
          <ArrowRight size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
        >
          <History size={16} />
        </Button>
      </div>

      {/* Center section - Search bar */}
      <div className="flex-1 max-w-2xl mx-auto">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 z-10"
          />
          <Input
            type="text"
            placeholder={`${t("searchPlaceholder")} ${workspaceName}`}
            className="pl-9 h-7 bg-white/10 border-white/20 text-white text-sm placeholder:text-white/50 focus:bg-white/15 rounded-md"
          />
        </div>
      </div>

      {/* Right section - User avatar */}
      <div className="flex items-center">
        <Avatar className="h-7 w-7 cursor-pointer">
          <AvatarImage src={user?.avatarUrl || undefined} />
          <AvatarFallback className="bg-purple-600 text-white text-xs">
            {user?.name?.[0] || "U"}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
