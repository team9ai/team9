import type { EditorThemeClasses } from "lexical";

export const editorTheme: EditorThemeClasses = {
  paragraph: "mb-1 last:mb-0",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "bg-muted px-1 py-0.5 rounded font-mono text-sm",
  },
  list: {
    nested: {
      listitem: "list-none",
    },
    ol: "list-decimal list-inside ml-4",
    ul: "list-disc list-inside ml-4",
    listitem: "my-0.5",
    listitemChecked: "line-through text-muted-foreground",
    listitemUnchecked: "",
  },
  link: "text-primary hover:underline cursor-pointer",
  hashtag: "text-primary",
};
