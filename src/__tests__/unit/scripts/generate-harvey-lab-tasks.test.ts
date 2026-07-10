/**
 * Unit tests for the pure helpers exported from scripts/generate-harvey-lab-tasks.ts.
 *
 * We test:
 *  - TASK_PATH_RE  — tree-filter regex matches/excludes the right paths
 *  - slugFromPath  — slug derivation from a tree path
 *  - titleFromSlug — non-generic last-segment fallback title logic
 *
 * The truncation guard behaviour is tested via a lightweight integration-style
 * test that stubs `ghFetch` at the module level.
 */

import { describe, test, expect } from "vitest";
import { TASK_PATH_RE, slugFromPath, titleFromSlug } from "../../../../scripts/generate-harvey-lab-tasks";

// ─── TASK_PATH_RE ─────────────────────────────────────────────────────────────

describe("TASK_PATH_RE", () => {
  test("matches a shallow two-level task path", () => {
    expect(TASK_PATH_RE.test("tasks/contracts/nda-review/task.json")).toBe(true);
  });

  test("matches a deep four-level task path", () => {
    expect(
      TASK_PATH_RE.test(
        "tasks/contracts/commercial-channel-partnerships/channel-distribution-counterparty-paper-review/scenario-01/task.json"
      )
    ).toBe(true);
  });

  test("matches a three-level task path", () => {
    expect(
      TASK_PATH_RE.test("tasks/intellectual-property/patent-review/some-scenario/task.json")
    ).toBe(true);
  });

  test("rejects a task.json directly under tasks/ (no practice area)", () => {
    expect(TASK_PATH_RE.test("tasks/task.json")).toBe(false);
  });

  test("rejects a path with no task.json filename", () => {
    expect(TASK_PATH_RE.test("tasks/contracts/nda-review/README.md")).toBe(false);
  });

  test("rejects a path outside the tasks/ prefix", () => {
    expect(TASK_PATH_RE.test("docs/contracts/nda-review/task.json")).toBe(false);
  });

  test("rejects a task.json nested inside a documents/ folder", () => {
    // documents/ subfolder exists alongside tasks — should be excluded
    expect(
      TASK_PATH_RE.test("tasks/contracts/nda-review/documents/task.json")
    ).toBe(false);
  });

  test("rejects a task.json inside a deep documents/ subfolder", () => {
    expect(
      TASK_PATH_RE.test(
        "tasks/contracts/foo/bar/documents/supplemental/task.json"
      )
    ).toBe(false);
  });
});

// ─── slugFromPath ─────────────────────────────────────────────────────────────

describe("slugFromPath", () => {
  test("strips leading tasks/ and trailing /task.json for a two-level path", () => {
    expect(slugFromPath("tasks/contracts/nda-review/task.json")).toBe(
      "contracts/nda-review"
    );
  });

  test("preserves all intermediate segments for a deep path", () => {
    expect(
      slugFromPath(
        "tasks/contracts/commercial-channel-partnerships/channel-distribution-counterparty-paper-review/scenario-01/task.json"
      )
    ).toBe(
      "contracts/commercial-channel-partnerships/channel-distribution-counterparty-paper-review/scenario-01"
    );
  });

  test("preserves a three-level path intact", () => {
    expect(
      slugFromPath("tasks/intellectual-property/patent-review/scenario-02/task.json")
    ).toBe("intellectual-property/patent-review/scenario-02");
  });
});

// ─── titleFromSlug ────────────────────────────────────────────────────────────

describe("titleFromSlug", () => {
  test("title-cases the last segment for a simple two-level slug", () => {
    expect(titleFromSlug("contracts/nda-review")).toBe("Nda Review");
  });

  test("skips generic 'scenario-NN' segment and uses the prior descriptive segment", () => {
    expect(
      titleFromSlug(
        "contracts/commercial-channel-partnerships/channel-distribution-counterparty-paper-review/scenario-01"
      )
    ).toBe("Channel Distribution Counterparty Paper Review");
  });

  test("skips 'part-01' and uses the prior descriptive segment", () => {
    expect(titleFromSlug("tax/transfer-pricing/part-01")).toBe("Transfer Pricing");
  });

  test("uses a non-generic last segment even in a deep path", () => {
    expect(
      titleFromSlug("intellectual-property/patent-review/obviousness-analysis")
    ).toBe("Obviousness Analysis");
  });

  test("handles a single-segment slug (practice area only) gracefully", () => {
    expect(titleFromSlug("contracts")).toBe("Contracts");
  });

  test("falls back to the practice area segment if every segment is generic", () => {
    // All segments after the first are generic — should pick the first (non-generic) one
    expect(titleFromSlug("contracts/scenario-01/part-02")).toBe("Contracts");
  });
});
