/**
 * Unit tests for `src/lib/github/resolveJobOwnerOctokit.ts`
 * — `resolveJobOwnerOctokit(jobId, swarmId, owner, viewerUserId)`
 *
 * Covers:
 *   - run not found → { ok: false, reason: "run_not_found" }
 *   - job owner has token → { ok: true, source: "job_owner" }
 *   - job owner has no token, viewer has token → { ok: true, source: "viewer" }
 *   - neither has a token → { ok: false, reason: "no_token" }
 *   - job owner IS the viewer (no double-call for same user)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStrutRunFindFirst, mockGetOctokitForWorkspace } = vi.hoisted(() => ({
  mockStrutRunFindFirst: vi.fn(),
  mockGetOctokitForWorkspace: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    strutRun: { findFirst: mockStrutRunFindFirst },
  },
}));
vi.mock("@/lib/github/pr-monitor", () => ({
  getOctokitForWorkspace: mockGetOctokitForWorkspace,
}));

import { resolveJobOwnerOctokit } from "@/lib/github/resolveJobOwnerOctokit";

const JOB_ID = "job-abc";
const SWARM_ID = "swarm-1";
const OWNER = "acme";
const OWNER_USER = "user-owner";
const VIEWER_USER = "user-viewer";

const fakeOctokit = (name: string) => ({ name } as unknown as import("@octokit/rest").Octokit);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveJobOwnerOctokit", () => {
  it("returns run_not_found when no StrutRun exists", async () => {
    mockStrutRunFindFirst.mockResolvedValue(null);
    const result = await resolveJobOwnerOctokit(JOB_ID, SWARM_ID, OWNER, VIEWER_USER);
    expect(result).toEqual({ ok: false, reason: "run_not_found" });
    expect(mockGetOctokitForWorkspace).not.toHaveBeenCalled();
  });

  it("uses the job owner's token when available", async () => {
    mockStrutRunFindFirst.mockResolvedValue({ userId: OWNER_USER });
    mockGetOctokitForWorkspace.mockResolvedValue(fakeOctokit("owner-octokit"));

    const result = await resolveJobOwnerOctokit(JOB_ID, SWARM_ID, OWNER, VIEWER_USER);

    expect(result).toMatchObject({ ok: true, source: "job_owner" });
    expect(mockGetOctokitForWorkspace).toHaveBeenCalledWith(OWNER_USER, OWNER);
    // Should not have tried the viewer.
    expect(mockGetOctokitForWorkspace).toHaveBeenCalledTimes(1);
  });

  it("falls back to viewer token when job owner has none", async () => {
    mockStrutRunFindFirst.mockResolvedValue({ userId: OWNER_USER });
    mockGetOctokitForWorkspace
      .mockResolvedValueOnce(null) // owner has no token
      .mockResolvedValueOnce(fakeOctokit("viewer-octokit")); // viewer has token

    const result = await resolveJobOwnerOctokit(JOB_ID, SWARM_ID, OWNER, VIEWER_USER);

    expect(result).toMatchObject({ ok: true, source: "viewer" });
    expect(mockGetOctokitForWorkspace).toHaveBeenNthCalledWith(1, OWNER_USER, OWNER);
    expect(mockGetOctokitForWorkspace).toHaveBeenNthCalledWith(2, VIEWER_USER, OWNER);
  });

  it("returns no_token when neither owner nor viewer has a token", async () => {
    mockStrutRunFindFirst.mockResolvedValue({ userId: OWNER_USER });
    mockGetOctokitForWorkspace.mockResolvedValue(null);

    const result = await resolveJobOwnerOctokit(JOB_ID, SWARM_ID, OWNER, VIEWER_USER);

    expect(result).toEqual({ ok: false, reason: "no_token" });
    expect(mockGetOctokitForWorkspace).toHaveBeenCalledTimes(2);
  });

  it("does not try viewer token when viewer IS the job owner", async () => {
    // When the same user is both owner and viewer, we skip the viewer fallback
    // to avoid a redundant DB call.
    mockStrutRunFindFirst.mockResolvedValue({ userId: VIEWER_USER });
    mockGetOctokitForWorkspace.mockResolvedValue(null); // no token

    const result = await resolveJobOwnerOctokit(JOB_ID, SWARM_ID, OWNER, VIEWER_USER);

    expect(result).toEqual({ ok: false, reason: "no_token" });
    // Only called once for the owner (== viewer).
    expect(mockGetOctokitForWorkspace).toHaveBeenCalledTimes(1);
  });
});
