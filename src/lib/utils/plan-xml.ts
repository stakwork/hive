/**
 * Parse plan XML content from PLAN artifacts.
 * Extracts flat tags: <brief>, <userStories>, <requirements>, <architecture>,
 * plus the optional repeating <next_step> suggestion-chip tags.
 */
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

  const nextSteps = [...xml.matchAll(/<next_step>([\s\S]*?)<\/next_step>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    brief: extract("brief"),
    userStories: extract("userStories"),
    requirements: extract("requirements"),
    architecture: extract("architecture"),
    nextSteps: nextSteps.length ? nextSteps : undefined,
  };
}
