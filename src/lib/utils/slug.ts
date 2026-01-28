/**
 * Extracts repo name from a GitHub repository URL
 */
export function extractRepoNameFromUrl(url: string): string | null {
  const match = url.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
  return match ? match[2].toLowerCase() : null;
}

/**
 * Finds the next available indexed name from a pool of existing names.
 * E.g., if "repo" and "repo-1" exist, returns "repo-2"
 */
export function nextIndexedName(base: string, pool: string[]): string {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}(?:-(\\d+))?$`, "i");

  let max = -1;
  for (const name of pool) {
    const m = name.match(re);
    if (!m) continue;
    const idx = m[1] ? Number(m[1]) : 0;
    if (idx > max) max = idx;
  }

  const next = max + 1;
  return next === 0 ? base : `${base}-${next}`;
}
