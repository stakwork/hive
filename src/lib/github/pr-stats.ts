import { serviceConfigs } from "@/config/services";

export type PRWindowKey = "24h" | "48h" | "1w" | "2w" | "1mo";

export const WINDOW_DURATIONS_MS: Record<PRWindowKey, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "48h": 48 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "2w": 14 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000,
};

export const PR_WINDOWS: PRWindowKey[] = ["24h", "48h", "1w", "2w", "1mo"];

/**
 * Calls GitHub Search API for PRs created in the given repo since `since`.
 * Uses serviceConfigs.github.baseURL so that USE_MOCKS mode routes to the mock endpoint.
 * Makes a single call per repo (1-month window) — callers bucket in memory.
 */
export async function getPRCountForRepo(
  repoFullName: string,
  githubToken: string,
  since: Date,
): Promise<{ items: { createdAt: Date }[] }> {
  const sinceStr = since.toISOString().split("T")[0]; // YYYY-MM-DD
  const searchQuery = `repo:${repoFullName} is:pr created:>=${sinceStr}`;
  const url = `${serviceConfigs.github.baseURL}/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${githubToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const rawItems: Array<{ created_at: string }> = data.items || [];

  return {
    items: rawItems.map((item) => ({ createdAt: new Date(item.created_at) })),
  };
}

/**
 * Buckets a flat list of items (each with createdAt) into all 5 time windows.
 * Windows are cumulative: an item in "24h" is also counted in "48h", "1w", etc.
 */
export function bucketByWindows(
  items: { createdAt: Date }[],
  now: Date,
): Record<PRWindowKey, number> {
  const nowMs = now.getTime();
  const counts: Record<PRWindowKey, number> = {
    "24h": 0,
    "48h": 0,
    "1w": 0,
    "2w": 0,
    "1mo": 0,
  };

  for (const item of items) {
    const ageMs = nowMs - item.createdAt.getTime();
    // Cumulative: item in 24h window is also in 48h, 1w, 2w, 1mo
    if (ageMs <= WINDOW_DURATIONS_MS["24h"]) counts["24h"]++;
    if (ageMs <= WINDOW_DURATIONS_MS["48h"]) counts["48h"]++;
    if (ageMs <= WINDOW_DURATIONS_MS["1w"]) counts["1w"]++;
    if (ageMs <= WINDOW_DURATIONS_MS["2w"]) counts["2w"]++;
    if (ageMs <= WINDOW_DURATIONS_MS["1mo"]) counts["1mo"]++;
  }

  return counts;
}
