/**
 * Parse plan XML content from PLAN artifacts.
 * Extracts flat tags: <brief>, <userStories>, <requirements>, <architecture>
 */
export function parsePlanXml(xml: string): {
  brief?: string;
  userStories?: string;
  requirements?: string;
  architecture?: string;
} {
  const extract = (tag: string): string | undefined => {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match?.[1]?.trim() || undefined;
  };

  return {
    brief: extract("brief"),
    userStories: extract("userStories"),
    requirements: extract("requirements"),
    architecture: extract("architecture"),
  };
}
