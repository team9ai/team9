import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

export interface FinalReportViewProps {
  reportUrl: string | null | undefined;
}

// Fetches the final report Markdown from a pre-signed URL (usually S3) and
// renders it with GFM + syntax highlighting. Aborts cleanly on prop changes
// or unmount to avoid setting state on an unmounted component.
export function FinalReportView({ reportUrl }: FinalReportViewProps) {
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!reportUrl) return;
    let cancelled = false;
    setMd(null);
    setErr(null);
    fetch(reportUrl)
      .then((r) =>
        r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((text) => {
        if (!cancelled) setMd(text);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reportUrl]);

  if (!reportUrl) return null;
  if (err) {
    return (
      <div className="text-sm text-red-600">Failed to load report: {err}</div>
    );
  }
  if (!md) {
    return <div className="text-sm text-zinc-500">Loading report…</div>;
  }
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {md}
      </ReactMarkdown>
    </article>
  );
}
