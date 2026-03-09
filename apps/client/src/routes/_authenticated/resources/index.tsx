import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ResourceList } from "@/components/resources/ResourceList";
import { CreateResourceDialog } from "@/components/resources/CreateResourceDialog";

export const Route = createFileRoute("/_authenticated/resources/")({
  component: ResourcesPage,
});

function ResourcesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );
  const { t } = useTranslation("resources");

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <Button size="sm" variant="ghost" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <ResourceList
          selectedResourceId={selectedResourceId}
          onSelectResource={setSelectedResourceId}
          onCreateClick={() => setShowCreate(true)}
        />
      </div>
      <CreateResourceDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => setSelectedResourceId(id)}
      />
    </div>
  );
}
