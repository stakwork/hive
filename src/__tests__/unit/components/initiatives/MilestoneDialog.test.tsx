/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for MilestoneDialog component.
 *
 * Covers:
 * - Owner <Select> renders when githubLogin is provided
 * - Pre-selects the existing assignee in edit mode
 * - assigneeId is included in saved form data
 * - Clearing owner sends empty string
 * - No owner picker when githubLogin is omitted
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// jsdom does not implement scrollIntoView; Radix Select calls it internally
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock next/navigation used transitively
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

import {
  MilestoneDialog,
  emptyMilestoneForm,
  milestoneToForm,
} from "@/components/initiatives/MilestoneDialog";
import type { MilestoneResponse } from "@/types/initiatives";

// ── Helpers ────────────────────────────────────────────────────────────────────

const MEMBERS = [
  { id: "user-1", name: "Alice", githubUsername: "alice", image: null, workspaceDescriptions: [] },
  { id: "user-2", name: "Bob", githubUsername: "bob", image: null, workspaceDescriptions: [] },
];

function setupMembersFetch() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => MEMBERS,
  } as Response);
}

function makeMilestoneResponse(overrides: Partial<MilestoneResponse> = {}): MilestoneResponse {
  return {
    id: "ms-1",
    initiativeId: "init-1",
    name: "Existing Milestone",
    description: null,
    status: "NOT_STARTED",
    sequence: 1,
    dueDate: null,
    completedAt: null,
    assigneeId: null,
    createdById: null,
    assignee: null,
    features: [],
    feature: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  } as unknown as MilestoneResponse;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("MilestoneDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders owner Select when githubLogin is provided", async () => {
    setupMembersFetch();
    const onSave = vi.fn().mockResolvedValue({});
    render(
      <MilestoneDialog
        open
        onClose={vi.fn()}
        onSave={onSave}
        githubLogin="my-org"
      />,
    );

    // Wait for members to be fetched and select to appear
    await waitFor(() => {
      expect(screen.getByText("Owner")).toBeInTheDocument();
    });
  });

  it("does NOT render owner Select when githubLogin is omitted", () => {
    render(
      <MilestoneDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({})}
      />,
    );
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });

  it("pre-selects the existing assignee in edit mode", async () => {
    setupMembersFetch();
    const initial = makeMilestoneResponse({
      assigneeId: "user-1",
      assignee: { id: "user-1", name: "Alice" },
    });

    render(
      <MilestoneDialog
        open
        onClose={vi.fn()}
        initial={initial}
        onSave={vi.fn().mockResolvedValue({})}
        githubLogin="my-org"
      />,
    );

    await waitFor(() => {
      // The trigger shows the selected member's name
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
  });

  it("includes assigneeId in the form passed to onSave", async () => {
    setupMembersFetch();
    const onSave = vi.fn().mockResolvedValue({});

    render(
      <MilestoneDialog
        open
        onClose={vi.fn()}
        onSave={onSave}
        githubLogin="my-org"
        defaultSequence={1}
      />,
    );

    // Fill in name
    await userEvent.type(screen.getByLabelText(/Name \*/i), "Sprint 1");

    // Wait for members dropdown to be populated
    await waitFor(() => {
      expect(screen.getByText("Owner")).toBeInTheDocument();
    });

    // Open owner select and choose Alice
    const trigger = screen.getByRole("combobox", { name: /owner/i });
    await userEvent.click(trigger);
    await waitFor(() => screen.getByText("Alice"));
    await userEvent.click(screen.getByText("Alice"));

    // Submit
    await userEvent.click(screen.getByRole("button", { name: /Add Milestone/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: "user-1" }),
      );
    });
  });

  it("sends empty string assigneeId when No owner is selected", async () => {
    setupMembersFetch();
    // Start with an assigned milestone
    const initial = makeMilestoneResponse({
      assigneeId: "user-1",
      assignee: { id: "user-1", name: "Alice" },
    });
    const onSave = vi.fn().mockResolvedValue({});

    render(
      <MilestoneDialog
        open
        onClose={vi.fn()}
        initial={initial}
        onSave={onSave}
        githubLogin="my-org"
      />,
    );

    await waitFor(() => screen.getByText("Alice"));

    // Open select and pick '— No owner —'
    const trigger = screen.getByRole("combobox", { name: /owner/i });
    await userEvent.click(trigger);
    await waitFor(() => screen.getByText("— No owner —"));
    await userEvent.click(screen.getByText("— No owner —"));

    await userEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: "" }),
      );
    });
  });
});

// ── milestoneToForm unit tests ─────────────────────────────────────────────────

describe("milestoneToForm", () => {
  it("maps assignee id into assigneeId", () => {
    const m = makeMilestoneResponse({
      assigneeId: "user-1",
      assignee: { id: "user-1", name: "Alice" },
    });
    const form = milestoneToForm(m as unknown as MilestoneResponse);
    expect(form.assigneeId).toBe("user-1");
  });

  it("maps missing assignee to empty string", () => {
    const m = makeMilestoneResponse({ assigneeId: null, assignee: null });
    const form = milestoneToForm(m as unknown as MilestoneResponse);
    expect(form.assigneeId).toBe("");
  });
});

describe("emptyMilestoneForm", () => {
  it("includes assigneeId as empty string", () => {
    const form = emptyMilestoneForm();
    expect(form.assigneeId).toBe("");
  });
});
