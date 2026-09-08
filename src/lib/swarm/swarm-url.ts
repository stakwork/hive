/**
 * Derives the swarm vanity URL from an EC2 instance's tags.
 * Returns null when UserAssignedName is missing or blank so callers never
 * build `https://undefined.sphinx.chat`.
 *
 * Client-safe: no server-only imports.
 */
export function swarmUrlFromTags(
  tags: { key: string; value: string }[] | null | undefined,
): string | null {
  const name = tags?.find((t) => t.key === "UserAssignedName")?.value?.trim();
  if (!name) return null;
  return `https://${name}.sphinx.chat`;
}
