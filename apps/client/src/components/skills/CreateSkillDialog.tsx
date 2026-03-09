import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  FileText,
  Sparkles,
  Upload,
  ArrowLeft,
  MessageSquareText,
  Wrench,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateSkill } from "@/hooks/useSkills";
import {
  SKILL_TEMPLATES,
  type SkillTemplate,
} from "@/constants/skillTemplates";
import type { SkillType } from "@/types/skill";

interface CreateSkillDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type CreationMethod = "blank" | "template" | "upload";
type Step = 1 | 2;

const SKILL_TYPES: { value: SkillType; icon: typeof Sparkles }[] = [
  { value: "claude_code_skill", icon: Sparkles },
  { value: "prompt_template", icon: MessageSquareText },
  { value: "general", icon: Wrench },
];

export function CreateSkillDialog({ isOpen, onClose }: CreateSkillDialogProps) {
  const { t } = useTranslation("skills");
  const createMutation = useCreateSkill();

  const [step, setStep] = useState<Step>(1);
  const [method, setMethod] = useState<CreationMethod | null>(null);
  const [selectedTemplate, setSelectedTemplate] =
    useState<SkillTemplate | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<SkillType>("general");
  const [uploadedFiles, setUploadedFiles] = useState<
    { path: string; content: string }[]
  >([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleClose() {
    setStep(1);
    setMethod(null);
    setSelectedTemplate(null);
    setName("");
    setDescription("");
    setType("general");
    setUploadedFiles([]);
    createMutation.reset();
    onClose();
  }

  function handleSelectMethod(m: CreationMethod) {
    setMethod(m);
    setStep(2);
  }

  function handleSelectTemplate(tmpl: SkillTemplate) {
    setSelectedTemplate(tmpl);
    setType(tmpl.type);
    setMethod("template");
    setStep(2);
  }

  const handleFileUpload = useCallback((files: FileList | null) => {
    if (!files) return;
    const promises = Array.from(files).map(
      (file) =>
        new Promise<{ path: string; content: string } | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              resolve({ path: file.name, content: reader.result });
            } else {
              resolve(null);
            }
          };
          reader.onerror = () => resolve(null);
          reader.readAsText(file);
        }),
    );
    Promise.all(promises).then((results) => {
      const valid = results.filter(
        (r): r is { path: string; content: string } => r !== null,
      );
      if (valid.length > 0) {
        setUploadedFiles((prev) => [...prev, ...valid]);
      }
    });
  }, []);

  function handleCreate() {
    let files: { path: string; content: string }[] | undefined;
    if (method === "template" && selectedTemplate) {
      files = selectedTemplate.files;
    } else if (method === "upload" && uploadedFiles.length > 0) {
      files = uploadedFiles;
    }

    createMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        files,
      },
      { onSuccess: handleClose },
    );
  }

  const canCreate = name.trim().length > 0 && !createMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
        </DialogHeader>

        {/* Step 1: Select method */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("create.method")}
            </p>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-accent/50 transition-colors text-left"
                onClick={() => handleSelectMethod("blank")}
              >
                <FileText
                  size={20}
                  className="text-muted-foreground shrink-0"
                />
                <div>
                  <div className="text-sm font-medium">{t("create.blank")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("create.blankDescription")}
                  </div>
                </div>
              </button>

              <button
                type="button"
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-accent/50 transition-colors text-left"
                onClick={() => handleSelectMethod("upload")}
              >
                <Upload size={20} className="text-muted-foreground shrink-0" />
                <div>
                  <div className="text-sm font-medium">
                    {t("create.upload")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("create.uploadDescription")}
                  </div>
                </div>
              </button>
            </div>

            {/* Templates */}
            <div className="pt-1">
              <p className="text-sm text-muted-foreground mb-2">
                {t("template.selectTemplate")}
              </p>
              <div className="grid grid-cols-1 gap-2">
                {SKILL_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-accent/50 transition-colors text-left"
                    onClick={() => handleSelectTemplate(tmpl)}
                  >
                    <Sparkles
                      size={20}
                      className="text-muted-foreground shrink-0"
                    />
                    <div>
                      <div className="text-sm font-medium">
                        {t(tmpl.name as never)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t(tmpl.descriptionKey as never)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Fill info */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("create.name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("create.namePlaceholder")}
                maxLength={255}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("create.description")}</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("create.descriptionPlaceholder")}
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("create.type")}</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as SkillType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SKILL_TYPES.map(({ value, icon: Icon }) => (
                    <SelectItem key={value} value={value}>
                      <div className="flex items-center gap-2">
                        <Icon size={14} />
                        {t(`type.${value}` as const)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Upload area for upload method */}
            {method === "upload" && (
              <div className="space-y-1.5">
                <Label>{t("create.files")}</Label>
                <div
                  className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border p-6 text-muted-foreground cursor-pointer hover:bg-accent/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleFileUpload(e.dataTransfer.files);
                  }}
                >
                  <Upload size={24} />
                  <span className="text-sm">{t("create.dragDrop")}</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
                {uploadedFiles.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {uploadedFiles.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-sm text-muted-foreground"
                      >
                        <FileText size={14} />
                        {f.path}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Template preview */}
            {method === "template" && selectedTemplate && (
              <div className="space-y-1.5">
                <Label>{t("create.files")}</Label>
                <div className="space-y-1">
                  {selectedTemplate.files.map((f) => (
                    <div
                      key={f.path}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <FileText size={14} />
                      {f.path}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {(createMutation.error as Error)?.message ||
                  t("create.creating")}
              </p>
            )}

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setStep(1);
                  setMethod(null);
                  setSelectedTemplate(null);
                }}
              >
                <ArrowLeft size={14} className="mr-1" />
                {t("create.back")}
              </Button>
              <Button onClick={handleCreate} disabled={!canCreate}>
                {createMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                )}
                {t("create.create")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
