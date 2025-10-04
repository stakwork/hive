/**
 * Cleans XML tags from AI response text
 */
export function cleanXMLTags(text: string): string {
  return text
    .replace(/<function_calls>\s*/gi, "")
    .replace(/<\/function_calls>\s*/gi, "")
    .replace(/<invoke[^>]*>\s*/gi, "")
    .replace(/<\/invoke>\s*/gi, "")
    .replace(/<parameter[^>]*>/gi, "")
    .replace(/<\/parameter>\s*/gi, "")
    .trim();
}

/**
 * Extracts answer from tool output (handles string or object with answer field)
 */
export function extractAnswer(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (typeof output === "object" && output !== null && "answer" in output) {
    return String((output as { answer?: string }).answer);
  }
  return JSON.stringify(output);
}

/**
 * Parses Server-Sent Events (SSE) data line
 */
export function parseSSELine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;

  const jsonStr = trimmed.replace(/^data:\s*/, "").trim();
  if (!jsonStr || jsonStr === "[DONE]") return null;

  return jsonStr;
}
