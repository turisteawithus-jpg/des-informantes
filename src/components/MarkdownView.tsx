import { marked } from "marked";
import { useMemo } from "react";

export function MarkdownView({ content }: { content: string }) {
  const html = useMemo(() => marked.parse(content, { async: false }) as string, [content]);
  return <div className="prose-di" dangerouslySetInnerHTML={{ __html: html }} />;
}
