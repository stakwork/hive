/**
 * Unit tests for src/lib/utils/error-fingerprint.ts
 *
 * Tests cover:
 *  - resolveRepoKey: match by URL, match by name, normalize-match, fallback to raw, "unknown"
 *  - computeFingerprint: default computation stability, client override passthrough
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ───────────────────────────────────────────────────────────────────
const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    repository: {
      findMany: mockFindMany,
    },
  },
}));

import { resolveRepoKey, computeFingerprint, canonicalRepoKey } from "@/lib/utils/error-fingerprint";

// ── Test repos ────────────────────────────────────────────────────────────────
const REPOS = [
  { id: "repo-1", name: "hive", repositoryUrl: "https://github.com/stakwork/hive" },
  { id: "repo-2", name: "workspaces", repositoryUrl: "https://github.com/stakwork/workspaces" },
];

// ── canonicalRepoKey ──────────────────────────────────────────────────────────

describe("canonicalRepoKey", () => {
  it("canonicalizes SSH URL to owner/repo", () => {
    expect(canonicalRepoKey("git@github.com:stakwork/hive")).toBe("stakwork/hive");
  });

  it("canonicalizes SSH URL with .git suffix", () => {
    expect(canonicalRepoKey("git@github.com:stakwork/hive.git")).toBe("stakwork/hive");
  });

  it("canonicalizes HTTPS URL to owner/repo", () => {
    expect(canonicalRepoKey("https://github.com/stakwork/hive")).toBe("stakwork/hive");
  });

  it("canonicalizes HTTPS URL with .git suffix", () => {
    expect(canonicalRepoKey("https://github.com/stakwork/hive.git")).toBe("stakwork/hive");
  });

  it("lowercases SSH URL with mixed case", () => {
    expect(canonicalRepoKey("git@github.com:StakWork/Hive.git")).toBe("stakwork/hive");
  });

  it("lowercases HTTPS URL with mixed case", () => {
    expect(canonicalRepoKey("HTTPS://GitHub.com/StakWork/Hive")).toBe("stakwork/hive");
  });

  it("handles shorthand owner/repo via normalizeRepo fallback", () => {
    expect(canonicalRepoKey("stakwork/hive")).toBe("stakwork/hive");
  });

  it("handles shorthand owner/repo with mixed case", () => {
    expect(canonicalRepoKey("StakWork/Hive")).toBe("stakwork/hive");
  });

  it("handles shorthand with .git via normalizeRepo fallback", () => {
    expect(canonicalRepoKey("stakwork/hive.git")).toBe("stakwork/hive");
  });

  it("falls back for non-GitHub URL (normalizeRepo)", () => {
    expect(canonicalRepoKey("https://gitlab.com/org/repo")).toBe(
      "https://gitlab.com/org/repo",
    );
  });

  it('returns "unknown" for empty string', () => {
    expect(canonicalRepoKey("")).toBe("unknown");
  });

  it('returns "unknown" for whitespace-only string', () => {
    expect(canonicalRepoKey("   ")).toBe("unknown");
  });

  it("SSH and HTTPS and shorthand all produce the same canonical key", () => {
    const ssh = canonicalRepoKey("git@github.com:stakwork/senza-lnd.git");
    const https = canonicalRepoKey("https://github.com/stakwork/senza-lnd.git");
    const shorthand = canonicalRepoKey("stakwork/senza-lnd");
    expect(ssh).toBe("stakwork/senza-lnd");
    expect(https).toBe("stakwork/senza-lnd");
    expect(shorthand).toBe("stakwork/senza-lnd");
  });
});

// ── resolveRepoKey ────────────────────────────────────────────────────────────

describe("resolveRepoKey", () => {
  beforeEach(() => {
    mockFindMany.mockResolvedValue(REPOS);
  });

  it("matches by exact repositoryUrl and returns canonical repoKey", async () => {
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "https://github.com/stakwork/hive",
    });
    expect(result.repositoryId).toBe("repo-1");
    // canonical form of repo.repositoryUrl, not the DB id
    expect(result.repoKey).toBe("stakwork/hive");
  });

  it("matches by repo name and returns canonical repoKey derived from repositoryUrl", async () => {
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "workspaces",
    });
    expect(result.repositoryId).toBe("repo-2");
    expect(result.repoKey).toBe("stakwork/workspaces");
  });

  it("matches URL with trailing slash (normalize)", async () => {
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "https://github.com/stakwork/hive/",
    });
    expect(result.repositoryId).toBe("repo-1");
    expect(result.repoKey).toBe("stakwork/hive");
  });

  it("matches URL with .git suffix (normalize)", async () => {
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "https://github.com/stakwork/hive.git",
    });
    expect(result.repositoryId).toBe("repo-1");
    expect(result.repoKey).toBe("stakwork/hive");
  });

  it("matches SSH URL and returns canonical repoKey", async () => {
    // Simulate incoming SSH URL matching the hive repo
    mockFindMany.mockResolvedValueOnce([
      { id: "repo-1", name: "hive", repositoryUrl: "git@github.com:stakwork/hive.git" },
    ]);
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "git@github.com:stakwork/hive.git",
    });
    expect(result.repositoryId).toBe("repo-1");
    expect(result.repoKey).toBe("stakwork/hive");
  });

  it("matches URL case-insensitively (normalize)", async () => {
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "HTTPS://GitHub.com/StakWork/Hive",
    });
    expect(result.repositoryId).toBe("repo-1");
    expect(result.repoKey).toBe("stakwork/hive");
  });

  it("matches repo name case-insensitively", async () => {
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "HIVE",
    });
    expect(result.repositoryId).toBe("repo-1");
    expect(result.repoKey).toBe("stakwork/hive");
  });

  it("falls back to canonical form of raw identifier when no repo matches (HTTPS URL)", async () => {
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "https://github.com/other-org/other-repo",
    });
    expect(result.repositoryId).toBeNull();
    expect(result.repoKey).toBe("other-org/other-repo");
  });

  it("falls back to canonical form for SSH URL when no repo matches", async () => {
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "git@github.com:other-org/other-repo.git",
    });
    expect(result.repositoryId).toBeNull();
    expect(result.repoKey).toBe("other-org/other-repo");
  });

  it("falls back and normalizes shorthand (lowercased)", async () => {
    const result = await resolveRepoKey({
      workspaceId: "ws-1",
      repository: "  MyOrg/MyApp  ",
    });
    expect(result.repositoryId).toBeNull();
    expect(result.repoKey).toBe("myorg/myapp");
  });

  it('returns repoKey "unknown" when repository is null', async () => {
    const result = await resolveRepoKey({ workspaceId: "ws-1", repository: null });
    expect(result.repositoryId).toBeNull();
    expect(result.repoKey).toBe("unknown");
  });

  it('returns repoKey "unknown" when repository is empty string', async () => {
    const result = await resolveRepoKey({ workspaceId: "ws-1", repository: "" });
    expect(result.repositoryId).toBeNull();
    expect(result.repoKey).toBe("unknown");
  });

  it('returns repoKey "unknown" when repository is whitespace only', async () => {
    const result = await resolveRepoKey({ workspaceId: "ws-1", repository: "   " });
    expect(result.repositoryId).toBeNull();
    expect(result.repoKey).toBe("unknown");
  });

  it("only queries repos for the given workspaceId", async () => {
    await resolveRepoKey({ workspaceId: "ws-99", repository: "hive" });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws-99" } })
    );
  });

  it("SSH, HTTPS, and shorthand all produce the same repoKey for unmatched repos", async () => {
    mockFindMany.mockResolvedValue([]); // no workspace repos
    const ssh = await resolveRepoKey({ workspaceId: "ws-1", repository: "git@github.com:stakwork/senza-lnd.git" });
    const https = await resolveRepoKey({ workspaceId: "ws-1", repository: "https://github.com/stakwork/senza-lnd.git" });
    const shorthand = await resolveRepoKey({ workspaceId: "ws-1", repository: "stakwork/senza-lnd" });
    expect(ssh.repoKey).toBe("stakwork/senza-lnd");
    expect(https.repoKey).toBe("stakwork/senza-lnd");
    expect(shorthand.repoKey).toBe("stakwork/senza-lnd");
  });
});

// ── computeFingerprint ─────────────────────────────────────────────────────────

describe("computeFingerprint", () => {
  it("returns clientFingerprint as-is when provided", () => {
    const fp = computeFingerprint({
      exceptionType: "TypeError",
      stackTrace: "some stack",
      clientFingerprint: "my-custom-fp",
    });
    expect(fp).toBe("my-custom-fp");
  });

  it("returns clientFingerprint even when it matches a computed hash", () => {
    const fp = computeFingerprint({
      exceptionType: "TypeError",
      clientFingerprint: "explicit-override",
    });
    expect(fp).toBe("explicit-override");
  });

  it("ignores empty clientFingerprint and falls back to computed hash", () => {
    const fp = computeFingerprint({
      exceptionType: "TypeError",
      stackTrace: "at foo (bar.ts:1:1)",
      clientFingerprint: "",
    });
    expect(fp).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it("ignores whitespace-only clientFingerprint and falls back to computed hash", () => {
    const fp = computeFingerprint({
      exceptionType: "TypeError",
      clientFingerprint: "   ",
    });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a hex SHA-256 when no clientFingerprint given", () => {
    const fp = computeFingerprint({ exceptionType: "ReferenceError" });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable — same inputs produce the same fingerprint", () => {
    const input = {
      exceptionType: "TypeError",
      stackTrace: "  at foo (/abs/path/bar.ts:10:5)\n  at baz (/abs/path/qux.ts:20:3)",
    };
    const fp1 = computeFingerprint(input);
    const fp2 = computeFingerprint(input);
    expect(fp1).toBe(fp2);
  });

  it("normalizes stack frames — strips line/column numbers", () => {
    const fpA = computeFingerprint({
      exceptionType: "TypeError",
      stackTrace: "  at foo (/abs/path/bar.ts:10:5)\n  at baz (/abs/path/qux.ts:20:3)",
    });
    // Different line/column numbers — should produce the same fingerprint
    const fpB = computeFingerprint({
      exceptionType: "TypeError",
      stackTrace: "  at foo (/abs/path/bar.ts:99:12)\n  at baz (/abs/path/qux.ts:50:7)",
    });
    expect(fpA).toBe(fpB);
  });

  it("produces different fingerprints for different exceptionTypes", () => {
    const fp1 = computeFingerprint({ exceptionType: "TypeError" });
    const fp2 = computeFingerprint({ exceptionType: "ReferenceError" });
    expect(fp1).not.toBe(fp2);
  });

  it("produces different fingerprints for different stack frames (same exception)", () => {
    const fp1 = computeFingerprint({
      exceptionType: "TypeError",
      stackTrace: "at foo (bar.ts:1:1)",
    });
    const fp2 = computeFingerprint({
      exceptionType: "TypeError",
      stackTrace: "at baz (qux.ts:5:2)",
    });
    expect(fp1).not.toBe(fp2);
  });

  it("handles missing stackTrace gracefully", () => {
    const fp = computeFingerprint({ exceptionType: "SomeError", stackTrace: null });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    // Same as no stackTrace at all
    const fp2 = computeFingerprint({ exceptionType: "SomeError" });
    expect(fp).toBe(fp2);
  });

  it("only uses top 5 stack frames for hashing", () => {
    const frames6 = Array.from({ length: 6 }, (_, i) => `  at fn${i} (file${i}.ts:${i}:0)`).join("\n");
    const frames5 = Array.from({ length: 5 }, (_, i) => `  at fn${i} (file${i}.ts:${i}:0)`).join("\n");

    const fp6 = computeFingerprint({ exceptionType: "E", stackTrace: frames6 });
    const fp5 = computeFingerprint({ exceptionType: "E", stackTrace: frames5 });
    // Both should produce the same fingerprint — 6th frame is ignored
    expect(fp6).toBe(fp5);
  });
});
