import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

/** Render markdown to sanitized HTML safe for dangerouslySetInnerHTML. */
export function renderMarkdown(text: string): string {
  if (!text) return "";
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
