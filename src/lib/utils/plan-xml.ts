/**
 * Parse plan XML content from PLAN artifacts.
 * Extracts flat tags: <brief>, <userStories>, <requirements>, <architecture>,
 * plus the optional repeating <next_step> suggestion-chip tags.
 */

/**
 * Suggestion chips belong to the turn that just landed, and that turn's tags
 * sit at the end of the document. When an agent payload echoes an earlier
 * `<message>…</message><next_step>…` block, a naive document-wide scan pulls
 * the echoed chips in too — and because the list is capped, the echo can push
 * the real chips out (a doubled 3-tag block renders as A, B, C, A).
 *
 * So: group the tags into contiguous runs — a run breaks on anything other
 * than whitespace between two tags — keep the last run that carries content,
 * and drop repeats within it.
 */
function extractNextSteps(xml: string): string[] {
  const runs: string[][] = [];
  let previousEnd = -1;

  for (const match of xml.matchAll(/<next_step>([\s\S]*?)<\/next_step>/g)) {
    const start = match.index ?? 0;
    const isContiguous = previousEnd >= 0 && xml.slice(previousEnd, start).trim() === "";
    if (!isContiguous) runs.push([]);
    runs[runs.length - 1].push(match[1].trim());
    previousEnd = start + match[0].length;
  }

  const trailingRun = runs.findLast((run) => run.some(Boolean)) ?? [];

  const seen = new Set<string>();
  return trailingRun
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
