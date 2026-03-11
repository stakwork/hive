import { NextRequest, NextResponse } from "next/server";

/**
 * Mock GitHub Search Issues Endpoint
 *
 * Simulates: GET https://api.github.com/search/issues
 * Used by getPRCountForRepo in USE_MOCKS=true mode.
 *
 * Returns 20 mock PR items with created_at timestamps spread across the last
 * 30 days so all 5 windows (24h, 48h, 1w, 2w, 1mo) show non-zero data:
 *   2  items within last 24h
 *   2  additional items within 24h–48h  (4 total in 48h window)
 *   4  additional items within 48h–1w   (8 total in 1w window)
 *   4  additional items within 1w–2w    (12 total in 2w window)
 *   8  additional items within 2w–1mo   (20 total in 1mo window)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json(
      {
        message: "Requires authentication",
        documentation_url: "https://docs.github.com/rest/search#search-issues-and-pull-requests",
      },
      { status: 401 },
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") || "";

  // Extract repo name from query (e.g. "repo:stakwork/hive is:pr ...")
  const repoMatch = query.match(/repo:([^\s]+)/);
  const repoName = repoMatch ? repoMatch[1] : "mock/repo";

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  // Build mock items spread across all windows (offsets = age of the item)
  const offsets = [
    // 24h window (2 items)
    1 * hour,
    12 * hour,
    // 48h window extras (2 more → 4 total)
    25 * hour,
    36 * hour,
    // 1w window extras (4 more → 8 total)
    3 * day,
    4 * day,
    5 * day,
    6 * day,
    // 2w window extras (4 more → 12 total)
    8 * day,
    9 * day,
    10 * day,
    13 * day,
    // 1mo window extras (8 more → 20 total)
    15 * day,
    17 * day,
    19 * day,
    21 * day,
    23 * day,
    25 * day,
    27 * day,
    29 * day,
  ];

  const items = offsets.map((offset, i) => ({
    id: 1000 + i,
    number: 100 + i,
    title: `Mock PR #${100 + i} for ${repoName}`,
    html_url: `https://github.com/${repoName}/pull/${100 + i}`,
    state: "open",
    created_at: new Date(now - offset).toISOString(),
    updated_at: new Date(now - offset).toISOString(),
    pull_request: {
      url: `https://api.github.com/repos/${repoName}/pulls/${100 + i}`,
      html_url: `https://github.com/${repoName}/pull/${100 + i}`,
      merged_at: null,
    },
  }));

  return NextResponse.json({
    total_count: items.length,
    incomplete_results: false,
    items,
  });
}
