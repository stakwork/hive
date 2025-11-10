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

/**
 * Parses a GitHub repository URL to extract owner and repo name
 * Supports multiple formats:
 * - SSH: git@github.com:owner/repo.git
 * - HTTPS: https://github.com/owner/repo
 * - HTTP: http://github.com/owner/repo
 * - Partial: github.com/owner/repo
 * 
 * @param repositoryUrl - The GitHub repository URL to parse
 * @returns Object with owner and repo properties
 * @throws Error if URL is not a valid GitHub repository URL
 */
export function parseGithubOwnerRepo(repositoryUrl: string): {
  owner: string;
  repo: string;
} {
  // Try SSH format first: git@github.com:owner/repo.git
  const ssh = repositoryUrl.match(/^git@github\.com:(.+?)\/(.+?)(?:\.git)?$/i);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2].replace(/\.git$/i, "") };
  }

  // Try URL format (HTTPS/HTTP with or without protocol)
  try {
    const u = new URL(repositoryUrl);
    if (!/github\.com$/i.test(u.hostname)) {
      throw new Error("Not GitHub host");
    }
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    if (parts.length < 2) {
      throw new Error("Invalid repo path");
    }
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
  } catch {
    // Fallback: Try matching github.com/owner/repo pattern without URL parsing
    // This handles cases like "github.com/owner/repo" without protocol
    const https = repositoryUrl.match(
      /github\.com[\/:]([^\/]+)\/([^/?#]+)(?:\.git)?/i,
    );
    if (https) {
      return { owner: https[1], repo: https[2].replace(/\.git$/i, "") };
    }
    throw new Error("Unable to parse GitHub repository URL");
  }
}
