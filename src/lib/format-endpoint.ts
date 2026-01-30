/**
 * Generate a pretty label from an API endpoint path
 *
 * Examples:
 * - /api/system/signups-enabled => System Signups Enabled
 * - /api/cron/update-bitcoin-price => Update Bitcoin Price
 * - /api/travel-times => Travel Times
 * - /api/w/[slug]/tasks => Tasks
 *
 * Rules:
 * - Remove /api prefix
 * - Skip single-letter segments and Next.js dynamic segments like [slug]
 * - If final segment has 3+ words, use only that segment
 * - Otherwise use more segments for context
 * - Capitalize each word intelligently
 */
export function formatEndpointLabel(endpoint: string): string {
  // Remove leading slash and split into segments
  const segments = endpoint.replace(/^\//, "").split("/");

  // Filter out: "api", single-letter segments, and Next.js dynamic segments like [slug]
  const filteredSegments = segments.filter(
    (s) => s.toLowerCase() !== "api" && s.length > 1 && !s.startsWith("["),
  );

  if (filteredSegments.length === 0) {
    return endpoint; // fallback to original
  }

  // Convert a segment to words (split on dashes)
  const segmentToWords = (segment: string): string[] =>
    segment
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .filter((w) => w.length > 0);

  // Get words from the final segment
  const finalSegmentWords = segmentToWords(filteredSegments[filteredSegments.length - 1]);

  // If final segment has 3+ words, use only that
  if (finalSegmentWords.length >= 3) {
    return finalSegmentWords.join(" ");
  }

  // Otherwise, use all filtered segments
  const allWords = filteredSegments.flatMap(segmentToWords);
  return allWords.join(" ");
}
