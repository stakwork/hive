/**
 * Parses a repository name to create a human-readable workspace name
 * @param repoName - The repository name to parse
 * @returns A formatted workspace name
 */
export function parseRepositoryName(repoName: string): string {
  // If the repoName looks like a GitHub URL, extract the repo name
  const httpsMatch = repoName.match(/https?:\/\/(?:www\.)?github\.com\/[^/]+\/([^/?#]+)/i);
  const sshMatch = repoName.match(/git@github\.com:(.+?)\/(.+?)(?:\.git)?$/i);
  
  let parsedName = repoName;

  if (httpsMatch) {
    parsedName = httpsMatch[1];
  } else if (sshMatch) {
    parsedName = sshMatch[2];
  }

  // Remove .git suffix if present
  parsedName = parsedName.replace(/\.git$/i, "");

  // Split camelCase and PascalCase into words, then capitalize
  parsedName = parsedName
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1$2") // Keep letters and numbers together
    .replace(/(\d)([A-Z])/g, "$1 $2") // Add space after numbers before caps
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

export function parseGithubOwnerRepo(repositoryUrl: string): {
  owner: string;
  repo: string;
} | null {
  const ssh = repositoryUrl.match(/^git@github\.com:(.+?)\/(.+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2].replace(/\.git$/i, "") };
  try {
    const u = new URL(repositoryUrl);
    if (!/github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
  } catch {
    const https = repositoryUrl.match(
      /github\.com\/([^/]+)\/([^/?#]+)(?:\.git)?/i,
    );
    if (https)
      return { owner: https[1], repo: https[2].replace(/\.git$/i, "") };
    return null;
  }
}
