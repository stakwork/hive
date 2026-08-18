/**
 * Unit tests for the createPr adapter.
 *
 * Covers:
 *   - hardenPrResult: malformed shape, over-cap diff, secret hit
 *   - PR-URL validation: host / owner-repo mismatch
 *   - _processCompletedResult: already_landed ok:true → prior PR (hardened
 *     on the same terms as a fresh success); ok:false → prior failure with
 *     no raw swarm `error` passed through
 *
 * The classifier table and the network/DB paths of `createPr` itself need
 * fetch + Prisma mocks and belong in integration tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hardenPrResult is the only pure-function export we need for unit tests.
// Everything else in createPr.ts requires DB/network mocks which belong in
// integration tests. We import it directly from the module.
import {
  hardenPrResult,
  _processCompletedResult,
} from "@/services/swarm/createPr";

// ── Minimal valid LandChangeSuccess shape ──────────────────────────────────

const VALID_PR = {
  ok: true,
  url: "https://github.com/stakwork/hive/pull/42",
  number: 42,
  branch: "swarm/swarm-change-abc123",
  base: "main",
  headSha: "a".repeat(40),
  diff: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-x\n+y\n",
  filesChanged: 1,
};

const REPO_URL = "https://github.com/stakwork/hive";

// ─── hardenPrResult ────────────────────────────────────────────────────────

describe("hardenPrResult", () => {
  describe("shape validation", () => {
    it("accepts a valid LandChangeSuccess", () => {
      const result = hardenPrResult(VALID_PR, REPO_URL);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.hardened.url).toBe(VALID_PR.url);
        expect(result.hardened.number).toBe(42);
      }
    });

    it("rejects null", () => {
      const result = hardenPrResult(null, REPO_URL);
      expect(result.ok).toBe(false);
    });

    it("rejects a non-object", () => {
      const result = hardenPrResult("string", REPO_URL);
      expect(result.ok).toBe(false);
    });

    it("rejects missing url field", () => {
      const result = hardenPrResult({ ...VALID_PR, url: 42 }, REPO_URL);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/url/);
      }
    });

    it("rejects missing number field", () => {
      const result = hardenPrResult({ ...VALID_PR, number: "42" }, REPO_URL);
      expect(result.ok).toBe(false);
    });

    it("rejects missing filesChanged field", () => {
      const result = hardenPrResult({ ...VALID_PR, filesChanged: "one" }, REPO_URL);
      expect(result.ok).toBe(false);
    });

    it("rejects missing diff field", () => {
      const { diff: _, ...noDiff } = VALID_PR;
      const result = hardenPrResult(noDiff, REPO_URL);
      expect(result.ok).toBe(false);
    });

    it("rejects non-string branch", () => {
      const result = hardenPrResult({ ...VALID_PR, branch: null }, REPO_URL);
      expect(result.ok).toBe(false);
    });
  });

  describe("URL validation", () => {
    it("accepts a matching github.com PR URL", () => {
      const result = hardenPrResult(VALID_PR, REPO_URL);
      expect(result.ok).toBe(true);
    });

    it("rejects a URL with a different host", () => {
      const result = hardenPrResult(
        { ...VALID_PR, url: "https://gitlab.com/stakwork/hive/pull/42" },
        REPO_URL,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/URL/i);
      }
    });

    it("rejects a URL whose owner does not match", () => {
      const result = hardenPrResult(
        { ...VALID_PR, url: "https://github.com/other-org/hive/pull/42" },
        REPO_URL,
      );
      expect(result.ok).toBe(false);
    });

    it("rejects a URL whose repo does not match", () => {
      const result = hardenPrResult(
        { ...VALID_PR, url: "https://github.com/stakwork/other-repo/pull/42" },
        REPO_URL,
      );
      expect(result.ok).toBe(false);
    });

    it("rejects an unparseable URL", () => {
      const result = hardenPrResult(
        { ...VALID_PR, url: "not-a-url" },
        REPO_URL,
      );
      expect(result.ok).toBe(false);
    });

    it("accepts a URL that matches case-insensitively", () => {
      const result = hardenPrResult(
        { ...VALID_PR, url: "https://github.com/Stakwork/Hive/pull/42" },
        REPO_URL,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("diff caps", () => {
    it("rejects a diff over 200 KB", () => {
      // Generate a diff slightly over 200 KB
      const bigDiff =
        "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n" +
        "+".repeat(205_000);
      const result = hardenPrResult({ ...VALID_PR, diff: bigDiff }, REPO_URL);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/cap|too large|change_too_large/i);
      }
    });

    it("accepts a diff within 200 KB", () => {
      const smallDiff =
        "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n+x\n";
      const result = hardenPrResult({ ...VALID_PR, diff: smallDiff }, REPO_URL);
      expect(result.ok).toBe(true);
    });
  });

  describe("secret scan", () => {
    it("rejects a diff containing a GitHub PAT", () => {
      const secretDiff =
        "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n" +
        "+const token = 'ghp_" + "a".repeat(36) + "';\n";
      const result = hardenPrResult({ ...VALID_PR, diff: secretDiff }, REPO_URL);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/credential|secret/i);
      }
    });

    it("rejects a diff containing an AWS key ID", () => {
      const secretDiff =
        "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n" +
        "+const key = 'AKIA1234567890ABCDEF';\n";
      const result = hardenPrResult({ ...VALID_PR, diff: secretDiff }, REPO_URL);
      expect(result.ok).toBe(false);
    });

    it("accepts a clean diff with no credentials", () => {
      const result = hardenPrResult(VALID_PR, REPO_URL);
      expect(result.ok).toBe(true);
    });
  });

  describe("return value completeness", () => {
    it("returns all LandChangeSuccess fields on success", () => {
      const result = hardenPrResult(VALID_PR, REPO_URL);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.hardened).toMatchObject({
          ok: true,
          url: VALID_PR.url,
          number: VALID_PR.number,
          branch: VALID_PR.branch,
          base: VALID_PR.base,
          headSha: VALID_PR.headSha,
          filesChanged: VALID_PR.filesChanged,
        });
      }
    });
  });
});

// ─── Classifier coverage ───────────────────────────────────────────────────
// The `classify` function is internal to createPr.ts, but we can test its
// output through the plain-language message invariants — specifically that
// no raw git/error text passes through and that every code maps to a
// human-readable message.

// ─── _processCompletedResult: already_landed replay ───────────────────────
//
// `already_landed` can arrive with `ok: true` (a replay of a run whose first
// landChange succeeded). That path persists a PR URL exactly like a fresh
// success, so it must clear the same hardening.

describe("_processCompletedResult — already_landed replay", () => {
  const APPROVED_DIFF = VALID_PR.diff;

  it("returns the prior PR on an ok:true already_landed replay", () => {
    const result = _processCompletedResult(
      { pr: { ...VALID_PR, failure: "already_landed" } },
      APPROVED_DIFF,
      REPO_URL,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prUrl).toBe(VALID_PR.url);
      expect(result.prNumber).toBe(42);
      expect(result.pathSetVerified).toBe(true);
    }
  });

  it("refuses an already_landed replay whose PR URL points at another repo", () => {
    const result = _processCompletedResult(
      {
        pr: {
          ...VALID_PR,
          url: "https://github.com/attacker/evil/pull/1",
          failure: "already_landed",
        },
      },
      APPROVED_DIFF,
      REPO_URL,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureCode).toBe("pr_create_failed");
    }
  });

  it("refuses an already_landed replay whose diff carries a credential", () => {
    const secretDiff =
      "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n" +
      "+const token = 'ghp_" + "a".repeat(36) + "';\n";
    const result = _processCompletedResult(
      { pr: { ...VALID_PR, diff: secretDiff, failure: "already_landed" } },
      APPROVED_DIFF,
      REPO_URL,
    );
    expect(result.ok).toBe(false);
  });

  it("does not throw on an already_landed replay missing `diff`", () => {
    const { diff: _diff, ...noDiff } = VALID_PR;
    const result = _processCompletedResult(
      { pr: { ...noDiff, failure: "already_landed" } },
      APPROVED_DIFF,
      REPO_URL,
    );
    expect(result.ok).toBe(false);
  });

  it("maps an ok:false already_landed replay to the already_landed code", () => {
    const result = _processCompletedResult(
      {
        pr: {
          ok: false,
          failure: "already_landed",
          diff: "should never surface",
          error: "raw git stderr",
        },
      },
      APPROVED_DIFF,
      REPO_URL,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureCode).toBe("already_landed");
      expect(JSON.stringify(result)).not.toMatch(/raw git stderr/);
    }
  });

  it("hardens a fresh success the same way", () => {
    const result = _processCompletedResult(
      { pr: { ...VALID_PR, url: "https://gitlab.com/stakwork/hive/pull/42" } },
      APPROVED_DIFF,
      REPO_URL,
    );
    expect(result.ok).toBe(false);
  });
});

// Import the module just to verify it loads (imports are checked at parse time).
describe("createPr module loads", () => {
  it("exports hardenPrResult", async () => {
    const mod = await import("@/services/swarm/createPr");
    expect(typeof mod.hardenPrResult).toBe("function");
    expect(typeof mod.createPr).toBe("function");
    expect(typeof mod.reconcilePr).toBe("function");
  });
});
