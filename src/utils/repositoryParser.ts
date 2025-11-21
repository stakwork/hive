export function parseGithubOwnerRepo(repositoryUrl: string): {
  owner: string;
  repo: string;
} {
  const ssh = repositoryUrl.match(/^git@github\.com:(.+?)\/(.+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2].replace(/\.git$/i, "") };
  try {
    const u = new URL(repositoryUrl);
    if (!/github\.com$/i.test(u.hostname)) throw new Error("Not GitHub host");
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    if (parts.length < 2) throw new Error("Invalid repo path");
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
  } catch {
    const https = repositoryUrl.match(/github\.com\/([^/]+)\/([^/?#]+)(?:\.git)?/i);
    if (https) return { owner: https[1], repo: https[2].replace(/\.git$/i, "") };
    throw new Error("Unable to parse GitHub repository URL");
  }
}
