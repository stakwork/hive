# GitSee Server Extraction - Useful Code for Cross-Repo Org Mapper

## Vision Recap

A lib that takes a list of repos (an org), analyzes them via GitHub API, and produces:
- Per-repo: icon, description, language, stats, key files, contributors
- Per-dev: which repos they contribute to (cross-repo contributor map)
- Cross-repo: single-sentence integration descriptions (env vars, APIs, shared deps)
- Output: a structured doc/JSON suitable for rendering a high-level org diagram

---

## Architecture Worth Keeping

The GitSee server has a clean layered pattern:

```
Types (data shapes)
  -> BaseAnalyzer (Octokit wrapper + pagination)
    -> Specialized Analyzers (repository, icons, files, commits)
      -> Resource classes (caching layer)
        -> Handler (orchestrator)
```

For the new lib we'd flatten this: no HTTP handler, no SSE, no clone/agent stuff. Just:

```
Types -> GitHub API functions -> Cache -> Orchestrator(repos[])
```

---

## 1. GitHub API Base (KEEP - core of everything)

The `BaseAnalyzer` wraps Octokit and provides generic pagination. This is the foundation.

**Source:** `server/github/base.ts`

```typescript
import { Octokit } from "@octokit/rest";

export interface RepoAnalyzerConfig {
  githubToken?: string;
  defaultLimit?: number;
  defaultDays?: number;
}

export abstract class BaseAnalyzer {
  protected octokit: Octokit;
  protected config: RepoAnalyzerConfig;

  constructor(config: RepoAnalyzerConfig = {}) {
    this.config = {
      defaultLimit: 50,
      defaultDays: 30,
      ...config,
    };
    this.octokit = new Octokit({
      auth: config.githubToken,
    });
  }

  protected async paginate<T>(request: any, limit?: number): Promise<T[]> {
    const actualLimit = limit || this.config.defaultLimit || 50;

    if (actualLimit <= 100) {
      const response = await request({ per_page: actualLimit });
      return response.data;
    }

    const results: T[] = [];
    let page = 1;
    const perPage = 100;

    while (results.length < actualLimit) {
      const remaining = actualLimit - results.length;
      const requestSize = Math.min(perPage, remaining);
      const response = await request({ per_page: requestSize, page });
      if (response.data.length === 0) break;
      results.push(...response.data);
      page++;
    }

    return results.slice(0, actualLimit);
  }
}
```

**Notes:** Clean pagination with configurable limits. Handles both single-page and multi-page requests. We'll want this for contributors lists on big repos.

---

## 2. Repository Info (KEEP - essential metadata)

Fetches: name, description, language, stars, forks, created_at, owner avatar.

**Source:** `server/github/repo-analyzer/repository.ts` (lines 8-16)

```typescript
async getRepoInfo(owner: string, repo: string): Promise<any> {
  const response = await this.octokit.rest.repos.get({ owner, repo });
  return response.data;
}
```

**The response includes everything we need for the diagram:**
- `name`, `full_name`, `description`
- `language` (primary language)
- `stargazers_count`, `forks_count`
- `owner.avatar_url` (org avatar)
- `created_at`, `updated_at`
- `html_url`
- `topics` (repo tags - useful for categorization!)

---

## 3. Contributors (KEEP - maps devs to repos)

**Source:** `server/github/repo-analyzer/repository.ts` (lines 35-50)

```typescript
async getContributors(
  owner: string,
  repo: string,
  limit?: number
): Promise<any[]> {
  const contributors = await this.paginate<any>(
    (params: any) => this.octokit.rest.repos.listContributors({
      owner,
      repo,
      ...params,
    }),
    limit || 50
  );
  return contributors;
}
```

**Each contributor has:**
- `login` - GitHub username
- `id` - unique across all repos (use for cross-repo dev matching!)
- `avatar_url` - for the diagram
- `contributions` - commit count to this repo
- `type` - "User" vs "Bot" (filter out bots)

**Cross-repo idea:** Collect contributors from all repos, group by `id`. Each dev gets a list of repos they contribute to with their contribution count per repo.

---

## 4. Repo Icon (KEEP - great for diagram visuals)

Searches root and common subdirs for logo/icon/favicon files, sorted by resolution.

**Source:** `server/github/repo-analyzer/icons.ts`

```typescript
async getRepoIcon(owner: string, repo: string): Promise<string | null> {
  // Get root directory contents
  const rootContents = await this.octokit.rest.repos.getContent({
    owner, repo, path: "",
  });

  if (!Array.isArray(rootContents.data)) return null;

  // Look for icon files in root
  const iconFiles = rootContents.data.filter((file: any) => {
    const name = file.name.toLowerCase();
    return (
      name.includes("favicon") ||
      name.includes("logo") ||
      name.includes("icon") ||
      (name.startsWith("apple-touch") && name.includes("icon"))
    );
  });

  // Check common subdirectories
  const subdirs = ["public", "assets", "static", "images", "img"];
  for (const subdir of subdirs) {
    const subdirExists = rootContents.data.find(
      (item: any) => item.name === subdir && item.type === "dir"
    );
    if (subdirExists) {
      try {
        const subdirContents = await this.octokit.rest.repos.getContent({
          owner, repo, path: subdir,
        });
        if (Array.isArray(subdirContents.data)) {
          const subdirIcons = subdirContents.data.filter((file: any) => {
            const name = file.name.toLowerCase();
            return (
              name.includes("favicon") ||
              name.includes("logo") ||
              name.includes("icon")
            );
          });
          iconFiles.push(
            ...subdirIcons.map((f: any) => ({
              ...f,
              path: `${subdir}/${f.name}`,
            }))
          );
        }
      } catch (error) {
        continue;
      }
    }
  }

  // Sort by resolution (highest first)
  const sortedIcons = this.sortIconsByResolution(iconFiles);

  // Fetch best icon as base64
  for (const iconFile of sortedIcons) {
    const filePath = iconFile.path || iconFile.name;
    try {
      const iconResponse = await this.octokit.rest.repos.getContent({
        owner, repo, path: filePath,
      });
      if ("content" in iconResponse.data && iconResponse.data.content) {
        return `data:image/png;base64,${iconResponse.data.content}`;
      }
    } catch (error) {
      continue;
    }
  }
  return null;
}

private sortIconsByResolution(iconFiles: any[]): any[] {
  return iconFiles.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();

    const getResolution = (name: string) => {
      const match = name.match(/(\d+)x\d+/);
      if (match) return parseInt(match[1]);
      if (name.includes("512")) return 512;
      if (name.includes("256")) return 256;
      if (name.includes("192")) return 192;
      if (name.includes("180")) return 180;
      if (name.includes("apple-touch")) return 180;
      if (name.includes("android-chrome")) return 192;
      if (name === "favicon.ico") return 64;
      if (name.includes("logo")) return 100;
      return 50;
    };

    return getResolution(bName) - getResolution(aName);
  });
}
```

**Notes:** This is clever - searches multiple locations, resolves highest-res first, returns base64 data URI. For the org mapper we might also want to fallback to `owner.avatar_url` from the repo info if no icon found.

---

## 5. Key Files Detection (KEEP - reveals repo purpose)

**Source:** `server/github/repo-analyzer/files.ts` (lines 8-93)

```typescript
async getKeyFiles(owner: string, repo: string): Promise<FileInfo[]> {
  const candidateFiles = [
    // Package managers
    { name: "package.json", type: "package" as const },
    { name: "Cargo.toml", type: "package" as const },
    { name: "go.mod", type: "package" as const },
    { name: "setup.py", type: "package" as const },
    { name: "requirements.txt", type: "package" as const },
    { name: "pyproject.toml", type: "package" as const },
    { name: "pom.xml", type: "package" as const },
    { name: "build.gradle", type: "package" as const },
    { name: "build.gradle.kts", type: "package" as const },
    { name: "composer.json", type: "package" as const },
    { name: "Gemfile", type: "package" as const },
    { name: "pubspec.yaml", type: "package" as const },
    // Documentation
    { name: "README.md", type: "docs" as const },
    { name: "ARCHITECTURE.md", type: "docs" as const },
    { name: "CONTRIBUTING.md", type: "docs" as const },
    { name: "API.md", type: "docs" as const },
    { name: "CHANGELOG.md", type: "docs" as const },
    // AI coding agent rules
    { name: "CLAUDE.md", type: "ai" as const },
    { name: "AGENTS.md", type: "ai" as const },
    { name: "AI_INSTRUCTIONS.md", type: "ai" as const },
    { name: "INSTRUCTIONS.md", type: "ai" as const },
    { name: ".cursorrules", type: "ai" as const },
    { name: ".cursor/rules", type: "ai" as const },
    { name: ".windsurfrules", type: "ai" as const },
    { name: ".aiderules", type: "ai" as const },
    { name: ".aider.conf.md", type: "ai" as const },
    { name: ".clinerules", type: "ai" as const },
    { name: ".continuerules", type: "ai" as const },
    { name: ".goosehints", type: "ai" as const },
    { name: ".github/copilot-instructions.md", type: "ai" as const },
    // Config
    { name: ".env.example", type: "config" as const },
    // Data
    { name: "prisma/schema.prisma", type: "data" as const },
    { name: "schema.sql", type: "data" as const },
    // Build
    { name: "Dockerfile", type: "build" as const },
    { name: "docker-compose.yml", type: "build" as const },
    { name: "Makefile", type: "build" as const },
  ];

  // Check all candidate files in parallel
  const fileCheckPromises = candidateFiles.map(async (candidate) => {
    try {
      await this.octokit.rest.repos.getContent({
        owner, repo, path: candidate.name,
      });
      return { name: candidate.name, path: candidate.name, type: candidate.type };
    } catch (error: any) {
      if (error.status !== 404) {
        console.warn(`Error checking ${candidate.name}:`, error.message);
      }
      return null;
    }
  });

  const results = await Promise.all(fileCheckPromises);
  return results.filter((file) => file !== null);
}
```

**Notes:** Parallel file existence checks - fast. For the org mapper, `.env.example` is especially valuable (reveals env vars = integration points). `docker-compose.yml` reveals service dependencies. `package.json` reveals npm dependencies (cross-repo if org packages).

---

## 6. File Content Fetching (KEEP - for reading package.json, .env.example, etc.)

**Source:** `server/github/repo-analyzer/files.ts` (lines 95-150)

```typescript
async getFileContent(
  owner: string,
  repo: string,
  path: string
): Promise<FileContent | null> {
  try {
    const response = await this.octokit.rest.repos.getContent({
      owner, repo, path,
    });

    if (Array.isArray(response.data)) return null; // directory
    const fileData = response.data as any;
    if (fileData.type !== "file") return null;

    // Decode base64 content
    let content = "";
    if (fileData.encoding === "base64" && fileData.content) {
      content = Buffer.from(fileData.content, "base64").toString("utf-8");
    } else if (fileData.content) {
      content = fileData.content;
    }

    return {
      name: fileData.name,
      path: fileData.path,
      content: content,
      encoding: fileData.encoding || "utf-8",
      size: fileData.size || 0,
    };
  } catch (error: any) {
    if (error.status === 404) return null;
    console.error(`Error fetching file content for ${path}:`, error.message);
    return null;
  }
}
```

**Notes:** Base64 decoding handled correctly. For org mapper, we'll want to read:
- `package.json` -> extract `dependencies` to find cross-repo packages
- `.env.example` -> extract env var names to find integration points (API keys, service URLs)
- `docker-compose.yml` -> extract service names and connections

---

## 7. Stats (KEEP - quick repo summary)

**Source:** `server/github/repo-analyzer/repository.ts` (lines 52-102)

```typescript
async getRepoStats(owner: string, repo: string): Promise<RepoStats> {
  const repoResponse = await this.octokit.rest.repos.get({ owner, repo });
  const repoData = repoResponse.data;

  // open_issues_count for total issues
  const totalIssues = repoData.open_issues_count;

  // Approximate total commits from contributors API
  const contributorsResponse = await this.octokit.rest.repos.listContributors({
    owner, repo, per_page: 100,
  });
  const totalCommits = contributorsResponse.data.reduce(
    (sum, contributor) => sum + (contributor.contributions || 0), 0
  );

  // Age in years
  const createdDate = new Date(repoData.created_at);
  const now = new Date();
  const ageInYears =
    Math.round(
      ((now.getTime() - createdDate.getTime()) /
        (365.25 * 24 * 60 * 60 * 1000)) * 10
    ) / 10;

  return {
    stars: repoData.stargazers_count,
    totalIssues,
    totalCommits,
    ageInYears,
  };
}
```

**Notes:** Clever trick - uses contributor API to approximate total commits (sums all `contributions` fields) instead of paginating through all commits. Much cheaper on API quota.

---

---

## 9. Types (KEEP/ADAPT)

**Source:** `server/types/index.ts` + `server/github/types.ts`

Key types to keep for the new lib:

```typescript
// Repo info
export interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; id: number; avatar_url: string };
  description?: string;
  stargazers_count: number;
  forks_count: number;
  language?: string;
  created_at: string;
  updated_at: string;
  clone_url: string;
  html_url: string;
}

// Contributor
export interface Contributor {
  id: number;
  login: string;
  avatar_url: string;
  contributions: number;
  type?: string; // "User" | "Bot"
}

// Stats
export interface RepoStats {
  stars: number;
  totalIssues: number;
  totalCommits: number;
  ageInYears: number;
}

// Files
export interface FileInfo {
  name: string;
  path: string;
  type: "package" | "config" | "docs" | "build" | "ci" | "data" | "ai" | "other";
}

export interface FileContent {
  name: string;
  path: string;
  content: string;
  encoding: string;
  size: number;
}
```

---

## 10. Recent Commits with Files (KEEP - used in hive)

Full commit history with per-file diffs. Depends on `getRecentCommitsRaw` (private helper) and `paginate` from BaseAnalyzer.

**Source:** `server/github/repo-analyzer/commits.ts`

```typescript
export interface RecentCommitsOptions {
  days?: number;
  limit?: number;
  author?: string;
  since?: string;
  until?: string;
}

export interface RepoCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author: {
    login: string;
    avatar_url: string;
    id: number;
  } | null;
  files?: CommitFile[];
}

export interface CommitFile {
  sha: string;
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch?: string;
  previous_filename?: string;
}

// --- private helper: fetches paginated commit list ---
private async getRecentCommitsRaw(
  owner: string,
  repo: string,
  options: RecentCommitsOptions = {}
): Promise<RepoCommit[]> {
  const {
    days = this.config.defaultDays,
    limit = this.config.defaultLimit,
    author,
    since,
    until,
  } = options;

  const sinceDate =
    since ||
    (days
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      : undefined);

  const commits = await this.paginate<RepoCommit>(
    (params: any) =>
      this.octokit.rest.repos.listCommits({
        owner,
        repo,
        author,
        since: sinceDate,
        until,
        ...params,
      }),
    limit
  );

  return commits;
}

// --- private helper: enriches each commit with its changed files ---
private async getRecentCommitsWithFilesRaw(
  owner: string,
  repo: string,
  options: RecentCommitsOptions = {}
): Promise<RepoCommit[]> {
  const commits = await this.getRecentCommitsRaw(owner, repo, options);

  const detailedCommits = await Promise.all(
    commits.map(async (commit) => {
      try {
        const detailedCommit = await this.octokit.rest.repos.getCommit({
          owner,
          repo,
          ref: commit.sha,
        });
        return {
          ...commit,
          files: detailedCommit.data.files || [],
        };
      } catch (error) {
        console.warn(`Could not fetch files for commit ${commit.sha}:`, error);
        return commit;
      }
    })
  );

  return detailedCommits;
}

// --- public: formatted string output ---
async getRecentCommitsWithFiles(
  owner: string,
  repo: string,
  options: RecentCommitsOptions = {}
): Promise<string> {
  const detailedCommits = await this.getRecentCommitsWithFilesRaw(owner, repo, options);

  let output = `\n=== Recent Commits with Files for ${owner}/${repo} ===\n\n`;

  for (const commit of detailedCommits) {
    output += `Commit: ${commit.commit.message.split('\n')[0]}\n`;
    output += `   SHA: ${commit.sha.substring(0, 8)}\n`;
    output += `   Author: ${commit.commit.author.name} (${commit.commit.author.email})\n`;
    output += `   Date: ${new Date(commit.commit.author.date).toLocaleDateString()} ${new Date(commit.commit.author.date).toLocaleTimeString()}\n`;

    if (commit.files && commit.files.length > 0) {
      output += `\n   Files changed (${commit.files.length}):\n`;
      commit.files.forEach((file, idx) => {
        output += `     ${idx + 1}. [${file.status}] ${file.filename} (+${file.additions}/-${file.deletions})\n`;
      });
    }

    output += '\n' + '='.repeat(80) + '\n\n';
  }

  return output;
}
```

**Notes:** API-heavy - each commit is an additional API call to get files. For N commits that's N+1 calls. The `getRecentCommitsRaw` helper is also used by `getContributorCommits` and `getContributorFiles` (which aggregates file modification counts per contributor).

---

## 11. Contributor PRs (KEEP - used in hive)

Full PR history for a contributor with comments, reviews, and commits per PR. Depends on `getRecentPRs` (fetches paginated PR list).

**Source:** `server/github/repo-analyzer/pull-requests.ts`

```typescript
export interface RecentPRsOptions {
  days?: number | null;
  limit?: number;
  state?: "open" | "closed" | "all";
  author?: string;
}

export interface RepoPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: { login: string; avatar_url: string; id: number };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  // enhanced fields (added by getContributorPRs):
  comments?: any[];
  reviews?: any[];
  commits?: any[];
}

// --- dependency: fetches paginated PR list ---
async getRecentPRs(
  owner: string,
  repo: string,
  options: RecentPRsOptions = {}
): Promise<RepoPullRequest[]> {
  const {
    days = options.days === null
      ? null
      : options.days || this.config.defaultDays,
    limit = this.config.defaultLimit,
    state = "all",
    author,
  } = options;

  const prs = await this.paginate<RepoPullRequest>(
    (params: any) =>
      this.octokit.rest.pulls.list({
        owner,
        repo,
        state,
        sort: "updated",
        direction: "desc",
        ...(author && { creator: author }),
        ...params,
      }),
    limit
  );

  let filteredPRs = prs;

  if (days !== null && days !== undefined) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    filteredPRs = filteredPRs.filter(
      (pr) => new Date(pr.updated_at) > cutoffDate
    );
  }

  return filteredPRs;
}

// --- public: full PR details for a contributor, formatted as string ---
async getContributorPRs(
  owner: string,
  repo: string,
  contributor: string,
  limit?: number
): Promise<string> {
  const prs = await this.getRecentPRs(owner, repo, {
    author: contributor,
    limit: limit || 50,
    days: null, // Get all PRs by this contributor
  });

  // Enhance each PR with comments, reviews, and commits (3 parallel calls per PR)
  const enhancedPRs = await Promise.all(
    prs.map(async (pr) => {
      try {
        const [commentsResponse, reviewsResponse, commitsResponse] =
          await Promise.all([
            this.octokit.rest.issues.listComments({
              owner,
              repo,
              issue_number: pr.number,
            }),
            this.octokit.rest.pulls.listReviews({
              owner,
              repo,
              pull_number: pr.number,
            }),
            this.octokit.rest.pulls.listCommits({
              owner,
              repo,
              pull_number: pr.number,
            }),
          ]);

        return {
          ...pr,
          comments: commentsResponse.data.filter(
            (comment) => !comment.user?.login.includes("[bot]")
          ),
          reviews: reviewsResponse.data.filter(
            (review) => !review.user?.login.includes("[bot]")
          ),
          commits: commitsResponse.data,
        };
      } catch (error) {
        console.warn(`Could not fetch details for PR #${pr.number}:`, error);
        return { ...pr, comments: [], reviews: [], commits: [] };
      }
    })
  );

  const finalPRs = limit ? enhancedPRs.slice(0, limit) : enhancedPRs;

  let output = `\n=== Contributor PRs for ${contributor} in ${owner}/${repo} ===\n\n`;

  for (const pr of finalPRs) {
    output += `PR #${pr.number}: ${pr.title}\n`;
    output += `   Branch: ${pr.head.ref} -> ${pr.base.ref}\n`;
    output += `   State: ${pr.state}${pr.merged_at ? " (merged)" : ""}\n`;
    output += `   Created: ${new Date(pr.created_at).toLocaleDateString()}\n`;

    if (pr.body) {
      output += `   Description: ${pr.body.substring(0, 200)}${pr.body.length > 200 ? "..." : ""}\n`;
    }

    if (pr.comments && pr.comments.length > 0) {
      output += `\n   Comments (${pr.comments.length}):\n`;
      pr.comments.forEach((comment: any, idx: number) => {
        output += `     ${idx + 1}. ${comment.user.login}: ${comment.body.substring(0, 150)}${comment.body.length > 150 ? "..." : ""}\n`;
      });
    }

    if (pr.reviews && pr.reviews.length > 0) {
      output += `\n   Reviews (${pr.reviews.length}):\n`;
      pr.reviews.forEach((review: any, idx: number) => {
        output += `     ${idx + 1}. ${review.user.login} (${review.state})\n`;
        if (review.body) {
          output += `        ${review.body.substring(0, 150)}${review.body.length > 150 ? "..." : ""}\n`;
        }
      });
    }

    if (pr.commits && pr.commits.length > 0) {
      output += `\n   Commits (${pr.commits.length}):\n`;
      pr.commits.forEach((commit: any, idx: number) => {
        output += `     ${idx + 1}. ${commit.commit.message.split("\n")[0]} (${commit.commit.author.name})\n`;
      });
    }

    output += "\n" + "=".repeat(80) + "\n\n";
  }

  return output;
}
```

**Notes:** This is API-expensive. Each PR gets 3 additional calls (comments, reviews, commits). For 50 PRs that's 151 API calls for a single contributor on a single repo. Filters out bot comments/reviews. The `days: null` trick bypasses the default 30-day cutoff to get the full history.

---

## What to SKIP from GitSee

- `server/agent/` - clone + AI exploration (separate concern, do later)
- `server/events/` - SSE emitter (real-time UI, not needed for batch analysis)
- `server/persistence/` - file-based storage (the new lib should just return data)
- `server/handler.ts` - HTTP handler (the new lib is a function, not a server)
- `server/resources/` - thin caching wrappers around analyzers (flatten in hive)
- `server/resources/branches.ts` - branch listing (not relevant for org map)
- `server/resources/concepts.ts` - AI-generated concepts (agent stuff, later)

---

## New Types Needed for Org Mapper

```typescript
// Input
interface OrgMapInput {
  repos: { owner: string; repo: string }[];
  githubToken: string;
}

// Per-repo output
interface RepoProfile {
  owner: string;
  repo: string;
  description: string;
  language: string;
  icon: string | null; // base64 data URI
  stats: RepoStats;
  keyFiles: FileInfo[];
  contributors: Contributor[];
  // Parsed from key files:
  envVars?: string[];           // from .env.example
  dependencies?: string[];       // from package.json etc
  exposedPorts?: string[];       // from Dockerfile/docker-compose
}

// Cross-repo developer
interface OrgDeveloper {
  id: number;
  login: string;
  avatar_url: string;
  repos: {
    name: string;
    contributions: number;
  }[];
}

// Cross-repo integration edge
interface RepoIntegration {
  from: string;  // repo full_name
  to: string;    // repo full_name
  type: "dependency" | "env_var" | "api" | "shared_db";
  description: string; // single sentence
}

// Full output
interface OrgMap {
  repos: RepoProfile[];
  developers: OrgDeveloper[];
  integrations: RepoIntegration[];
}
```

---

## Integration Detection Ideas (NEW - not in GitSee)

To find how repos connect to each other:

1. **Shared npm packages**: Parse `package.json` from each repo. If repo A has `@org/shared-lib` as a dep and repo B *is* `@org/shared-lib`, that's a dependency edge.

2. **Env vars**: Parse `.env.example` files. If repo A has `REPO_B_API_URL` and repo B exposes a port, that's an API integration.

3. **Docker compose**: Services referencing other service names or images from the same org.

4. **Import patterns in code**: If repos share a monorepo or reference each other via git submodules.

5. **GitHub Actions**: Workflows that trigger on other repos or deploy together.

---

## Rate Limit Awareness

GitSee already handles rate limits with detection:

```typescript
if (error.status === 403 || error.message?.includes("rate limit")) {
  console.error(`RATE LIMIT HIT!`);
}
```

For the org mapper scanning N repos, we'll need to be more careful:
- Each repo needs ~4-6 API calls minimum (info, contributors, icon search, key files)
- GitHub allows 5000 requests/hour with token
- An org of 20 repos = ~100-120 calls = fine
- An org of 200 repos = ~1000-1200 calls = still fine but add delays
- Cache aggressively between runs

---

## Summary: What to Extract

| Component | Source File | Usefulness | Adapt? |
|-----------|------------|------------|--------|
| BaseAnalyzer (Octokit + pagination) | `github/base.ts` | Core foundation | Keep as-is |
| getRepoInfo | `github/repo-analyzer/repository.ts:8-16` | Essential metadata | Keep as-is |
| getContributors | `github/repo-analyzer/repository.ts:35-50` | Cross-repo dev map | Keep as-is |
| getRepoStats | `github/repo-analyzer/repository.ts:52-102` | Quick summary | Keep as-is |
| getRepoIcon | `github/repo-analyzer/icons.ts` | Diagram visuals | Keep, add fallback to owner avatar |
| getKeyFiles | `github/repo-analyzer/files.ts:8-93` | Reveals stack + integrations | Keep, maybe add more candidates |
| getFileContent | `github/repo-analyzer/files.ts:95-150` | Read package.json, .env.example | Keep as-is |
| getRecentCommitsWithFiles | `github/repo-analyzer/commits.ts` | Used in hive agent | Keep (includes Raw helpers) |
| getContributorPRs | `github/repo-analyzer/pull-requests.ts` | Used in hive agent | Keep (includes getRecentPRs) |
| Types | `types/index.ts` + `github/types.ts` | Data shapes | Adapt for org-level types |
