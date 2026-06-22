// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaptureEvalForm, CREATE_NEW_VALUE, CREATE_NEW_REQ } from "@/components/evals/CaptureEvalForm";

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const baseProps = {
  requirement: "",
  reason: "",
  onRequirementChange: vi.fn(),
  onReasonChange: vi.fn(),
  submitting: false,
  evalSets: [
    { ref_id: "set-1", name: "Core Evals" },
    { ref_id: "set-2", name: "Edge Cases" },
  ],
  loadingEvalSets: false,
  evalSetsError: false,
  selectedEvalSetId: "",
  onSelectEvalSet: vi.fn(),
  newEvalSetName: "",
  onNewEvalSetNameChange: vi.fn(),
};

function makeReqs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ref_id: `req-${i + 1}`,
    properties: { name: `Requirement ${i + 1}` },
  }));
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("CaptureEvalForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Eval set picker", () => {
    it("renders eval sets", () => {
      render(<CaptureEvalForm {...baseProps} />);
      expect(screen.getByText("Core Evals")).toBeInTheDocument();
      expect(screen.getByText("Edge Cases")).toBeInTheDocument();
    });

    it("renders loading state for eval sets", () => {
      render(<CaptureEvalForm {...baseProps} loadingEvalSets />);
      expect(screen.getByText(/loading eval sets/i)).toBeInTheDocument();
    });

    it("renders error state for eval sets", () => {
      render(<CaptureEvalForm {...baseProps} evalSetsError />);
      expect(screen.getByText(/failed to load eval sets/i)).toBeInTheDocument();
    });

    it("shows new eval set name input when CREATE_NEW_VALUE is selected", () => {
      render(<CaptureEvalForm {...baseProps} selectedEvalSetId={CREATE_NEW_VALUE} />);
      expect(screen.getByPlaceholderText(/new eval set name/i)).toBeInTheDocument();
    });
  });

  describe("Requirement picker — hidden when no set selected", () => {
    it("does not show requirement picker when no eval set is selected", () => {
      render(<CaptureEvalForm {...baseProps} selectedEvalSetId="" />);
      expect(screen.queryByText(/loading requirements/i)).not.toBeInTheDocument();
      // Requirement text input should be visible (no picker)
      expect(screen.getByPlaceholderText(/what should this step/i)).toBeInTheDocument();
    });

    it("does not show requirement picker when CREATE_NEW_VALUE is selected", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId={CREATE_NEW_VALUE}
          requirements={makeReqs(2)}
        />
      );
      // No requirement picker rendered for a brand-new eval set
      expect(screen.queryByText(/requirement 1/i)).not.toBeInTheDocument();
    });
  });

  describe("Requirement picker — shown when existing set selected", () => {
    it("shows loading spinner while requirements are loading", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          loadingRequirements
          requirements={[]}
        />
      );
      expect(screen.getByText(/loading requirements/i)).toBeInTheDocument();
    });

    it("shows error message when requirements fail to load", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirementsError="Failed to load requirements"
          requirements={[]}
        />
      );
      expect(screen.getByText(/failed to load requirements/i)).toBeInTheDocument();
    });

    it("shows empty state when set has no requirements", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={[]}
        />
      );
      expect(screen.getByText(/no requirements yet/i)).toBeInTheDocument();
    });

    it("renders requirement list when set has requirements", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(2)}
        />
      );
      expect(screen.getByText("Requirement 1")).toBeInTheDocument();
      expect(screen.getByText("Requirement 2")).toBeInTheDocument();
    });

    it("shows 'Create new requirement' option when requirements exist", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(2)}
        />
      );
      expect(screen.getByText(/create new requirement/i)).toBeInTheDocument();
    });

    it("calls onSelectRequirement with req ref_id when clicking a requirement", () => {
      const onSelectRequirement = vi.fn();
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(2)}
          onSelectRequirement={onSelectRequirement}
        />
      );
      fireEvent.click(screen.getByText("Requirement 1").closest("button")!);
      expect(onSelectRequirement).toHaveBeenCalledWith("req-1");
    });

    it("calls onSelectRequirement with CREATE_NEW_REQ when clicking 'Create new requirement'", () => {
      const onSelectRequirement = vi.fn();
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(2)}
          onSelectRequirement={onSelectRequirement}
        />
      );
      fireEvent.click(screen.getByText(/create new requirement/i).closest("button")!);
      expect(onSelectRequirement).toHaveBeenCalledWith(CREATE_NEW_REQ);
    });

    it("hides requirement text input when an existing requirement is selected", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(2)}
          selectedRequirementId="req-1"
        />
      );
      expect(screen.queryByPlaceholderText(/what should this step/i)).not.toBeInTheDocument();
    });

    it("shows requirement text input when CREATE_NEW_REQ is selected", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(2)}
          selectedRequirementId={CREATE_NEW_REQ}
        />
      );
      expect(screen.getByPlaceholderText(/what should this step/i)).toBeInTheDocument();
    });

    it("shows requirement text input when selectedRequirementId is null", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(2)}
          selectedRequirementId={null}
        />
      );
      // When no req selected yet, text input not shown (picker is visible)
      // Per spec: show it only when CREATE_NEW_REQ or null (and no picker)
      // When picker is showing and null: text input IS hidden until user chooses
      // Note: the form shows text input only when selectedRequirementId === CREATE_NEW_REQ or selectedRequirementId == null
      // but since picker is shown, let's verify: when null + picker shown, input is still shown per spec
      expect(screen.getByPlaceholderText(/what should this step/i)).toBeInTheDocument();
    });
  });

  describe("Search input", () => {
    it("does NOT show search input when ≤4 requirements", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(4)}
        />
      );
      expect(screen.queryByPlaceholderText(/search requirements/i)).not.toBeInTheDocument();
    });

    it("shows search input when >4 requirements", () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(5)}
        />
      );
      expect(screen.getByPlaceholderText(/search requirements/i)).toBeInTheDocument();
    });

    it("filters requirements by search text", async () => {
      const reqs = [
        { ref_id: "req-1", properties: { name: "Auth error handling" } },
        { ref_id: "req-2", properties: { name: "Rate limiting check" } },
        { ref_id: "req-3", properties: { name: "Auth token refresh" } },
        { ref_id: "req-4", properties: { name: "Empty response guard" } },
        { ref_id: "req-5", properties: { name: "JSON parse validation" } },
      ];
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={reqs}
        />
      );

      const searchInput = screen.getByPlaceholderText(/search requirements/i);
      await userEvent.type(searchInput, "auth");

      expect(screen.getByText("Auth error handling")).toBeInTheDocument();
      expect(screen.getByText("Auth token refresh")).toBeInTheDocument();
      expect(screen.queryByText("Rate limiting check")).not.toBeInTheDocument();
      expect(screen.queryByText("Empty response guard")).not.toBeInTheDocument();
    });

    it("shows 'no requirements match' when search yields no results", async () => {
      render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(5)}
        />
      );

      const searchInput = screen.getByPlaceholderText(/search requirements/i);
      await userEvent.type(searchInput, "zzznomatch");

      expect(screen.getByText(/no requirements match/i)).toBeInTheDocument();
    });
  });

  describe("Switching eval sets", () => {
    it("clears requirement picker display when switching to CREATE_NEW_VALUE", () => {
      const onSelectRequirement = vi.fn();
      const { rerender } = render(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId="set-1"
          requirements={makeReqs(2)}
          selectedRequirementId="req-1"
          onSelectRequirement={onSelectRequirement}
        />
      );

      // Simulate switching to "create new eval set"
      rerender(
        <CaptureEvalForm
          {...baseProps}
          selectedEvalSetId={CREATE_NEW_VALUE}
          requirements={makeReqs(2)}
          selectedRequirementId="req-1"
          onSelectRequirement={onSelectRequirement}
        />
      );

      // Requirement picker should no longer be visible
      expect(screen.queryByText("Requirement 1")).not.toBeInTheDocument();
      expect(screen.queryByText(/create new requirement/i)).not.toBeInTheDocument();
    });
  });
});
