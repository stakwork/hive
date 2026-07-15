/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

globalThis.React = React;

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    size,
    variant,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    size?: string;
    variant?: string;
  }) =>
    React.createElement(
      "button",
      { disabled, onClick, "data-size": size, "data-variant": variant },
      children,
    ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) =>
    React.createElement(
      "span",
      { "data-testid": "badge", className },
      children,
    ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { ProposedFixCard } = await import("@/components/legal/ProposedFixCard");

// ─── Helpers ──────────────────────────────────────────────────────────────────

import type { ProposedFix } from "@/types/legal";

function makeFix(overrides: Partial<ProposedFix> = {}): ProposedFix {
  return {
    ref_id: "fix-1",
    criterion_id: "crit-1",
    criterion_title: "Accuracy of citations",
    prompt_name: "citation_checker_v2",
    prompt_id: "prompt-abc",
    prompt_version_id: "v1.0.0",
    new_prompt_version_id: "v1.1.0",
    failing_value: "Model cited Smith v. Jones incorrectly.",
    passing_value: "Model must cite with correct reporter.",
    delta: "Added explicit citation format instructions.",
    reasoning: "The prompt lacked specificity on citation format.",
    status: "proposed",
    rerun_status: "pending",
    before_score: undefined,
    after_score: undefined,
    score_delta: undefined,
    rerun_run_id: undefined,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ProposedFixCard", () => {
  it("renders prompt_name and criterion_title in the header", () => {
    render(React.createElement(ProposedFixCard, { fix: makeFix() }));
    expect(screen.getByText("citation_checker_v2")).toBeInTheDocument();
    expect(screen.getByText("Accuracy of citations")).toBeInTheDocument();
  });

  it("renders delta and reasoning in the body", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({
          delta: "Changed the prompt format.",
          reasoning: "The old prompt was too vague.",
        }),
      }),
    );
    expect(screen.getByText("Changed the prompt format.")).toBeInTheDocument();
    expect(screen.getByText("The old prompt was too vague.")).toBeInTheDocument();
  });

  it("renders passing_value labeled as 'What would've passed'", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ passing_value: "Expected correct citation format." }),
      }),
    );
    expect(screen.getByText(/what would.ve passed/i)).toBeInTheDocument();
    expect(screen.getByText("Expected correct citation format.")).toBeInTheDocument();
  });

  it("renders prompt_version_id as secondary text", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ prompt_version_id: "v1.0.0" }),
      }),
    );
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText(/Failed under version/i)).toBeInTheDocument();
  });

  // ─── Interactive (pending/untagged) state ─────────────────────────────────

  it("renders enabled Accept and Reject buttons for pending/untagged status", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ status: "proposed" }),
        onAccept: vi.fn(),
        onReject: vi.fn(),
        isPending: false,
      }),
    );
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent?.trim());
    expect(labels).toContain("Accept");
    expect(labels).toContain("Reject");
    buttons.forEach((btn) => {
      expect(btn).not.toBeDisabled();
    });
  });

  it("calls onAccept with the fix ref_id when Accept is clicked", () => {
    const onAccept = vi.fn();
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ status: "proposed" }),
        onAccept,
        onReject: vi.fn(),
        isPending: false,
      }),
    );
    const acceptBtn = screen.getByRole("button", { name: /accept/i });
    fireEvent.click(acceptBtn);
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onAccept).toHaveBeenCalledWith("fix-1");
  });

  it("calls onReject with the fix ref_id when Reject is clicked", () => {
    const onReject = vi.fn();
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ status: "proposed" }),
        onAccept: vi.fn(),
        onReject,
        isPending: false,
      }),
    );
    const rejectBtn = screen.getByRole("button", { name: /reject/i });
    fireEvent.click(rejectBtn);
    expect(onReject).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledWith("fix-1");
  });

  it("disables both buttons while isPending is true", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ status: "proposed" }),
        onAccept: vi.fn(),
        onReject: vi.fn(),
        isPending: true,
      }),
    );
    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("does not fire onAccept when clicked while pending", () => {
    const onAccept = vi.fn();
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ status: "proposed" }),
        onAccept,
        onReject: vi.fn(),
        isPending: true,
      }),
    );
    const acceptBtn = screen.getByRole("button", { name: /accept/i });
    fireEvent.click(acceptBtn);
    // Button is disabled so onClick won't fire
    expect(onAccept).not.toHaveBeenCalled();
  });

  // ─── Accepted state ───────────────────────────────────────────────────────

  it("renders a non-actionable published state for status=accepted", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({
          status: "accepted",
          resolved_by: "alice",
          resolved_at: "2024-01-15T10:00:00.000Z",
        }),
        onAccept: vi.fn(),
        onReject: vi.fn(),
      }),
    );
    // No actionable buttons
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
    // Shows published state
    expect(screen.getByText(/published/i)).toBeInTheDocument();
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
  });

  it("shows published state without resolved_by/resolved_at when absent", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ status: "accepted" }),
        onAccept: vi.fn(),
        onReject: vi.fn(),
      }),
    );
    expect(screen.getByText(/published/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // ─── Rejected state ───────────────────────────────────────────────────────

  it("renders a non-actionable rejected state for status=rejected (stale client copy)", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ status: "rejected" }),
        onAccept: vi.fn(),
        onReject: vi.fn(),
      }),
    );
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
    expect(screen.getByText(/rejected/i)).toBeInTheDocument();
  });

  // ─── Badge variant tests ───────────────────────────────────────────────────

  it("shows spinner 'Running…' badge for rerun_status=pending", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ rerun_status: "pending" }),
      }),
    );
    expect(screen.getByText("Running…")).toBeInTheDocument();
    expect(screen.queryByTestId("badge")).toBeNull();
  });

  it("shows spinner 'Running…' badge for rerun_status=running", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ rerun_status: "running" }),
      }),
    );
    expect(screen.getByText("Running…")).toBeInTheDocument();
  });

  it("shows green 'Improved' badge for rerun_status=improved with scores", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({
          rerun_status: "improved",
          before_score: "50",
          after_score: "54",
          score_delta: "+4",
        }),
      }),
    );
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toMatch(/Improved 50→54/);
    expect(badge.textContent).toMatch(/\+4/);
    expect(badge.className).toMatch(/green/);
  });

  it("shows grey 'No change' badge for rerun_status=no_change", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ rerun_status: "no_change" }),
      }),
    );
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toBe("No change");
  });

  it("shows red 'Regressed' badge for rerun_status=regressed", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ rerun_status: "regressed" }),
      }),
    );
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toBe("Regressed");
    expect(badge.className).toMatch(/red/);
  });

  it("shows green improved badge for rerun_status=scored with positive score_delta", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({
          rerun_status: "scored",
          score_delta: "+3",
          before_score: "48",
          after_score: "51",
        }),
      }),
    );
    const badge = screen.getByTestId("badge");
    expect(badge.className).toMatch(/green/);
    expect(badge.textContent).toMatch(/\+3/);
  });

  it("shows grey 'No change' badge for rerun_status=scored with zero score_delta", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ rerun_status: "scored", score_delta: "0" }),
      }),
    );
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toBe("No change");
  });

  it("shows red regressed badge for rerun_status=scored with negative score_delta", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: makeFix({ rerun_status: "scored", score_delta: "-2" }),
      }),
    );
    const badge = screen.getByTestId("badge");
    expect(badge.className).toMatch(/red/);
    expect(badge.textContent).toBe("Regressed");
  });

  it("renders gracefully with minimal fields (no crash on missing optional fields)", () => {
    render(
      React.createElement(ProposedFixCard, {
        fix: { ref_id: "fix-min" },
      }),
    );
    // With no status, falls through to pending/untagged branch — buttons present but not crashed
    // No callbacks passed, so buttons don't call anything (no-op click)
    expect(screen.queryByText(/published/i)).toBeNull();
  });
});
