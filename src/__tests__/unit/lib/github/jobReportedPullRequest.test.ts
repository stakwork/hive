/**
 * Unit tests for `src/lib/github/jobReportedPullRequest.ts`
 * — `jobReportedPullRequest(jobId, swarmId, repo, number)`
 *
 * Covers:
 *   - URL form in string value → true
 *   - {repo, number} object form → true
 *   - URL case-insensitive for the repo part
 *   - URL with trailing path/query → true
 *   - different repo same number → false
 *   - same repo different number → false
 *   - /pull/70 does NOT authorise PR #7 (number boundary)
 *   - repo string in prose + number in unrelated text → false (no false positive)
 *   - deeply nested {artifacts:[{content:{repo,number}}]} → true
 *   - JSON-string content (string value) containing the URL → true
 *   - number as numeric string in {repo,number} → true
 *   - no output rows → false
 *   - null output field → false
 *   - multi-row: first match wins → true
 *   - query scoped by jobId+swarmId, capped at 50, ordered desc
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { strutRun: { findMany: mockFindMany } },
}));

import { jobReportedPullRequest } from "@/lib/github/jobReportedPullRequest";

const JOB = "job-abc";
const SWARM = "swarm-1";
const REPO = "acme/app";
const NUM = 7;

function rows(outputs: unknown[]) {
  return outputs.map((output) => ({ output }));
}

beforeEach(() => vi.clearAllMocks());

describe("jobReportedPullRequest", () => {
  // ── URL form (string values) ──────────────────────────────────────────────

  it("returns true when a string value contains the GitHub URL", async () => {
    mockFindMany.mockResolvedValue(
      rows([{ url: "https://github.com/acme/app/pull/7", state: "open" }]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(true);
  });

  it("URL match is case-insensitive for the repo part", async () => {
    mockFindMany.mockResolvedValue(
      rows([{ url: "https://github.com/Acme/App/pull/7" }]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, "Acme/App", NUM)).toBe(true);
  });

  it("URL with a trailing path segment still matches", async () => {
    mockFindMany.mockResolvedValue(
      rows([{ url: "https://github.com/acme/app/pull/7/files?diff=unified" }]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(true);
  });

  it("URL at end of string (no trailing char) still matches", async () => {
    mockFindMany.mockResolvedValue(rows([{ url: "https://github.com/acme/app/pull/7" }]));
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(true);
  });

  // ── Number boundary — /pull/70 must NOT authorise #7 ─────────────────────

  it("/pull/70 does NOT authorise PR #7", async () => {
    mockFindMany.mockResolvedValue(
      rows([{ url: "https://github.com/acme/app/pull/70" }]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(false);
  });

  it("/pull/700 does NOT authorise PR #7", async () => {
    mockFindMany.mockResolvedValue(
      rows([{ url: "https://github.com/acme/app/pull/700" }]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(false);
  });

  // ── Prose false-positive guard ────────────────────────────────────────────

  it("repo string in prose text + number elsewhere in output → false", async () => {
    // Old substring logic would have matched because "acme/app" and ":7"
    // both appear in the JSON. The structured walk must not match this.
    mockFindMany.mockResolvedValue(
      rows([
        {
          text: "I updated the acme/app documentation",
          stats: { files: 7 },
        },
      ]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(false);
  });

  it("repo string in one field + number in another unrelated field → false", async () => {
    mockFindMany.mockResolvedValue(
      rows([{ description: "fixes acme/app issue", count: 7 }]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(false);
  });

  // ── {repo, number} object form ────────────────────────────────────────────

  it("returns true when output is a {repo, number} object", async () => {
    mockFindMany.mockResolvedValue(
      rows([{ repo: "acme/app", number: 7, title: "Dark mode" }]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(true);
  });

  it("repo+number match is case-insensitive for repo", async () => {
    mockFindMany.mockResolvedValue(rows([{ repo: "ACME/APP", number: 7 }]));
    expect(await jobReportedPullRequest(JOB, SWARM, "acme/app", NUM)).toBe(true);
  });

  it("number as numeric string in {repo, number} → true", async () => {
    mockFindMany.mockResolvedValue(rows([{ repo: "acme/app", number: "7" }]));
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(true);
  });

  // ── Deep nesting ──────────────────────────────────────────────────────────

  it("deeply nested {artifacts:[{content:{repo,number}}]} → true", async () => {
    mockFindMany.mockResolvedValue(
      rows([
        {
          artifacts: [
            {
              id: "pr-1",
              kind: "pull_request",
              content: { repo: "acme/app", number: 7, state: "open" },
            },
          ],
        },
      ]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(true);
  });

  it("PR buried inside an array of mixed items → true", async () => {
    mockFindMany.mockResolvedValue(
      rows([
        {
          steps: [
            { action: "plan" },
            { action: "pr", url: "https://github.com/acme/app/pull/7" },
          ],
        },
      ]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(true);
  });

  // ── JSON-encoded string containing a URL ──────────────────────────────────

  it("a string value that IS a JSON blob containing the URL → true", async () => {
    // Strut sometimes serialises artifact content as a JSON string.
    const encoded = JSON.stringify({ url: "https://github.com/acme/app/pull/7" });
    mockFindMany.mockResolvedValue(rows([{ content: encoded }]));
    // The walker hits the string value `encoded` and the URL regex matches it.
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(true);
  });

  // ── Negative cases ────────────────────────────────────────────────────────

  it("returns false when different repo, same number", async () => {
    mockFindMany.mockResolvedValue(
      rows([{ url: "https://github.com/other/repo/pull/7" }]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(false);
  });

  it("returns false when same repo, different number", async () => {
    mockFindMany.mockResolvedValue(
      rows([{ url: "https://github.com/acme/app/pull/99" }]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(false);
  });

  it("returns false when no rows at all", async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(false);
  });

  it("returns false when output field is null", async () => {
    mockFindMany.mockResolvedValue([{ output: null }]);
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(false);
  });

  // ── Multi-row — first match wins ──────────────────────────────────────────

  it("returns true when one of several rows matches", async () => {
    mockFindMany.mockResolvedValue(
      rows([
        { text: "here is your plan" },
        { url: "https://github.com/acme/app/pull/7" },
        { something: "else" },
      ]),
    );
    expect(await jobReportedPullRequest(JOB, SWARM, REPO, NUM)).toBe(true);
  });

  // ── Query scoping ─────────────────────────────────────────────────────────

  it("queries only for the given jobId+swarmId, capped at 50 rows, ordered desc", async () => {
    mockFindMany.mockResolvedValue([]);
    await jobReportedPullRequest(JOB, SWARM, REPO, NUM);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { jobId: JOB, swarmId: SWARM },
      select: { output: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });
});
