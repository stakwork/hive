import { describe, it, expect } from "vitest";
import {
  isAlreadyLanded,
  landedPr,
  LAND_CHANGE_ERR_UNAUTH,
  LAND_CHANGE_ERR_MULTI_REPO,
  LAND_CHANGE_ERR_EMPTY_PAT,
  LAND_CHANGE_ERR_IDENTITY,
  LAND_CHANGE_ERR_NO_PUSH,
  LAND_CHANGE_ERR_RATE_LIMITED,
  type LandChangeSuccess,
  type LandChangeFailure,
  type LandChangeResult,
} from "@/services/swarm/landChangeContract";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const FRESH_SUCCESS: LandChangeSuccess = {
  ok: true,
  url: "https://github.com/stakwork/hive/pull/1",
  number: 1,
  branch: "swarm/add-widget-abc12345",
  base: "master",
  headSha: "0".repeat(40),
  diff: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n",
  filesChanged: 1,
};

const FRESH_FAILURE: LandChangeFailure = {
  ok: false,
  failure: "patch_conflict",
  diff: "",
  error: "git commit failed: conflict",
};

// Built exactly the way git_pr.ts builds it: `{ ...prior, failure: "already_landed" }`.
// The spread is the whole point — it carries the prior result's own fields through.
const SUCCESS_REPLAY: LandChangeResult = {
  ...FRESH_SUCCESS,
  failure: "already_landed",
};

const FAILURE_REPLAY: LandChangeResult = {
  ...FRESH_FAILURE,
  failure: "already_landed",
};

// ─── Replay shapes ────────────────────────────────────────────────────────

describe("already-landed replay", () => {
  it("keeps ok: true when the first call succeeded", () => {
    // The trap: upstream asserts this `as LandChangeFailure`, but `ok` is true
    // and there is no `error` field.
    expect(SUCCESS_REPLAY.ok).toBe(true);
    expect(SUCCESS_REPLAY).not.toHaveProperty("error");
  });

  it("keeps ok: false when the first call failed", () => {
    expect(FAILURE_REPLAY.ok).toBe(false);
  });

  it("overwrites the original failure code, losing the cause", () => {
    // Documented consequence: patch_conflict is unrecoverable from the replay.
    expect(FAILURE_REPLAY).toMatchObject({ failure: "already_landed" });
    expect(FAILURE_REPLAY).not.toMatchObject({ failure: "patch_conflict" });
  });

  it("preserves the PR fields on a success replay", () => {
    expect(SUCCESS_REPLAY).toMatchObject({
      url: FRESH_SUCCESS.url,
      number: FRESH_SUCCESS.number,
      headSha: FRESH_SUCCESS.headSha,
    });
  });
});

// ─── isAlreadyLanded ──────────────────────────────────────────────────────

describe("isAlreadyLanded", () => {
  it("is false for a fresh success", () => {
    expect(isAlreadyLanded(FRESH_SUCCESS)).toBe(false);
  });

  it("is false for a fresh failure", () => {
    expect(isAlreadyLanded(FRESH_FAILURE)).toBe(false);
  });

  it("is true for a success replay, despite ok: true", () => {
    expect(isAlreadyLanded(SUCCESS_REPLAY)).toBe(true);
  });

  it("is true for a failure replay", () => {
    expect(isAlreadyLanded(FAILURE_REPLAY)).toBe(true);
  });

  it("catches a replay that narrowing on ok === false would miss", () => {
    // The bug this guard exists to prevent: treating a success replay as a
    // fresh landing and opening/counting a second PR.
    const looksFresh = SUCCESS_REPLAY.ok === true;
    expect(looksFresh).toBe(true);
    expect(isAlreadyLanded(SUCCESS_REPLAY)).toBe(true);
  });
});

// ─── landedPr ─────────────────────────────────────────────────────────────

describe("landedPr", () => {
  it("returns the PR for a fresh success", () => {
    expect(landedPr(FRESH_SUCCESS)?.number).toBe(1);
  });

  it("returns the same PR for a success replay", () => {
    expect(landedPr(SUCCESS_REPLAY)?.number).toBe(1);
  });

  it("returns null for a fresh failure", () => {
    expect(landedPr(FRESH_FAILURE)).toBeNull();
  });

  it("returns null for a failure replay", () => {
    expect(landedPr(FAILURE_REPLAY)).toBeNull();
  });
});

// ─── Admission error constants ────────────────────────────────────────────
//
// Pinned against stakgraph mcp/src/repo/index.ts. If the swarm changes these
// strings, these assertions are the tripwire.

describe("HTTP admission error constants", () => {
  it("matches the 401 body the swarm sends verbatim", () => {
    expect(LAND_CHANGE_ERR_UNAUTH).toBe(
      "create_pr requires API_TOKEN to be configured",
    );
  });

  it("matches the 400 repo_url and pat bodies verbatim", () => {
    expect(LAND_CHANGE_ERR_MULTI_REPO).toBe(
      "create_pr requires exactly one explicit repo_url (no comma-separated list, no omission)",
    );
    expect(LAND_CHANGE_ERR_EMPTY_PAT).toBe(
      "create_pr requires a non-empty pat",
    );
  });

  it("matches the `failure` field — not `error` — for identity/push/rate", () => {
    // These three responses carry a longer, sometimes dynamic `error` string;
    // only `failure` is stable enough to compare.
    expect(LAND_CHANGE_ERR_IDENTITY).toBe("identity_mismatch");
    expect(LAND_CHANGE_ERR_NO_PUSH).toBe("no_push_permission");
    expect(LAND_CHANGE_ERR_RATE_LIMITED).toBe("rate_limited");

    const noPushBody = {
      error: "no_push_permission: PAT does not have push access to this repo",
      failure: "no_push_permission",
    };
    expect(noPushBody.error).not.toBe(LAND_CHANGE_ERR_NO_PUSH);
    expect(noPushBody.failure).toBe(LAND_CHANGE_ERR_NO_PUSH);
  });
});
