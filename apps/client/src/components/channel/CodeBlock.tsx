import { useState, useMemo, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-php";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-dart";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";

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
    if (grammar) {
      return Prism.highlight(code, grammar, resolvedLang);
    }
    // Fallback: escape HTML for plain text display
    return code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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
