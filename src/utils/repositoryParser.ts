/**
 * Parses a repository name to create a human-readable workspace name
 * @param repoName - The repository name to parse
 * @returns A formatted workspace name
 */
export function parseRepositoryName(repoName: string): string {
  // If the repoName looks like a GitHub URL, extract the repo name
  const urlMatch = repoName.match(/github\.com\/[^/]+\/([^/?#]+)/i);
  let parsedName = repoName;

  if (urlMatch) {
    parsedName = urlMatch[1];
  }

  // Split camelCase and PascalCase into words, then capitalize
  parsedName = parsedName
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (l) => l.toUpperCase());

  return parsedName;
}

/**
 * Sanitizes a workspace name to create a valid domain name
 * @param workspaceName - The workspace name to sanitize
 * @returns A sanitized domain name
 */
export function sanitizeWorkspaceName(workspaceName: string): string {
  return workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // replace invalid domain chars with dash
    .replace(/-+/g, "-") // collapse multiple dashes
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes
}
