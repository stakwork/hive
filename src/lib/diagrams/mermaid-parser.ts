/**
 * Extracts the body of the first fenced mermaid code block from a string.
 * Returns null if no mermaid block is found.
 */
export function extractMermaidBody(text: string): string | null {
  const match = /```mermaid\s*([\s\S]*?)```/.exec(text);
  return match ? match[1].trim() : null;
}
