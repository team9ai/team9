import { useState, useEffect } from "react";
import { FolderPlus, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateSection } from "@/hooks/useSections";
import { useTranslation } from "react-i18next";

interface CreateSectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function validateSectionName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Section name is required" };
  }
  if (name.length > 100) {
    return {
      valid: false,
      error: "Section name must be 100 characters or less",
    };
  }
  return { valid: true };
}

export function CreateSectionDialog({
  isOpen,
  onClose,
}: CreateSectionDialogProps) {
  const { t: tNav } = useTranslation("navigation");
  const createSection = useCreateSection();

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (name) {
      const validation = validateSectionName(name);
      setNameError(validation.valid ? null : validation.error || null);
    } else {
      setNameError(null);
    }
  }, [name]);

  const handleCreate = async () => {
    const validation = validateSectionName(name);
    if (!validation.valid) {
      setNameError(validation.error || "Invalid section name");
      return;
    }

    try {
      await createSection.mutateAsync({ name: name.trim() });
      handleClose();
    } catch (error) {
      console.error("Failed to create section:", error);
    }
  };

  const resetForm = () => {
    setName("");
    setNameError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const canCreate = name.trim() && !nameError;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus size={20} />
            {tNav("createSection")}
          </DialogTitle>
          <DialogDescription>
            {tNav("createSectionDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="section-name">{tNav("sectionName")}</Label>
            <Input
              id="section-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tNav("sectionNamePlaceholder")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
            {nameError && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={12} />
                {nameError}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose}>
            {tNav("cancel")}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!canCreate || createSection.isPending}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {createSection.isPending ? tNav("creating") : tNav("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
