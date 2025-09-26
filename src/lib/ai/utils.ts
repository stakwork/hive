export function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } {
  // Handle different GitHub URL formats
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  // owner/repo

  let match: RegExpMatchArray | null = null;

  // Match https://github.com/owner/repo or https://github.com/owner/repo.git
  match = repoUrl.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  // Match git@github.com:owner/repo.git
  match = repoUrl.match(/^git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  // Match owner/repo format
  match = repoUrl.match(/^([^\/]+)\/([^\/]+)$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  throw new Error(`Invalid repository URL format: ${repoUrl}`);
}
