import type { ToolProcessorMap } from "@/types/streaming";
import { cleanXMLTags, extractAnswer } from "@/lib/streaming/helpers";

// Learn-specific constants
export const FINAL_ANSWER_ID = "final-answer";
export const FINAL_ANSWER_TOOL = "final_answer";
export const WEB_SEARCH_TOOL = "web_search";

export interface WebSearchResult {
  url: string;
  title?: string;
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
      const resultIndex = parseInt(index) - 1;
      if (webSearchResults[resultIndex]) {
        const result = webSearchResults[resultIndex];
        return `[${text}](${result.url})`;
      }
      return text;
    }
  );
}

/**
 * Tool processors for Learn feature
 */
export const learnToolProcessors: ToolProcessorMap = {
  [WEB_SEARCH_TOOL]: (output): WebSearchResult[] => {
    if (Array.isArray(output)) {
      return output.map((result: { url: string; title?: string }) => ({
        url: result.url,
        title: result.title,
      }));
    }
    return [];
  },

  [FINAL_ANSWER_TOOL]: (output, context): string => {
    let answer = extractAnswer(output);

    if (typeof answer === "string") {
      answer = cleanXMLTags(answer);

      // Use web search results from context if available
      const webSearchResults = (context?.[WEB_SEARCH_TOOL] as WebSearchResult[]) || [];
      answer = convertCitationsToLinks(answer, webSearchResults);
    }

    return answer;
  },
};
