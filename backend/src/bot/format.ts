/**
 * Telegram's legacy Markdown parser treats these characters as formatting
 * delimiters. Escape only dynamic values; keep deliberate formatting in the
 * surrounding template strings readable.
 */
export function escapeMarkdown(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/([_*`[\]])/g, "\\$1");
}

export function hashtag(value: unknown): string {
  return `#${escapeMarkdown(String(value ?? "").replace(/\s+/g, "_"))}`;
}
