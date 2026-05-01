import { useState } from "react";
import { Library, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useWikis } from "@/hooks/useWikis";
import { WikiListItem } from "@/components/wiki/WikiListItem";
import { CreateWikiDialog } from "@/components/wiki/CreateWikiDialog";

/**
 * Sub-sidebar for the Wiki tab. Renders a list of the user's wikis and
 * lazily fetches each wiki's tree when the row is expanded. Creation is
 * surfaced via the `+` button in the header — the dialog itself is a stub
 * until Task 20, but the wiring is stable.
 *
 * Archived wikis are filtered server-side by `wikisApi.list` (the gateway's
 * `WikisService.listWikis` excludes rows where `archivedAt is not null`), so
 * this component renders every wiki it receives.
 */
export function WikiSubSidebar() {
  const { t } = useTranslation("navigation");
  const { t: tWiki } = useTranslation("wiki");
  const { data: wikis, isLoading } = useWikis();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Library size={18} className="text-primary" />
          <h2 className="font-semibold text-sm">{t("wiki")}</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("createWiki")}
            title={t("createWiki")}
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
          </Button>
        </div>
      </header>
      <Separator />
      <ScrollArea className="flex-1 py-2">
        {isLoading && (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            {tWiki("sidebar.loading")}
          </p>
        )}
        {!isLoading && (!wikis || wikis.length === 0) && (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            {tWiki("sidebar.empty")}
          </p>
        )}
        {wikis && wikis.length > 0 && (
          <div
            role="tree"
            aria-label={t("wiki")}
            data-testid="wiki-sub-sidebar-tree"
          >
            {wikis.map((wiki) => (
              <WikiListItem key={wiki.id} wiki={wiki} />
            ))}
          </div>
        )}
      </ScrollArea>
      <CreateWikiDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
