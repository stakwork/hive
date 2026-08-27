/**
 * Unit tests for RubricBreakdownStrip.
 *
 * Key acceptance criteria:
 * - renderToStaticMarkup succeeds (proves component stays hook-free)
 * - "—" renders for both null and undefined disputed
 * - Pass/Contested/Total/Disputed testids present, no fail chip
 * - null breakdown renders nothing
 * - every class emitted is present in the generated offline-report.css bundle
 *   (self-building smoke test — see the "offline report CSS fidelity" describe
 *   block below)
 */

import React from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { RubricBreakdownStrip } from "@/components/harvey-lab/RubricBreakdownStrip";
import type { RubricBreakdown } from "@/lib/harvey-lab/rubric-scoring";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBreakdown(overrides: Partial<RubricBreakdown> = {}): RubricBreakdown {
  return {
    pass: 3,
    fail: 2,
    contested: 1,
    total: 6,
    disputed: null,
    totalSource: "graph",
    clamped: false,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("RubricBreakdownStrip", () => {
  it("returns null when breakdown is null", () => {
    const { container } = render(<RubricBreakdownStrip breakdown={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renderToStaticMarkup succeeds — component stays hook-free", () => {
    const breakdown = makeBreakdown({ disputed: 1 });
    expect(() => renderToStaticMarkup(<RubricBreakdownStrip breakdown={breakdown} />)).not.toThrow();
  });

  describe("chips", () => {
    it("renders pass/contested/total chips and the disputed tag, and no fail chip", () => {
      const { queryByTestId } = render(
        <RubricBreakdownStrip breakdown={makeBreakdown({ pass: 3, fail: 2, contested: 1, total: 6, disputed: 1 })} />
      );
      expect(screen.getByTestId("rubric-breakdown-pass")).toBeDefined();
      expect(screen.getByTestId("rubric-breakdown-contested")).toBeDefined();
      expect(screen.getByTestId("rubric-breakdown-total")).toBeDefined();
      expect(screen.getByTestId("rubric-breakdown-disputed")).toBeDefined();
      expect(queryByTestId("rubric-breakdown-fail")).toBeNull();
    });

    it("shows correct count values", () => {
      render(<RubricBreakdownStrip breakdown={makeBreakdown({ pass: 5, fail: 3, contested: 2, total: 10, disputed: 1 })} />);
      expect(screen.getByTestId("rubric-breakdown-pass").textContent).toContain("5");
      expect(screen.getByTestId("rubric-breakdown-contested").textContent).toContain("2");
      expect(screen.getByTestId("rubric-breakdown-total").textContent).toContain("10");
      expect(screen.getByTestId("rubric-breakdown-disputed").textContent).toContain("1");
    });

    it("emits no fail/failed text or destructive styling anywhere in the markup", () => {
      const markup = renderToStaticMarkup(
        <RubricBreakdownStrip breakdown={makeBreakdown({ pass: 3, fail: 2, contested: 1, total: 6, disputed: 1 })} />
      );
      expect(markup.toLowerCase()).not.toContain("fail");
      expect(markup).not.toContain("destructive");
    });

    it("renders — for null disputed", () => {
      render(<RubricBreakdownStrip breakdown={makeBreakdown({ disputed: null })} />);
      const chip = screen.getByTestId("rubric-breakdown-disputed");
      expect(chip.textContent).toContain("—");
    });

    it("renders — for undefined disputed (both encodings)", () => {
      // Cast to satisfy TypeScript — the component must handle undefined defensively.
      const breakdown = makeBreakdown({ disputed: undefined as unknown as null });
      render(<RubricBreakdownStrip breakdown={breakdown} />);
      const chip = screen.getByTestId("rubric-breakdown-disputed");
      expect(chip.textContent).toContain("—");
    });

    it("renders 0 disputed (not —) when keys are present but nothing flagged", () => {
      render(<RubricBreakdownStrip breakdown={makeBreakdown({ disputed: 0 })} />);
      const chip = screen.getByTestId("rubric-breakdown-disputed");
      expect(chip.textContent).toContain("0");
      expect(chip.textContent).not.toContain("—");
    });

    it("adds run-reported marker to Total title when totalSource is run", () => {
      render(<RubricBreakdownStrip breakdown={makeBreakdown({ totalSource: "run" })} />);
      const totalChip = screen.getByTestId("rubric-breakdown-total");
      expect(totalChip.getAttribute("title")).toContain("run-reported");
    });

    it("does not add run-reported marker when totalSource is graph", () => {
      render(<RubricBreakdownStrip breakdown={makeBreakdown({ totalSource: "graph" })} />);
      const totalChip = screen.getByTestId("rubric-breakdown-total");
      expect(totalChip.getAttribute("title")).not.toContain("run-reported");
    });
  });

  /**
   * Self-building smoke test for the generated offline report CSS bundle.
   *
   * Replaces the old hand-maintained "OFFLINE_CSS class compliance" test
   * (which compared against a manually-copied allowlist that had already
   * drifted from the real hand-written OFFLINE_CSS constant — see the
   * feature brief). This test instead:
   *
   *   1. Runs the real `build:offline-css` script directly in `beforeAll`
   *      (NOT relying on CI job ordering — the unit-test CI job does not run
   *      `npm run build`, so a test that only checked a pre-existing artifact
   *      would either fail outright or silently pass against a stale file).
   *   2. Asserts the generated `offline-report.css` exists, is non-empty, and
   *      actually contains a class this component emits.
   *
   * This proves the generation pipeline produces real, usable output for at
   * least one real consumer of it — coverage of the full render path lives in
   * the broader "offline report CSS fidelity" suite in
   * src/__tests__/unit/lib/run-report/export/offline-css-fidelity.test.ts.
   */
  describe("offline report CSS bundle (self-building)", () => {
    const CSS_PATH = join(
      process.cwd(),
      "src/lib/run-report/export/offline-report.css",
    );

    beforeAll(() => {
      execFileSync("node", [join(process.cwd(), "scripts/build-offline-css.mjs")], {
        stdio: "pipe",
      });
    }, 60_000);

    it("generates a non-empty offline-report.css", () => {
      expect(existsSync(CSS_PATH)).toBe(true);
      const css = readFileSync(CSS_PATH, "utf8");
      expect(css.length).toBeGreaterThan(0);
    });

    it("contains a RubricBreakdownStrip-specific class (.text-violet-500)", () => {
      const css = readFileSync(CSS_PATH, "utf8");
      // RubricBreakdownStrip's contested chip uses text-violet-500 — a class
      // specific enough to this component (not a generic like `flex`) that
      // its presence proves the bundle was actually generated from real
      // source scanning, not a stale/empty file.
      expect(css).toContain(".text-violet-500");
    });
  });
});
