export function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Returns the content of a markdown code fence if there is one, otherwise the trimmed text. */
export function extractJsonText(content: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  return (fenced?.[1] ?? content).trim();
}
