import { useRef, useEffect, useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, ArrowLeft, ArrowRight, History, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { useUser, useWorkspaceStore } from "@/stores";
import { useUserWorkspaces } from "@/hooks/useWorkspace";
import { useDebouncedQuickSearch } from "@/hooks/useSearch";
import { QuickSearchResults } from "@/components/search/QuickSearchResults";

export function GlobalTopBar() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const user = useUser();
  const { selectedWorkspaceId } = useWorkspaceStore();
  const { data: workspaces } = useUserWorkspaces();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Quick search for channels and users only
  const { searchQuery, updateQuery, clearSearch, data, isLoading, isFetching } =
    useDebouncedQuickSearch(300);

  const currentWorkspace = workspaces?.find(
    (w) => w.id === selectedWorkspaceId,
  );
  const workspaceName = currentWorkspace?.name || "Workspace";

  // Navigate to search page for full search (default to messages)
  const handleDeepSearch = useCallback(() => {
    if (searchQuery.trim()) {
      navigate({
        to: "/search",
        search: { q: searchQuery.trim(), type: "messages" },
      });
      setIsOpen(false);
      clearSearch();
    }
  }, [navigate, searchQuery, clearSearch]);

  // Handle keyboard shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
        inputRef.current?.blur();
      }
      // Enter key navigates to search page
      if (e.key === "Enter" && isOpen && searchQuery.trim()) {
        e.preventDefault();
        handleDeepSearch();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, searchQuery, handleDeepSearch]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      updateQuery(value);
      if (value.trim()) {
        setIsOpen(true);
      }
    },
    [updateQuery],
  );

  const handleInputFocus = useCallback(() => {
    if (searchQuery.trim()) {
      setIsOpen(true);
    }
  }, [searchQuery]);

  const handleClear = useCallback(() => {
    clearSearch();
    setIsOpen(false);
    inputRef.current?.focus();
  }, [clearSearch]);

  const handleSelect = useCallback(() => {
    setIsOpen(false);
    clearSearch();
  }, [clearSearch]);

  return (
    <header className="h-11 bg-nav-bg flex items-center px-2 gap-2 shrink-0">
      {/* Left section - Navigation buttons */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-nav-foreground-subtle hover:text-nav-foreground hover:bg-nav-hover"
          onClick={() => window.history.back()}
        >
          <ArrowLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-nav-foreground-subtle hover:text-nav-foreground hover:bg-nav-hover"
          onClick={() => window.history.forward()}
        >
          <ArrowRight size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-nav-foreground-subtle hover:text-nav-foreground hover:bg-nav-hover"
        >
          <History size={16} />
        </Button>
      </div>

      {/* Center section - Search bar */}
      <div className="flex-1 max-w-2xl mx-auto">
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverAnchor asChild>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-nav-foreground-faint z-10"
              />
              <Input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                placeholder={`${t("searchPlaceholder")} ${workspaceName}`}
                className="pl-9 pr-8 h-7 bg-nav-input-bg border-nav-border-strong text-nav-foreground text-sm placeholder:text-nav-foreground-faint focus:bg-nav-input-bg-focus rounded-md"
              />
              {searchQuery && (
                <button
                  onClick={handleClear}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-nav-foreground-faint hover:text-nav-foreground-muted transition-colors"
                >
                  <X size={14} />
                </button>
              )}
              {/* Loading indicator */}
              {isFetching && (
                <div className="absolute right-8 top-1/2 -translate-y-1/2">
                  <div className="h-3 w-3 border-2 border-nav-spinner-border border-t-nav-spinner-border-top rounded-full animate-spin" />
                </div>
              )}
              {/* Keyboard shortcut hint */}
              {!searchQuery && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-nav-foreground-dim text-xs hidden sm:block">
                  ⌘K
                </div>
              )}
            </div>
          </PopoverAnchor>
          <PopoverContent
            className="w-150 p-2"
            align="start"
            sideOffset={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <QuickSearchResults
              data={data}
              isLoading={isLoading}
              searchQuery={searchQuery}
              onSelect={handleSelect}
              onDeepSearch={handleDeepSearch}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Right section - User avatar */}
      {/* <div className="flex items-center">
        <Avatar className="h-7 w-7 cursor-pointer">
          <AvatarImage src={user?.avatarUrl || undefined} />
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {user?.name?.[0] || "U"}
          </AvatarFallback>
        </Avatar>
      </div> */}
    </header>
  );
}
