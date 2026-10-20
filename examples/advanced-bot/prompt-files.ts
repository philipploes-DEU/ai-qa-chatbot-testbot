/**
 * Builds the system prompt of the advanced bot from files instead of the built-in Hilde
 * prompt (issue #66). This lets a workspace under workspaces/ rebuild its own bot locally with
 * a prompt and a knowledge base that never enter the repository.
 *
 * Conventions: a prompt file may carry notes above and below its prompt; then the prompt is the
 * block between the first and the last line that is exactly "---". A knowledge base file may
 * start with a header (title, date, source) that ends at its first "---" line. In the prompt,
 * {{WISSENSBASIS}} becomes the knowledge base and {{DATUM}} the current date (DD.MM.YYYY).
 */
const SEPARATOR = /^---\s*$/;

export function extractPromptBlock(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const marks = lines.flatMap((line, index) => (SEPARATOR.test(line) ? [index] : []));
  const first = marks[0];
  const last = marks.at(-1);
  if (first === undefined || last === undefined || first === last) return text.trim();
  return lines
    .slice(first + 1, last)
    .join("\n")
    .trim();
}

export function stripHeader(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => SEPARATOR.test(line));
  return (first === -1 ? lines : lines.slice(first + 1)).join("\n").trim();
}

function formatDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear())}`;
}

export function buildPromptFromFiles(
  promptText: string,
  knowledgeText: string | undefined,
  now: Date = new Date(),
): string {
  const knowledge = knowledgeText === undefined ? "" : stripHeader(knowledgeText);
  return extractPromptBlock(promptText)
    .replaceAll("{{WISSENSBASIS}}", knowledge)
    .replaceAll("{{DATUM}}", formatDate(now));
}
