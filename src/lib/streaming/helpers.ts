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
  console.log("[PARSE SSE] Raw line:", trimmed.substring(0, 150));

  if (!trimmed.startsWith("data:")) {
    // AI SDK v3+ uses "0:" prefix format instead of "data:"
    if (trimmed.match(/^\d+:/)) {
      const jsonStr = trimmed.replace(/^\d+:/, "").trim();
      if (!jsonStr || jsonStr === "[DONE]") return null;
      console.log("[PARSE SSE] Extracted (numeric prefix):", jsonStr.substring(0, 150));
      return jsonStr;
    }
    return null;
  }

  const jsonStr = trimmed.replace(/^data:\s*/, "").trim();
  if (!jsonStr || jsonStr === "[DONE]") return null;

  console.log("[PARSE SSE] Extracted (data prefix):", jsonStr.substring(0, 150));
  return jsonStr;
}
