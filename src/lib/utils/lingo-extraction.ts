/**
 * Pure jargon-density scorer — no external dependencies.
 * Used to filter messages before sending to the LLM for term extraction.
 *
 * Scoring rules:
 *  +2 per capital-start token (e.g. "Hive", "StakworkRun")
 *  +3 per ALL-CAPS acronym (e.g. "LSAT", "WFE", "API")
 *  +4 per quoted phrase of 2–30 chars (e.g. '"hub workspace"')
 *  +4 per camelCase token (e.g. "chatMessage", "addNodeBulk")
 *  -10 if the trimmed text is shorter than 10 characters
 */
export function jargonScore(text: string): number {
  let score = 0;

  const capitalTokens = text.match(/(?<!\.\s)\b[A-Z][a-zA-Z0-9]{1,}\b/g) ?? [];
  score += capitalTokens.length * 2;

  const acronyms = text.match(/\b[A-Z]{2,}\b/g) ?? [];
  score += acronyms.length * 3;

  const quoted = text.match(/["']([^"']{2,30})["']/g) ?? [];
  score += quoted.length * 4;

  const camel = text.match(/\b[a-z]+[A-Z][a-zA-Z0-9]+\b/g) ?? [];
  score += camel.length * 4;

  if (text.trim().length < 10) score -= 10;

  return score;
}
