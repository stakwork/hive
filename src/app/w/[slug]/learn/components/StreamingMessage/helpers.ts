import { FINAL_ANSWER_TOOL, WEB_SEARCH_TOOL } from "./constants";

export interface WebSearchResult {
  url: string;
  title?: string;
}

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
 * Converts citation tags to markdown links using web search results
 */
export function convertCitationsToLinks(
  text: string,
  webSearchResults: WebSearchResult[]
): string {
  return text.replace(
    /<cite index="(\d+)-\d+">(.*?)<\/cite>/g,
    (_match: string, index: string, text: string) => {
      const resultIndex = parseInt(index) - 1; // Convert to 0-indexed
      if (webSearchResults[resultIndex]) {
        const result = webSearchResults[resultIndex];
        return `[${text}](${result.url})`;
      }
      return text;
    }
  );
}

/**
 * Extracts answer from tool output
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
 * Tool-specific processors for handling different tool outputs
 */
export const toolProcessors = {
  [WEB_SEARCH_TOOL]: (output: unknown): WebSearchResult[] => {
    if (Array.isArray(output)) {
      return output.map((result: { url: string; title?: string }) => ({
        url: result.url,
        title: result.title,
      }));
    }
    return [];
  },

  [FINAL_ANSWER_TOOL]: (
    output: unknown,
    webSearchResults: WebSearchResult[]
  ): string => {
    let answer = extractAnswer(output);

    if (typeof answer === "string") {
      answer = cleanXMLTags(answer);
      answer = convertCitationsToLinks(answer, webSearchResults);
    }

    return answer;
  },
};
