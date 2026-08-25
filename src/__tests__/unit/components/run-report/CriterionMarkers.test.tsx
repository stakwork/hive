/**
 * @vitest-environment jsdom
 *
 * Unit tests for CriterionMarkers — the shared read-only marker chip component.
 *
 * Covers all four flagged/contested combinations:
 *   1. neither → renders nothing
 *   2. disputed only → DISPUTED chip (amber), no CONTESTED chip
 *   3. contested only → CONTESTED chip (violet), no DISPUTED chip
 *   4. both → both chips, neither masking the other
 *
 * Also verifies `data-testid` hooks so downstream tests can target the markers.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CriterionMarkers } from "@/components/run-report/CriterionMarkers";

// Tooltip stub — keeps tests focused on chip presence/absence.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tooltip" }, children),
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tooltip-trigger" }, children),
  TooltipContent: ({
    children,
    side,
  }: {
    children?: React.ReactNode;
    side?: string;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "tooltip-content", "data-side": side },
      children,
    ),
}));

describe("CriterionMarkers", () => {
  // ── 1. Neither flag set ────────────────────────────────────────────────────

  it("renders nothing when both disputed and contested are false", () => {
    const { container } = render(
      <CriterionMarkers disputed={false} contested={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when both props are omitted", () => {
    const { container } = render(<CriterionMarkers />);
    expect(container.firstChild).toBeNull();
  });

  // ── 2. Disputed only ──────────────────────────────────────────────────────

  it("renders DISPUTED chip when disputed=true", () => {
    render(<CriterionMarkers disputed={true} contested={false} />);
    expect(screen.getByTestId("criterion-disputed-badge")).toBeInTheDocument();
  });

  it("renders DISPUTED text in the chip", () => {
    render(<CriterionMarkers disputed={true} />);
    expect(screen.getByTestId("criterion-disputed-badge")).toHaveTextContent(
      "DISPUTED",
    );
  });

  it("does NOT render CONTESTED chip when only disputed=true", () => {
    render(<CriterionMarkers disputed={true} contested={false} />);
    expect(
      screen.queryByTestId("criterion-contested-badge"),
    ).not.toBeInTheDocument();
  });

  // ── 3. Contested only ─────────────────────────────────────────────────────

  it("renders CONTESTED chip when contested=true", () => {
    render(<CriterionMarkers disputed={false} contested={true} />);
    expect(
      screen.getByTestId("criterion-contested-badge"),
    ).toBeInTheDocument();
  });

  it("renders CONTESTED text in the chip", () => {
    render(<CriterionMarkers contested={true} />);
    expect(screen.getByTestId("criterion-contested-badge")).toHaveTextContent(
      "CONTESTED",
    );
  });

  it("does NOT render DISPUTED chip when only contested=true", () => {
    render(<CriterionMarkers disputed={false} contested={true} />);
    expect(
      screen.queryByTestId("criterion-disputed-badge"),
    ).not.toBeInTheDocument();
  });

  // ── 4. Both flags set ─────────────────────────────────────────────────────

  it("renders both DISPUTED and CONTESTED chips when both are true", () => {
    render(<CriterionMarkers disputed={true} contested={true} />);
    expect(screen.getByTestId("criterion-disputed-badge")).toBeInTheDocument();
    expect(
      screen.getByTestId("criterion-contested-badge"),
    ).toBeInTheDocument();
  });

  it("neither chip masks the other when both are set", () => {
    render(<CriterionMarkers disputed={true} contested={true} />);
    // Both chips visible and contain correct text
    expect(screen.getByTestId("criterion-disputed-badge")).toHaveTextContent(
      "DISPUTED",
    );
    expect(screen.getByTestId("criterion-contested-badge")).toHaveTextContent(
      "CONTESTED",
    );
  });

  // ── Tooltip presence ──────────────────────────────────────────────────────

  it("each chip is wrapped in a Tooltip", () => {
    render(<CriterionMarkers disputed={true} contested={true} />);
    // Both chips inside tooltip triggers
    const triggers = screen.getAllByTestId("tooltip-trigger");
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });

  it("DISPUTED chip tooltip mentions historical context", () => {
    render(<CriterionMarkers disputed={true} />);
    const tooltipContents = screen.getAllByTestId("tooltip-content");
    const disputedTooltip = tooltipContents.find((el) =>
      el.textContent?.toLowerCase().includes("historical") ||
      el.textContent?.toLowerCase().includes("does not rewrite"),
    );
    expect(disputedTooltip).toBeDefined();
  });

  it("CONTESTED chip tooltip explains score exclusion", () => {
    render(<CriterionMarkers contested={true} />);
    const tooltipContents = screen.getAllByTestId("tooltip-content");
    const contestedTooltip = tooltipContents.find((el) =>
      el.textContent?.toLowerCase().includes("excluded from the score"),
    );
    expect(contestedTooltip).toBeDefined();
  });

  // ── data-testid hooks resolve ─────────────────────────────────────────────

  it("criterion-disputed-badge testid is addressable", () => {
    render(<CriterionMarkers disputed={true} />);
    const badge = screen.getByTestId("criterion-disputed-badge");
    expect(badge).toBeTruthy();
  });

  it("criterion-contested-badge testid is addressable", () => {
    render(<CriterionMarkers contested={true} />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toBeTruthy();
  });

  // ── flagBasis tooltip ─────────────────────────────────────────────────────

  it("criterion-dispute-basis is absent when flagBasis is null", () => {
    render(<CriterionMarkers disputed={true} flagBasis={null} />);
    expect(screen.queryByTestId("criterion-dispute-basis")).not.toBeInTheDocument();
  });

  it("criterion-dispute-basis is absent when flagBasis is empty string", () => {
    render(<CriterionMarkers disputed={true} flagBasis="" />);
    expect(screen.queryByTestId("criterion-dispute-basis")).not.toBeInTheDocument();
  });

  it("criterion-dispute-basis is absent when flagBasis is undefined", () => {
    render(<CriterionMarkers disputed={true} />);
    expect(screen.queryByTestId("criterion-dispute-basis")).not.toBeInTheDocument();
  });

  it("renders basis line for criterion_validity token", () => {
    render(<CriterionMarkers disputed={true} flagBasis="criterion_validity" />);
    const basisEl = screen.getByTestId("criterion-dispute-basis");
    expect(basisEl).toBeInTheDocument();
    expect(basisEl.textContent).toContain("criterion definition");
  });

  it("renders basis line for judge_error token", () => {
    render(<CriterionMarkers disputed={true} flagBasis="judge_error" />);
    const basisEl = screen.getByTestId("criterion-dispute-basis");
    expect(basisEl).toBeInTheDocument();
    expect(basisEl.textContent).toContain("judge");
  });

  it("renders basis line for legitimate_failure token", () => {
    render(<CriterionMarkers disputed={true} flagBasis="legitimate_failure" />);
    const basisEl = screen.getByTestId("criterion-dispute-basis");
    expect(basisEl).toBeInTheDocument();
    expect(basisEl.textContent).toContain("legitimate");
  });

  it("renders basis line for indeterminate token", () => {
    render(<CriterionMarkers disputed={true} flagBasis="indeterminate" />);
    const basisEl = screen.getByTestId("criterion-dispute-basis");
    expect(basisEl).toBeInTheDocument();
    expect(basisEl.textContent).toContain("indeterminate");
  });

  it("humanizes an unknown token (never raw snake_case)", () => {
    render(<CriterionMarkers disputed={true} flagBasis="some_unknown_basis" />);
    const basisEl = screen.getByTestId("criterion-dispute-basis");
    expect(basisEl).toBeInTheDocument();
    // must not contain raw underscores
    expect(basisEl.textContent).not.toContain("some_unknown_basis");
    // spaces instead of underscores, sentence case
    expect(basisEl.textContent).toContain("Some unknown basis");
  });

  it("criterion-dispute-basis is not present when chip is not disputed", () => {
    render(<CriterionMarkers disputed={false} contested={true} flagBasis="judge_error" />);
    expect(screen.queryByTestId("criterion-dispute-basis")).not.toBeInTheDocument();
  });
});

// ── Origin-aware contested chip ───────────────────────────────────────────────

describe("CriterionMarkers — contestedOrigin prop (additive, non-breaking)", () => {
  // ── data-contested-origin attribute ────────────────────────────────────────

  it("sets data-contested-origin to 'in-run' when contestedOrigin='in-run'", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="in-run" />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toHaveAttribute("data-contested-origin", "in-run");
  });

  it("sets data-contested-origin to 'roster' when contestedOrigin='roster'", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="roster" />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toHaveAttribute("data-contested-origin", "roster");
  });

  it("sets data-contested-origin to 'both' when contestedOrigin='both'", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="both" />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toHaveAttribute("data-contested-origin", "both");
  });

  it("sets data-contested-origin to 'unknown' when contestedOrigin='unknown'", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="unknown" />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toHaveAttribute("data-contested-origin", "unknown");
  });

  it("does NOT set data-contested-origin when contestedOrigin is absent", () => {
    render(<CriterionMarkers contested={true} />);
    const badge = screen.getByTestId("criterion-contested-badge");
    // When no origin is supplied the attribute should not be present (legacy mode)
    expect(badge).not.toHaveAttribute("data-contested-origin");
  });

  it("does NOT set data-contested-origin when contestedOrigin is null", () => {
    render(<CriterionMarkers contested={true} contestedOrigin={null} />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).not.toHaveAttribute("data-contested-origin");
  });

  // ── Label text per origin ──────────────────────────────────────────────────

  it("chip label is 'CONTESTED' for origin in-run", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="in-run" />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toHaveTextContent("CONTESTED");
  });

  it("chip label is 'PRIOR CONTEST' for origin roster", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="roster" />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toHaveTextContent("PRIOR CONTEST");
  });

  it("chip label is 'CONTESTED' for origin both", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="both" />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toHaveTextContent("CONTESTED");
  });

  it("chip label is 'CONTESTED' for origin unknown", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="unknown" />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toHaveTextContent("CONTESTED");
  });

  // ── 'both' differs from 'in-run' in rendered DOM (not just tooltip) ────────

  it("renders a trailing dot marker ONLY for origin 'both' (not 'in-run')", () => {
    const { unmount } = render(
      <CriterionMarkers contested={true} contestedOrigin="both" />,
    );
    expect(
      screen.getByTestId("criterion-contested-both-marker"),
    ).toBeInTheDocument();
    unmount();

    render(<CriterionMarkers contested={true} contestedOrigin="in-run" />);
    expect(
      screen.queryByTestId("criterion-contested-both-marker"),
    ).not.toBeInTheDocument();
  });

  it("renders no trailing dot marker for origin 'roster'", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="roster" />);
    expect(
      screen.queryByTestId("criterion-contested-both-marker"),
    ).not.toBeInTheDocument();
  });

  it("renders no trailing dot marker for origin 'unknown'", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="unknown" />);
    expect(
      screen.queryByTestId("criterion-contested-both-marker"),
    ).not.toBeInTheDocument();
  });

  it("renders no trailing dot marker when contestedOrigin is absent", () => {
    render(<CriterionMarkers contested={true} />);
    expect(
      screen.queryByTestId("criterion-contested-both-marker"),
    ).not.toBeInTheDocument();
  });

  // ── Legacy: existing `contested={true}` cases stay green ──────────────────

  it("still renders CONTESTED chip with no origin prop (legacy mode)", () => {
    render(<CriterionMarkers contested={true} />);
    const badge = screen.getByTestId("criterion-contested-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("CONTESTED");
  });

  it("all four existing contested/disputed combinations stay green", () => {
    // Neither
    const { unmount: u1 } = render(
      <CriterionMarkers disputed={false} contested={false} />,
    );
    expect(screen.queryByTestId("criterion-contested-badge")).not.toBeInTheDocument();
    u1();

    // Disputed only
    const { unmount: u2 } = render(<CriterionMarkers disputed={true} />);
    expect(screen.queryByTestId("criterion-contested-badge")).not.toBeInTheDocument();
    u2();

    // Contested only
    render(<CriterionMarkers contested={true} />);
    expect(screen.getByTestId("criterion-contested-badge")).toHaveTextContent("CONTESTED");
  });

  // ── Tooltip contains "contested" in every origin ──────────────────────────

  it("tooltip text contains 'contested' for origin in-run", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="in-run" />);
    const tooltips = screen.getAllByTestId("tooltip-content");
    const contestedTooltip = tooltips.find((el) =>
      el.textContent?.toLowerCase().includes("contested"),
    );
    expect(contestedTooltip).toBeDefined();
  });

  it("tooltip text contains 'contested' for origin roster", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="roster" />);
    const tooltips = screen.getAllByTestId("tooltip-content");
    const contestedTooltip = tooltips.find((el) =>
      el.textContent?.toLowerCase().includes("contested"),
    );
    expect(contestedTooltip).toBeDefined();
  });

  it("tooltip text contains 'contested' for origin both", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="both" />);
    const tooltips = screen.getAllByTestId("tooltip-content");
    const contestedTooltip = tooltips.find((el) =>
      el.textContent?.toLowerCase().includes("contested"),
    );
    expect(contestedTooltip).toBeDefined();
  });

  it("tooltip text contains 'contested' for origin unknown", () => {
    render(<CriterionMarkers contested={true} contestedOrigin="unknown" />);
    const tooltips = screen.getAllByTestId("tooltip-content");
    const contestedTooltip = tooltips.find((el) =>
      el.textContent?.toLowerCase().includes("contested"),
    );
    expect(contestedTooltip).toBeDefined();
  });

  // ── DISPUTED chip still renders alongside origin-aware CONTESTED chip ──────

  it("DISPUTED chip still renders when both disputed and contestedOrigin='roster' are set", () => {
    render(
      <CriterionMarkers
        disputed={true}
        contested={true}
        contestedOrigin="roster"
      />,
    );
    expect(screen.getByTestId("criterion-disputed-badge")).toBeInTheDocument();
    expect(screen.getByTestId("criterion-contested-badge")).toBeInTheDocument();
    expect(screen.getByTestId("criterion-contested-badge")).toHaveTextContent(
      "PRIOR CONTEST",
    );
  });
});
