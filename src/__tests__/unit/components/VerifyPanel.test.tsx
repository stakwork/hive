/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { VerifyPanel } from "@/app/w/[slug]/plan/[featureId]/components/VerifyPanel";

globalThis.React = React;

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/components/ScreenshotModal", () => ({
  ScreenshotModal: () => null,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeFeature = (id = "feature-1") =>
  ({
    id,
    title: "Test Feature",
    brief: null,
    requirements: null,
    architecture: null,
    personas: null,
    diagramUrl: null,
    diagramS3Key: null,
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    workflowStatus: null,
    stakworkProjectId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    assignee: null,
  }) as any;

const makeAttachmentsResponse = (count = 2) => ({
  attachments: Array.from({ length: count }, (_, i) => ({
    id: `att-${i}`,
    taskId: "task-1",
    taskTitle: "Task One",
    url: `https://s3.example.com/screenshot-${i}.png`,
    filename: `screenshot-${i}.png`,
    createdAt: new Date().toISOString(),
  })),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VerifyPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeleton on initial load when no screenshots yet", async () => {
    // Delay the fetch so the skeleton is visible during the pending state
    let resolve: (value: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolve = res;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(pending as Promise<Response>);

    render(<VerifyPanel feature={makeFeature()} workspaceId="ws-1" />);

    // Skeleton divs use animate-pulse
    expect(document.querySelector(".animate-pulse")).toBeTruthy();

    // Resolve the fetch to avoid open handles
    await act(async () => {
      resolve!(new Response(JSON.stringify({ attachments: [] }), { status: 200 }));
    });
  });

  it("does NOT show skeleton during background re-fetch when screenshots already exist", async () => {
    const feature = makeFeature();

    // First fetch — resolves immediately with screenshots
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeAttachmentsResponse(2)), { status: 200 })
      )
      // Second fetch — delayed so we can inspect the in-flight state
      .mockReturnValueOnce(new Promise(() => {}) as Promise<Response>);

    const { rerender } = render(
      <VerifyPanel feature={feature} workspaceId="ws-1" />
    );

    // Wait for the initial screenshots to render
    await waitFor(() => {
      expect(screen.getByText("Task One")).toBeInTheDocument();
    });

    // Trigger a re-render with a NEW object reference but the SAME feature.id
    // (simulates parent re-fetching the feature on a Pusher event)
    const newFeatureRef = makeFeature("feature-1"); // same id, new object
    rerender(<VerifyPanel feature={newFeatureRef} workspaceId="ws-1" />);

    // Screenshots should still be visible — no skeleton flash
    expect(screen.getByText("Task One")).toBeInTheDocument();
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });

  it("does NOT re-trigger fetch when same feature.id is passed as a new object reference", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ attachments: [] }), { status: 200 })
    );

    const feature = makeFeature("feature-42");
    const { rerender } = render(
      <VerifyPanel feature={feature} workspaceId="ws-1" />
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Re-render with a new object reference but identical id
    rerender(<VerifyPanel feature={makeFeature("feature-42")} workspaceId="ws-1" />);

    // Still only one fetch call — the effect did not re-run
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-triggers fetch when feature.id actually changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ attachments: [] }), { status: 200 }))
    );

    const { rerender } = render(
      <VerifyPanel feature={makeFeature("feature-1")} workspaceId="ws-1" />
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    rerender(<VerifyPanel feature={makeFeature("feature-2")} workspaceId="ws-1" />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it("shows empty state when fetch returns no attachments", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ attachments: [] }), { status: 200 })
    );

    render(<VerifyPanel feature={makeFeature()} workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText(/no screenshots yet/i)).toBeInTheDocument();
    });
  });

  it("renders grouped screenshots after a successful fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(makeAttachmentsResponse(3)), { status: 200 })
    );

    render(<VerifyPanel feature={makeFeature()} workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("Task One")).toBeInTheDocument();
    });

    // 3 screenshots rendered as step buttons
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(3);
  });
});
