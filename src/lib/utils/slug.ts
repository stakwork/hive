/**
 * Validates workspace slug format on the client.
 * Mirrors WORKSPACE_SLUG_PATTERNS.VALID and WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
 * from src/lib/constants.ts — kept here to avoid pulling @prisma/client into the client bundle.
 */
const SLUG_VALID_RE = /^[a-z0-9]([a-z0-9_-])*[a-z0-9]$|^[a-z0-9]$/;
const SLUG_MIN = 2;
const SLUG_MAX = 50;
const SLUG_FORMAT_MSG =
  "Workspace name must start and end with letters or numbers, and can only contain letters, numbers, hyphens, and underscores.";

export function validateWorkspaceSlugFormat(name: string): { valid: boolean; error?: string } {
  const v = name.trim();
  if (v.length < SLUG_MIN || v.length > SLUG_MAX) {
    return { valid: false, error: "Workspace name must be between 2 and 50 characters." };
  }
  if (!SLUG_VALID_RE.test(v)) {
    return { valid: false, error: SLUG_FORMAT_MSG };
  }
  return { valid: true };
}

/**
 * Extracts repo name from a GitHub repository URL and sanitizes it for use as a workspace slug
 * Converts unsupported characters (periods, etc.) to hyphens while preserving underscores
 */
export function extractRepoNameFromUrl(url: string): string | null {
  const match = url.match(/github\.com[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/);
  if (!match) return null;
  
  const repoName = match[2].toLowerCase();
  // Replace unsupported characters with hyphens, preserving underscores and alphanumerics
  return repoName.replace(/[^a-z0-9_-]/g, '-');
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
