/**
 * Parse plan XML content from PLAN artifacts.
 * Extracts flat tags: <brief>, <userStories>, <requirements>, <architecture>,
 * plus the optional repeating <next_step> suggestion-chip tags.
 */

/**
 * Suggestion chips belong to the turn that just landed, so they are the tags
 * following the last `<message>`. A payload sometimes echoes an earlier
 * `<message>…</message><next_step>…` block; a document-wide scan then mixes
 * both turns together, and since the list is capped the echo pushes real chips
 * out — a doubled 3-tag block rendered as A, B, C, A.
 *
 * `lastIndexOf` returns -1 for a payload with no message wrapper, slicing from
 * 0: the whole document, which is the right scope for that shape. Repeats are
 * dropped either way, so an echo without a wrapper collapses too.
 */
function extractNextSteps(xml: string): string[] {
  const currentTurn = xml.slice(xml.lastIndexOf("</message>") + 1);
  const seen = new Set<string>();

  return [...currentTurn.matchAll(/<next_step>([\s\S]*?)<\/next_step>/g)]
    .map((m) => m[1].trim())
    .filter((step) => {
      if (!step) return false;
      const key = step.replace(/\s+/g, " ").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

export function parsePlanXml(xml: string): {
  brief?: string;
  userStories?: string;
  requirements?: string;
  architecture?: string;
  nextSteps?: string[];
} {
  const extract = (tag: string): string | undefined => {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match?.[1]?.trim() || undefined;
  };

  const nextSteps = extractNextSteps(xml);

  return {
    brief: extract("brief"),
    userStories: extract("userStories"),
    requirements: extract("requirements"),
    architecture: extract("architecture"),
    nextSteps: nextSteps.length ? nextSteps : undefined,
  };
}
