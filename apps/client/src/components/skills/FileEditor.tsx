import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Save, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SkillFile } from "@/types/skill";

interface FileEditorProps {
  file: SkillFile;
  readOnly?: boolean;
  onSave?: (content: string) => void;
}

export function FileEditor({ file, readOnly, onSave }: FileEditorProps) {
  const { t } = useTranslation("skills");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(file.content);

  useEffect(() => {
    setEditContent(file.content);
    setIsEditing(false);
  }, [file.path, file.content]);

  function handleSave() {
    onSave?.(editContent);
    setIsEditing(false);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText size={14} />
          <span className="font-mono">{file.path}</span>
        </div>
        {!readOnly && (
          <div className="flex gap-1.5">
            {isEditing ? (
              <Button size="sm" variant="default" onClick={handleSave}>
                <Save size={14} className="mr-1" />
                {t("detail.save")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsEditing(true)}
              >
                <Pencil size={14} className="mr-1" />
                {t("detail.edit")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isEditing ? (
          <textarea
            className="w-full h-full p-4 font-mono text-sm bg-transparent border-none outline-none resize-none"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <pre className="p-4 font-mono text-sm whitespace-pre-wrap break-words">
            {file.content}
          </pre>
        )}
      </div>
    </div>
  );
}
