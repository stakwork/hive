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

// ── computeFingerprint with structured frames ─────────────────────────────────

describe("computeFingerprint — structured frames", () => {
  it("produces a stable hash from frames (same object values, different identity)", () => {
    const framesA = [
      { filename: "app/controllers/users_controller.rb", function: "create", lineno: 42 },
      { filename: "app/models/user.rb", function: "save", lineno: 18 },
    ];
    const framesB = [
      { filename: "app/controllers/users_controller.rb", function: "create", lineno: 42 },
      { filename: "app/models/user.rb", function: "save", lineno: 18 },
    ];
    const fp1 = computeFingerprint({ exceptionType: "ActiveRecord::NotFound", frames: framesA });
    const fp2 = computeFingerprint({ exceptionType: "ActiveRecord::NotFound", frames: framesB });
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("frames hash differs from raw-string hash for same exception", () => {
    const frames = [
      { filename: "app/controllers/users_controller.rb", function: "create", lineno: 42 },
    ];
    const fpFrames = computeFingerprint({ exceptionType: "TypeError", frames });
    const fpRaw = computeFingerprint({ exceptionType: "TypeError", stackTrace: "at create (app/controllers/users_controller.rb:42:5)" });
    // They may differ — structured and raw paths produce distinct hashes
    expect(fpFrames).toMatch(/^[0-9a-f]{64}$/);
    expect(fpRaw).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different frames produce different fingerprints", () => {
    const framesA = [{ filename: "app/foo.rb", function: "bar", lineno: 1 }];
    const framesB = [{ filename: "app/baz.rb", function: "qux", lineno: 2 }];
    const fp1 = computeFingerprint({ exceptionType: "TypeError", frames: framesA });
    const fp2 = computeFingerprint({ exceptionType: "TypeError", frames: framesB });
    expect(fp1).not.toBe(fp2);
  });

  it("frames path: different exceptionType produces different fingerprint", () => {
    const frames = [{ filename: "app/foo.rb", function: "bar", lineno: 10 }];
    const fp1 = computeFingerprint({ exceptionType: "TypeError", frames });
    const fp2 = computeFingerprint({ exceptionType: "RuntimeError", frames });
    expect(fp1).not.toBe(fp2);
  });

  it("clientFingerprint takes precedence over frames", () => {
    const frames = [{ filename: "app/foo.rb", function: "bar", lineno: 1 }];
    const fp = computeFingerprint({ exceptionType: "TypeError", frames, clientFingerprint: "custom-override" });
    expect(fp).toBe("custom-override");
  });

  it("falls back to raw-string path when frames is empty array", () => {
    const fpEmpty = computeFingerprint({
      exceptionType: "TypeError",
      frames: [],
      stackTrace: "at foo (bar.ts:1:1)",
    });
    const fpNoFrames = computeFingerprint({
      exceptionType: "TypeError",
      stackTrace: "at foo (bar.ts:1:1)",
    });
    expect(fpEmpty).toBe(fpNoFrames);
  });

  it("falls back to raw-string path when frames is undefined", () => {
    const fpUndef = computeFingerprint({
      exceptionType: "TypeError",
      frames: undefined,
      stackTrace: "at foo (bar.ts:1:1)",
    });
    const fpNoFrames = computeFingerprint({
      exceptionType: "TypeError",
      stackTrace: "at foo (bar.ts:1:1)",
    });
    expect(fpUndef).toBe(fpNoFrames);
  });

  it("uses only top 5 frames (6th frame is ignored)", () => {
    const frames6 = Array.from({ length: 6 }, (_, i) => ({
      filename: `app/file${i}.rb`,
      function: `fn${i}`,
      lineno: i + 1,
    }));
    const frames5 = frames6.slice(0, 5);
    const fp6 = computeFingerprint({ exceptionType: "E", frames: frames6 });
    const fp5 = computeFingerprint({ exceptionType: "E", frames: frames5 });
    expect(fp6).toBe(fp5);
  });

  it("frames with optional fields absent still hash stably", () => {
    const frames = [{ filename: "app/foo.rb" }]; // no function or lineno
    const fp1 = computeFingerprint({ exceptionType: "TypeError", frames });
    const fp2 = computeFingerprint({ exceptionType: "TypeError", frames: [{ filename: "app/foo.rb" }] });
    expect(fp1).toBe(fp2);
  });
});

// ── resolveRepoKey — canonical SSH/HTTPS/shorthand matching ──────────────────

describe("resolveRepoKey — canonical cross-form matching", () => {
  it("matches shorthand 'owner/repo' against SSH-stored repositoryUrl", async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: "repo-ssh", name: "senza-lnd", repositoryUrl: "git@github.com:stakwork/senza-lnd" },
    ]);
    const result = await resolveRepoKey({ workspaceId: "ws-1", repository: "stakwork/senza-lnd" });
    expect(result.repositoryId).toBe("repo-ssh");
    expect(result.repoKey).toBe("stakwork/senza-lnd");
  });

  it("matches SSH URL against HTTPS-stored repositoryUrl", async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: "repo-https", name: "hive", repositoryUrl: "https://github.com/stakwork/hive.git" },
    ]);
    const result = await resolveRepoKey({ workspaceId: "ws-1", repository: "git@github.com:stakwork/hive.git" });
    expect(result.repositoryId).toBe("repo-https");
    expect(result.repoKey).toBe("stakwork/hive");
  });

  it("matches HTTPS URL against SSH-stored repositoryUrl", async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: "repo-ssh2", name: "hive", repositoryUrl: "git@github.com:stakwork/hive.git" },
    ]);
    const result = await resolveRepoKey({ workspaceId: "ws-1", repository: "https://github.com/stakwork/hive" });
    expect(result.repositoryId).toBe("repo-ssh2");
    expect(result.repoKey).toBe("stakwork/hive");
  });

  it("matches .git-suffixed shorthand against stored SSH URL", async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: "repo-1", name: "hive", repositoryUrl: "git@github.com:stakwork/hive" },
    ]);
    const result = await resolveRepoKey({ workspaceId: "ws-1", repository: "stakwork/hive.git" });
    expect(result.repositoryId).toBe("repo-1");
  });

  it("does not match repos from a different workspace (IDOR boundary)", async () => {
    mockFindMany.mockResolvedValueOnce([]); // ws-999 has no repos
    const result = await resolveRepoKey({ workspaceId: "ws-999", repository: "stakwork/hive" });
    expect(result.repositoryId).toBeNull();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws-999" } })
    );
  });

  it("SSH, HTTPS, and shorthand all produce the same repoKey when no match (unregistered repo)", async () => {
    mockFindMany.mockResolvedValue([]);
    const ssh = await resolveRepoKey({ workspaceId: "ws-1", repository: "git@github.com:stakwork/senza-lnd.git" });
    const https = await resolveRepoKey({ workspaceId: "ws-1", repository: "https://github.com/stakwork/senza-lnd" });
    const short = await resolveRepoKey({ workspaceId: "ws-1", repository: "stakwork/senza-lnd" });
    expect(ssh.repoKey).toBe("stakwork/senza-lnd");
    expect(https.repoKey).toBe("stakwork/senza-lnd");
    expect(short.repoKey).toBe("stakwork/senza-lnd");
    expect(ssh.repositoryId).toBeNull();
    expect(https.repositoryId).toBeNull();
    expect(short.repositoryId).toBeNull();
  });
});
