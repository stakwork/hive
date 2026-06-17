// @vitest-environment jsdom
/**
 * Render tests for `SubAgentRunCard` — specifically the ExternalLink
 * icon in the collapsed (default) view.
 */

import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubAgentRunCard } from "@/app/org/[githubLogin]/_components/SubAgentRunCard";
import type { SubAgentRun } from "@/app/org/[githubLogin]/_components/SubAgentRunCard";

// FeaturePlanDialog does a fetch on mount — mock it out.
vi.mock(
  "@/app/org/[githubLogin]/_components/FeaturePlanDialog",
  () => ({
    FeaturePlanDialog: () => null,
  }),
);

function makeRun(overrides: Partial<SubAgentRun> = {}): SubAgentRun {
  return {
    featureId: "feat-abc",
    featureTitle: "Auth API",
    workspaceSlug: "backend",
    workspaceName: "Backend",
    messages: [
      {
        messageId: "m1",
        messageIndex: 0,
        direction: "out",
        text: "please proceed",
        status: "sent",
      },
    ],
    anchorMessageId: "m1",
    ...overrides,
  };
}

describe("SubAgentRunCard — ExternalLink in collapsed view", () => {
  test("renders ExternalLink anchor in collapsed state with correct href and target", () => {
    render(<SubAgentRunCard run={makeRun()} />);

    const link = screen.getByTitle("Open feature plan");
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/w/backend/plan/feat-abc");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  test("does not render ExternalLink anchor when workspaceSlug is missing", () => {
    render(<SubAgentRunCard run={makeRun({ workspaceSlug: "" })} />);

    const link = screen.queryByTitle("Open feature plan");
    expect(link).toBeNull();
  });

  test("does not render ExternalLink anchor when featureId is missing", () => {
    render(<SubAgentRunCard run={makeRun({ featureId: "" })} />);

    const link = screen.queryByTitle("Open feature plan");
    expect(link).toBeNull();
  });

  test("clicking the ExternalLink anchor does not toggle the card expand/collapse", () => {
    render(<SubAgentRunCard run={makeRun()} />);

    const link = screen.getByTitle("Open feature plan");

    // Card starts collapsed — the button has aria-expanded="false".
    const toggleBtn = screen.getByRole("button");
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");

    // Click the link.
    fireEvent.click(link);

    // Card must still be collapsed.
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
  });
});
