import { useState, useMemo, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import Prism from "@/lib/prism";
import { sanitizeMessageHtml } from "@/lib/sanitize";

interface CodeBlockProps {
  code: string;
  language?: string;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  svg: "markup",
  cs: "csharp",
  "c++": "cpp",
  "c#": "csharp",
  dockerfile: "docker",
  md: "markdown",
};

function resolveLanguage(lang: string): string {
  const lower = lang.toLowerCase();
  return LANGUAGE_ALIASES[lower] || lower;
}

export function CodeBlock({ code, language = "" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const resolvedLang = resolveLanguage(language);
  const displayLang = language || "text";

  const highlightedHtml = useMemo(() => {
    const grammar = Prism.languages[resolvedLang];
    const raw = grammar
      ? Prism.highlight(code, grammar, resolvedLang)
      : code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return sanitizeMessageHtml(raw);
  }, [code, resolvedLang]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-language">{displayLang}</span>
        <button type="button" className="code-block-copy" onClick={handleCopy}>
          {copied ? (
            <span className="flex items-center gap-1">
              <Check size={14} /> Copied
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Copy size={14} /> Copy
            </span>
          )}
        </button>
      </div>
      <pre className="code-block-pre">
        <code
          className={`language-${resolvedLang}`}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    </div>
  );
}
