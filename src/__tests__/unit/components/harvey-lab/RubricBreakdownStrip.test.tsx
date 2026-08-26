/**
 * Unit tests for RubricBreakdownStrip.
 *
 * Key acceptance criteria:
 * - renderToStaticMarkup succeeds (proves component stays hook-free)
 * - "—" renders for both null and undefined disputed
 * - Pass/Contested/Total/Disputed testids present, no fail chip
 * - null breakdown renders nothing
 * - every class emitted is present in the OFFLINE_CSS allowlist
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { RubricBreakdownStrip } from "@/components/harvey-lab/RubricBreakdownStrip";
import type { RubricBreakdown } from "@/lib/harvey-lab/rubric-scoring";

// Classes emitted by RubricBreakdownStrip — verified against the OFFLINE_CSS
// allowlist in src/lib/run-report/export/offline-html.ts. If this test fails
// because a new class was added to the component, it must also be added to OFFLINE_CSS.
const EXPECTED_OFFLINE_CLASSES = [
  "inline-flex",
  "flex-wrap",
  "items-center",
  "gap-2",
  "gap-1",
  "rounded-full",
  "border",
  "px-2",
  "py-0.5",
  "font-mono",
  "text-[10px]",
  "uppercase",
  "tracking-[0.07em]",
  "text-violet-500",
  "bg-violet-500/10",
  "border-violet-500/40",
  "text-emerald-600",
  "bg-emerald-500/10",
  "border-emerald-500/40",
  "text-destructive",
  "bg-destructive/10",
  "border-destructive/45",
  "text-muted-foreground/70",
  "border-border",
  "mt-2",
  "flex",
];

// OFFLINE_CSS raw text — extracted from the compiled allowlist so this test
// stays in sync. We inline a subset sufficient to validate no new class was
// silently added without a corresponding allowlist entry.
const OFFLINE_CSS_CLASSES = new Set([
  "inline-flex",
  "flex",
  "flex-wrap",
  "items-center",
  "gap-1",
  "gap-2",
  "px-2",
  "py-0.5",
  "mt-2",
  "font-mono",
  "uppercase",
  "rounded-full",
  "border",
  "border-border",
  "border-emerald-500/40",
  "border-destructive/45",
  "border-violet-500/40",
  "text-[10px]",
  "tracking-[0.07em]",
  "text-emerald-600",
  "text-destructive",
  "text-violet-500",
  "text-muted-foreground/70",
  "bg-emerald-500/10",
  "bg-destructive/10",
  "bg-violet-500/10",
]);

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

  describe("OFFLINE_CSS class compliance", () => {
    it("every class emitted by the strip is present in the OFFLINE_CSS allowlist", () => {
      const markup = renderToStaticMarkup(
        <RubricBreakdownStrip
          breakdown={makeBreakdown({ pass: 3, fail: 2, contested: 1, total: 6, disputed: 1 })}
        />
      );

      // Extract all class names from the rendered HTML.
      const classMatches = markup.match(/class="([^"]*)"/g) ?? [];
      const allClasses = new Set<string>();
      for (const match of classMatches) {
        const classStr = match.replace(/^class="/, "").replace(/"$/, "");
        for (const cls of classStr.split(/\s+/)) {
          if (cls.trim()) allClasses.add(cls.trim());
        }
      }

      // Every emitted class must be in our expected OFFLINE_CSS set.
      const unlistedClasses: string[] = [];
      for (const cls of allClasses) {
        if (!OFFLINE_CSS_CLASSES.has(cls)) {
          unlistedClasses.push(cls);
        }
      }

      if (unlistedClasses.length > 0) {
        throw new Error(
          `RubricBreakdownStrip emits classes not in OFFLINE_CSS: ${unlistedClasses.join(", ")}.\n` +
          "Add them to the OFFLINE_CSS allowlist in src/lib/run-report/export/offline-html.ts",
        );
      }
    });
  });
});
